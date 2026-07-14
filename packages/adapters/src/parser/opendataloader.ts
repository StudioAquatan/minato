import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { convert } from "@opendataloader/pdf";
import type {
  FileId,
  PageBBox,
  ParseQuality,
  ParsedAuthor,
  ParsedDocument,
  ParsedElement,
  ParsedElementKind,
  ParsedReference,
  PdfParseInput,
  PdfParser,
} from "@minato/core";
import { detectLang } from "@minato/core";

type OdlBoundingBox = [number, number, number, number];

type OdlElement = {
  type?: string;
  id?: number;
  "page number"?: number;
  page?: number;
  "bounding box"?: OdlBoundingBox;
  boundingBox?: OdlBoundingBox;
  content?: string;
  text?: string;
  "heading level"?: number;
  headingLevel?: number;
  level?: string;
  kids?: OdlElement[];
  children?: OdlElement[];
};

type OdlDocument = {
  metadata?: {
    title?: string;
    authors?: string[] | string;
    year?: number;
    venue?: string;
    "page count"?: number;
    pageCount?: number;
  };
  elements?: OdlElement[];
  kids?: OdlElement[];
  children?: OdlElement[];
};

const flatten = (
  el: OdlElement,
  out: OdlElement[] = [],
): OdlElement[] => {
  const children = el.kids ?? el.children;
  if (children && children.length) {
    for (const c of children) flatten(c, out);
  } else {
    out.push(el);
  }
  return out;
};

const kindOf = (type: string | undefined): ParsedElementKind => {
  switch (type) {
    case "title":
      return "title";
    case "heading":
    case "H":
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6":
      return "heading";
    case "paragraph":
    case "P":
      return "paragraph";
    case "list":
    case "L":
      return "list";
    case "table":
      return "table";
    case "figure":
    case "figure_caption":
    case "caption":
      return "figure_caption";
    case "footnote":
      return "footnote";
    case "reference":
    case "bibliography":
      return "reference";
    default:
      return "other";
  }
};

const toBBox = (el: OdlElement): PageBBox => {
  const bb = el["bounding box"] ?? el.boundingBox ?? [0, 0, 0, 0];
  const page = el["page number"] ?? el.page ?? 1;
  const [x0, y0, x1, y1] = bb;
  return {
    page,
    x0: x0 ?? 0,
    y0: y0 ?? 0,
    x1: x1 ?? 0,
    y1: y1 ?? 0,
  };
};

const parseYear = (el: OdlElement): number | null => {
  const txt = (el.content ?? el.text ?? "").trim();
  const m = /^(19|20)\d{2}$/.exec(txt);
  return m ? Number(m[0]) : null;
};

const gatherReferences = (elements: OdlElement[]): string[] => {
  const refs: string[] = [];
  let inRefs = false;
  for (const el of elements) {
    const text = (el.content ?? el.text ?? "").trim();
    const kind = kindOf(el.type);
    if (kind === "heading" || kind === "title") {
      inRefs = /^(references?|参考文献|引用文献|bibliography)\b/i.test(text);
      continue;
    }
    if (inRefs && text) refs.push(text);
    if (!inRefs && kind === "reference" && text) refs.push(text);
  }
  return refs;
};

const computeQuality = (elements: ParsedElement[]): ParseQuality => {
  const totalChars = elements.reduce((n, el) => n + el.text.length, 0);
  const pages = new Set(elements.map((el) => el.page));
  const pageCount = Math.max(1, pages.size);
  const charsPerPage = totalChars / pageCount;
  const nonPrintable = elements.reduce(
    (n, el) => n + (el.text.match(/[�]/g)?.length ?? 0),
    0,
  );
  const garbleRatio =
    totalChars > 0 ? nonPrintable / totalChars : 0;
  const headingCount = elements.filter(
    (el) => el.kind === "heading" || el.kind === "title",
  ).length;
  const referenceCount = elements.filter(
    (el) => el.kind === "reference",
  ).length;
  return {
    charsPerPage,
    garbleRatio,
    headingCount,
    referenceCount,
    usedOcr: false,
    headerFieldsPresent: 0,
    headerFieldsRequired: 0,
    grobidAvailable: false,
  };
};

export type OpenDataLoaderParserOptions = {
  parserVersion?: string;
  workDir?: string;
  keepTempFiles?: boolean;
};

export type OpenDataLoaderParseResult = {
  input: PdfParseInput;
  document: ParsedDocument;
};

export class OpenDataLoaderParser implements PdfParser {
  readonly parserVersion: string;
  private readonly workDir: string | null;
  private readonly keepTempFiles: boolean;

