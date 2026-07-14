import { XMLParser } from "fast-xml-parser";
import type {
  PageBBox,
  ParsedAuthor,
  ParsedCitationContext,
  ParsedReference,
} from "@minato/core";

export type TeiHeader = {
  title: string | null;
  authors: ParsedAuthor[];
  abstract: string | null;
  doi: string | null;
  arxivId: string | null;
  year: number | null;
  venue: string | null;
};

export type ParsedTei = {
  header: TeiHeader;
  references: ParsedReference[];
  citationContexts: ParsedCitationContext[];
  headerFieldsPresent: number;
  headerFieldsRequired: number;
};

type AnyNode = Record<string, unknown> | undefined;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  removeNSPrefix: true,
  trimValues: false,
  parseAttributeValue: false,
  parseTagValue: false,
  isArray: (name) =>
    [
      "author",
      "persName",
      "affiliation",
      "biblStruct",
      "note",
      "s",
      "ref",
      "p",
      "div",
      "surface",
      "idno",
      "title",
      "monogr",
      "analytic",
    ].includes(name),
});

const asArray = <T>(v: T | T[] | undefined | null): T[] => {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
};

const collectText = (node: unknown): string => {
  if (node === undefined || node === null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  if (typeof node === "object") {
    let out = "";
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k.startsWith("@")) continue;
      if (k === "#text") {
        out += typeof v === "string" ? v : String(v ?? "");
        continue;
      }
      out += collectText(v);
    }
    return out;
  }
  return "";
};

const normalizeSpace = (s: string) => s.replace(/\s+/g, " ").trim();

const parseCoords = (raw: string | undefined | null): PageBBox[] => {
  if (!raw) return [];
  return raw
    .split(";")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const parts = chunk.split(",").map((p) => Number(p.trim()));
      if (parts.length < 5) return null;
      const [page, x, y, w, h] = parts as [
        number,
        number,
        number,
        number,
        number,
      ];
      if ([page, x, y, w, h].some((n) => Number.isNaN(n))) return null;
      return {
        page: Math.max(1, Math.floor(page)),
        x0: x,
        y0: y,
        x1: x + w,
        y1: y + h,
      } satisfies PageBBox;
    })
    .filter((b): b is PageBBox => b !== null);
};

const firstCoord = (raw: string | undefined | null): PageBBox | null => {
  const list = parseCoords(raw);
  return list[0] ?? null;
};

const findFirst = (
  node: AnyNode,
  path: string[],
): unknown => {
  let cur: unknown = node;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return undefined;
    const next = (cur as Record<string, unknown>)[key];
    cur = Array.isArray(next) ? next[0] : next;
  }
  return cur;
};

const extractAuthorName = (author: AnyNode): string | null => {
  const persName = findFirst(author, ["persName"]) as AnyNode;
  if (persName) {
    const forename = collectText(persName.forename);
    const surname = collectText(persName.surname);
    const joined = normalizeSpace(`${forename} ${surname}`);
    if (joined.length > 0) return joined;
    const raw = normalizeSpace(collectText(persName));
    if (raw.length > 0) return raw;
  }
  const raw = normalizeSpace(collectText(author));
  return raw.length > 0 ? raw : null;
};

const extractAuthorAffiliation = (author: AnyNode): string | null => {
  const affs = asArray(
    (author as Record<string, unknown> | undefined)?.affiliation,
  );
  if (affs.length === 0) return null;
  const raw = affs
    .map((a) => normalizeSpace(collectText(a)))
    .filter((s) => s.length > 0)
    .join("; ");
  return raw.length > 0 ? raw : null;
};

const extractHeader = (tei: AnyNode): TeiHeader => {
  const teiHeader = findFirst(tei, ["teiHeader"]) as AnyNode;
  const fileDesc = findFirst(teiHeader, ["fileDesc"]) as AnyNode;
  const titleStmt = findFirst(fileDesc, ["titleStmt"]) as AnyNode;
  const titles = asArray(titleStmt?.title as unknown);
  const mainTitle = titles.find((t) => {
    const type = (t as Record<string, unknown>)?.["@type"];
    return type === "main" || type === undefined;
  });
  const title = mainTitle
    ? normalizeSpace(collectText(mainTitle))
    : titles.length > 0
      ? normalizeSpace(collectText(titles[0]))
      : null;

  const sourceDesc = findFirst(fileDesc, ["sourceDesc"]) as AnyNode;
  const biblStruct = findFirst(sourceDesc, ["biblStruct"]) as AnyNode;
  const analytic = findFirst(biblStruct, ["analytic"]) as AnyNode;
  const monogr = findFirst(biblStruct, ["monogr"]) as AnyNode;
  const authorsSource = analytic ?? monogr;
  const authorNodes = asArray(
    (authorsSource as Record<string, unknown> | undefined)?.author,
  );
  const authors: ParsedAuthor[] = [];
  for (const a of authorNodes) {
    const name = extractAuthorName(a as AnyNode);
    if (!name) continue;
    authors.push({
      fullName: name,
      affiliation: extractAuthorAffiliation(a as AnyNode),
    });
  }

  const abstractNode = findFirst(teiHeader, [
    "profileDesc",
    "abstract",
  ]);
  const abstract = abstractNode
    ? normalizeSpace(collectText(abstractNode))
    : null;

  const idnos = [
    ...asArray((biblStruct as Record<string, unknown> | undefined)?.idno),
    ...asArray((analytic as Record<string, unknown> | undefined)?.idno),
    ...asArray((monogr as Record<string, unknown> | undefined)?.idno),
  ];
  let doi: string | null = null;
  let arxivId: string | null = null;
  for (const idno of idnos) {
    const type = String(
      (idno as Record<string, unknown>)["@type"] ?? "",
    ).toLowerCase();
    const value = normalizeSpace(collectText(idno));
    if (!value) continue;
    if (type === "doi" && !doi) doi = value;
    else if (type === "arxiv" && !arxivId) arxivId = value;
    else if (
      !doi &&
      /^10\.\d{4,9}\/[\-._;()/:A-Z0-9]+$/i.test(value)
    ) {
      doi = value;
    }
  }

  const monoTitle = findFirst(monogr, ["title"]);
  const venue = monoTitle
    ? normalizeSpace(collectText(monoTitle))
    : null;

  const imprint = findFirst(monogr, ["imprint"]) as AnyNode;
  const dateNode = findFirst(imprint, ["date"]) as AnyNode;
  const dateAttr =
    (dateNode?.["@when"] as string | undefined) ??
    (dateNode?.["@from"] as string | undefined) ??
    null;
  const dateText = dateNode ? normalizeSpace(collectText(dateNode)) : "";
  const yearMatch = /(19|20)\d{2}/.exec(dateAttr ?? dateText);
  const year = yearMatch ? Number(yearMatch[0]) : null;

  return {
    title,
    authors,
    abstract,
    doi,
    arxivId,
    year,
    venue,
  };
};

const REQUIRED_HEADER_FIELDS: Array<keyof TeiHeader> = [
  "title",
  "authors",
  "year",
];

const countHeaderPresent = (h: TeiHeader): number => {
  let n = 0;
  for (const key of REQUIRED_HEADER_FIELDS) {
    const v = h[key];
    if (Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined) {
      n += 1;
    }
  }
  return n;
};

const extractReferenceRecord = (
  bibl: AnyNode,
  ordinal: number,
): ParsedReference => {
  const biblAttrs = (bibl as Record<string, unknown> | undefined) ?? {};
  const teiId =
    ((biblAttrs["@xml:id"] as string | undefined) ??
      (biblAttrs["@id"] as string | undefined)) ?? null;
  const rawNode = findFirst(bibl, ["note"]);
  const noteNodes = asArray(rawNode);
  const rawCandidate = noteNodes.find((n) => {
    const type = (n as Record<string, unknown>)?.["@type"];
    return type === "raw_reference" || type === "raw";
  });
  const raw = rawCandidate
    ? normalizeSpace(collectText(rawCandidate))
    : normalizeSpace(collectText(bibl));

  const analytic = findFirst(bibl, ["analytic"]) as AnyNode;
  const monogr = findFirst(bibl, ["monogr"]) as AnyNode;
  const analyticTitle = findFirst(analytic, ["title"]);
  const monogrTitle = findFirst(monogr, ["title"]);
  const title = analyticTitle
    ? normalizeSpace(collectText(analyticTitle))
    : monogrTitle
      ? normalizeSpace(collectText(monogrTitle))
      : null;

  const authorNodes = asArray(
    (analytic as Record<string, unknown> | undefined)?.author ??
      (monogr as Record<string, unknown> | undefined)?.author,
  );
  const authorNames = authorNodes
    .map((a) => extractAuthorName(a as AnyNode))
    .filter((n): n is string => n !== null);
  const authorsHint = authorNames.length > 0 ? authorNames.join(", ") : null;

  const idnos = [
    ...asArray((bibl as Record<string, unknown> | undefined)?.idno),
    ...asArray((analytic as Record<string, unknown> | undefined)?.idno),
    ...asArray((monogr as Record<string, unknown> | undefined)?.idno),
  ];
  let doi: string | null = null;
  for (const idno of idnos) {
    const type = String(
      (idno as Record<string, unknown>)["@type"] ?? "",
    ).toLowerCase();
    const value = normalizeSpace(collectText(idno));
    if (!value) continue;
    if (type === "doi") {
      doi = value;
      break;
    }
    if (!doi && /^10\.\d{4,9}\/[\-._;()/:A-Z0-9]+$/i.test(value)) {
      doi = value;
    }
  }

  const imprint = findFirst(monogr, ["imprint"]) as AnyNode;
  const dateNode = findFirst(imprint, ["date"]) as AnyNode;
  const dateAttr =
    (dateNode?.["@when"] as string | undefined) ??
    (dateNode?.["@from"] as string | undefined) ??
    null;
  const dateText = dateNode ? normalizeSpace(collectText(dateNode)) : "";
  const yearMatch = /(19|20)\d{2}/.exec(dateAttr ?? dateText);
  const year = yearMatch ? Number(yearMatch[0]) : null;

  const venueTitle = findFirst(monogr, ["title"]);
  const venue =
    venueTitle && venueTitle !== analyticTitle
      ? normalizeSpace(collectText(venueTitle))
      : null;

  return {
    ordinal,
    teiId: teiId ?? null,
    raw: raw || "(reference)",
    doi,
    title,
    authorsHint,
    year,
    venue,
  };
};