  constructor(opts: OpenDataLoaderParserOptions = {}) {
    this.parserVersion = opts.parserVersion ?? "odl-pdf-2.5-v1";
    this.workDir = opts.workDir ?? null;
    this.keepTempFiles = opts.keepTempFiles ?? false;
  }

  async parse(inputs: PdfParseInput[]): Promise<ParsedDocument[]> {
    const results = await this.parseAll(inputs);
    return results.map((r) => r.document);
  }

  async parseAll(
    inputs: PdfParseInput[],
  ): Promise<OpenDataLoaderParseResult[]> {
    if (inputs.length === 0) return [];

    const baseDir =
      this.workDir ?? (await mkdtemp(join(tmpdir(), "minato-odl-")));
    if (this.workDir) {
      await mkdir(this.workDir, { recursive: true });
    }

    const outputDir = join(
      baseDir,
      `run-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    );
    await mkdir(outputDir, { recursive: true });

    try {
      await convert(
        inputs.map((i) => i.absolutePath),
        {
          outputDir,
          format: "json",
        },
      );
      const produced = await readdir(outputDir);
      const jsonByBaseName = new Map<string, string>();
      for (const f of produced) {
        if (extname(f).toLowerCase() === ".json") {
          jsonByBaseName.set(basename(f, ".json"), join(outputDir, f));
        }
      }
      const results: OpenDataLoaderParseResult[] = [];
      for (const input of inputs) {
        const key = basename(input.absolutePath, extname(input.absolutePath));
        const path = jsonByBaseName.get(key);
        if (!path) continue;
        const raw = await readFile(path, "utf8");
        const doc = JSON.parse(raw) as OdlDocument | OdlElement[];
        results.push({
          input,
          document: this.toParsedDocument(input.fileId, input.sha256, doc),
        });
      }
      return results;
    } finally {
      if (!this.keepTempFiles) {
        await rm(outputDir, { recursive: true, force: true });
      }
    }
  }

  private toParsedDocument(
    fileId: FileId,
    sha256: string,
    doc: OdlDocument | OdlElement[],
  ): ParsedDocument {
    const rawElements: OdlElement[] = Array.isArray(doc)
      ? doc.flatMap((e) => flatten(e))
      : doc.elements
        ? doc.elements.flatMap((e) => flatten(e))
        : doc.kids
          ? doc.kids.flatMap((e) => flatten(e))
          : doc.children
            ? doc.children.flatMap((e) => flatten(e))
            : [];

    const elements: ParsedElement[] = [];
    for (const el of rawElements) {
      const text = (el.content ?? el.text ?? "").toString();
      if (!text.trim()) continue;
      const kind = kindOf(el.type);
      const bbox = toBBox(el);
      elements.push({
        kind,
        headingLevel: el["heading level"] ?? el.headingLevel ?? null,
        text,
        page: bbox.page,
        bbox,
      });
    }

    const metadata = Array.isArray(doc) ? undefined : doc.metadata;
    const title =
      metadata?.title ??
      elements.find((e) => e.kind === "title")?.text ??
      null;
    const authorNames = metadata?.authors
      ? Array.isArray(metadata.authors)
        ? metadata.authors
        : String(metadata.authors).split(/\s*[,;]\s*/)
      : [];
    const authors: ParsedAuthor[] = authorNames
      .filter((n) => n.trim().length > 0)
      .map((n) => ({ fullName: n.trim(), affiliation: null }));
    const inferredYear = elements
      .map((_, i) => parseYear(rawElements[i] ?? {} as OdlElement))
      .find((y): y is number => y !== null) ?? null;
    const year = metadata?.year ?? inferredYear;
    const venue = metadata?.venue ?? null;
    const pageCount =
      metadata?.["page count"] ??
      metadata?.pageCount ??
      Math.max(1, ...elements.map((e) => e.page), 1);

    const rawRefs = gatherReferences(rawElements);
    const references: ParsedReference[] = rawRefs.map((raw, i) => ({
      ordinal: i,
      teiId: null,
      raw,
      doi: null,
      title: null,
      authorsHint: null,
      year: null,
      venue: null,
    }));
    const quality = computeQuality(elements);
    const lang = detectLang(elements.map((e) => e.text).join("\n"));

    return {
      fileId,
      sha256,
      parserVersion: this.parserVersion,
      lang,
      title,
      titleJa: null,
      authors,
      abstract: null,
      doi: null,
      arxivId: null,
      year,
      venue,
      pageCount,
      elements,
      references,
      citationContexts: [],
      teiXml: null,
      quality,
    };
  }
}