type SentenceCtx = {
  text: string;
  page: number;
  bbox: PageBBox | null;
};

const walk = (
  node: unknown,
  ctxStack: SentenceCtx[],
  contexts: ParsedCitationContext[],
): void => {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const it of node) walk(it, ctxStack, contexts);
    return;
  }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith("@") || key === "#text") continue;
    if (key === "s") {
      const sentences = asArray(value);
      for (const s of sentences) {
        const sObj = s as Record<string, unknown>;
        const coord = (sObj["@coords"] as string | undefined) ?? null;
        const bbox = firstCoord(coord);
        const text = normalizeSpace(collectText(sObj));
        const ctx: SentenceCtx = {
          text,
          page: bbox?.page ?? 1,
          bbox,
        };
        ctxStack.push(ctx);
        walk(sObj, ctxStack, contexts);
        ctxStack.pop();
      }
      continue;
    }
    if (key === "ref") {
      const refs = asArray(value);
      for (const r of refs) {
        const rObj = r as Record<string, unknown>;
        const type = String(rObj["@type"] ?? "");
        if (type !== "bibr") continue;
        const target = rObj["@target"] as string | undefined;
        if (!target) continue;
        const refTeiId = target.startsWith("#") ? target.slice(1) : target;
        const marker = normalizeSpace(collectText(rObj));
        const enclosing = ctxStack[ctxStack.length - 1];
        const refCoord = (rObj["@coords"] as string | undefined) ?? null;
        const refBBox = firstCoord(refCoord);
        contexts.push({
          refTeiId,
          marker: marker.length > 0 ? marker : null,
          snippet: enclosing?.text ?? marker,
          page: refBBox?.page ?? enclosing?.page ?? 1,
          bbox: refBBox ?? enclosing?.bbox ?? null,
        });
      }
      continue;
    }
    walk(value, ctxStack, contexts);
  }
};

const extractReferences = (tei: AnyNode): ParsedReference[] => {
  const text = tei ? (tei as Record<string, unknown>).text : undefined;
  const back = findFirst(text as AnyNode, ["back"]) as AnyNode;
  if (!back) return [];
  const divs = asArray(back.div);
  const bibls: unknown[] = [];
  for (const div of divs) {
    const dObj = div as Record<string, unknown>;
    const dType = String(dObj["@type"] ?? "").toLowerCase();
    if (dType !== "references" && dType !== "biblio" && dType !== "") {
      continue;
    }
    const listBibl = findFirst(dObj, ["listBibl"]) as AnyNode;
    if (!listBibl) continue;
    bibls.push(...asArray(listBibl.biblStruct));
  }
  if (bibls.length === 0) {
    const listBibl = findFirst(back, ["listBibl"]) as AnyNode;
    if (listBibl) {
      bibls.push(...asArray(listBibl.biblStruct));
    }
  }
  return bibls.map((b, i) => extractReferenceRecord(b as AnyNode, i));
};

const extractCitationContexts = (tei: AnyNode): ParsedCitationContext[] => {
  const text = tei ? (tei as Record<string, unknown>).text : undefined;
  const body = findFirst(text as AnyNode, ["body"]);
  if (!body) return [];
  const contexts: ParsedCitationContext[] = [];
  walk(body, [], contexts);
  return contexts;
};

export const parseTei = (xml: string): ParsedTei => {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const tei = (doc.TEI as AnyNode) ?? (doc.tei as AnyNode) ?? doc;
  const header = extractHeader(tei);
  const references = extractReferences(tei);
  const citationContexts = extractCitationContexts(tei);
  return {
    header,
    references,
    citationContexts,
    headerFieldsPresent: countHeaderPresent(header),
    headerFieldsRequired: REQUIRED_HEADER_FIELDS.length,
  };
};

export const teiHelpers = {
  parseCoords,
  firstCoord,
  normalizeSpace,
};
