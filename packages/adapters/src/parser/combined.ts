import type {
  ParsedCitationContext,
  ParsedDocument,
  ParsedReference,
  PdfParseInput,
  PdfParser,
} from "@minato/core";
import { GrobidClient, GrobidError } from "./grobid-client.js";
import { OpenDataLoaderParser } from "./opendataloader.js";
import { parseTei, type ParsedTei } from "./tei.js";

export type CombinedPdfParserOptions = {
  odl: OpenDataLoaderParser;
  grobid: GrobidClient;
  grobidVersion?: string;
  keepTeiXml?: boolean;
  logger?: {
    warn: (msg: string, extra?: Record<string, unknown>) => void;
    info?: (msg: string, extra?: Record<string, unknown>) => void;
  };
};

const defaultLogger = {
  warn: (msg: string, extra?: Record<string, unknown>) => {
    console.warn(`[grobid] ${msg}`, extra ?? "");
  },
  info: (msg: string, extra?: Record<string, unknown>) => {
    console.log(`[grobid] ${msg}`, extra ?? "");
  },
};

export class CombinedPdfParser implements PdfParser {
  readonly parserVersion: string;
  private readonly odl: OpenDataLoaderParser;
  private readonly grobid: GrobidClient;
  private readonly grobidVersion: string;
  private readonly keepTeiXml: boolean;
  private readonly logger: {
    warn: (msg: string, extra?: Record<string, unknown>) => void;
    info?: (msg: string, extra?: Record<string, unknown>) => void;
  };

  constructor(opts: CombinedPdfParserOptions) {
    this.odl = opts.odl;
    this.grobid = opts.grobid;
    this.grobidVersion = opts.grobidVersion ?? "grobid-0.8-v1";
    this.parserVersion = `${this.odl.parserVersion}+${this.grobidVersion}`;
    this.keepTeiXml = opts.keepTeiXml ?? false;
    this.logger = opts.logger ?? defaultLogger;
  }

  async parse(inputs: PdfParseInput[]): Promise<ParsedDocument[]> {
    if (inputs.length === 0) return [];

    const [odlResults, teiResults] = await Promise.all([
      this.parseOdl(inputs),
      this.parseGrobid(inputs),
    ]);

    const teiByFile = new Map<string, TeiOutcome>();
    for (const t of teiResults) teiByFile.set(t.fileId, t);

    const docs: ParsedDocument[] = [];
    for (const r of odlResults) {
      const tei = teiByFile.get(r.document.fileId);
      const merged = this.merge(r.document, tei);
      docs.push(merged);
    }
    return docs;
  }

  private async parseOdl(inputs: PdfParseInput[]) {
    try {
      return await this.odl.parseAll(inputs);
    } catch (err) {
      this.logger.warn("opendataloader batch failed; falling back to per-file", {
        error: (err as Error).message,
      });
      const out = [] as Awaited<ReturnType<OpenDataLoaderParser["parseAll"]>>;
      for (const input of inputs) {
        try {
          const r = await this.odl.parseAll([input]);
          out.push(...r);
        } catch (perFileErr) {
          this.logger.warn("opendataloader parse failed", {
            fileId: input.fileId,
            error: (perFileErr as Error).message,
          });
        }
      }
      return out;
    }
  }

  private async parseGrobid(inputs: PdfParseInput[]): Promise<TeiOutcome[]> {
    const outcomes = await Promise.all(
      inputs.map(async (input): Promise<TeiOutcome> => {
        try {
          const res = await this.grobid.processFulltextFromPath(
            input.absolutePath,
          );
          const parsed = parseTei(res.xml);
          return {
            fileId: input.fileId,
            ok: true,
            xml: res.xml,
            tei: parsed,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const status =
            err instanceof GrobidError ? err.status : null;
          this.logger.warn("grobid processFulltextDocument failed", {
            fileId: input.fileId,
            status,
            error: message,
          });
          return { fileId: input.fileId, ok: false, error: message };
        }
      }),
    );
    return outcomes;
  }

  private merge(base: ParsedDocument, outcome: TeiOutcome | undefined): ParsedDocument {
    if (!outcome || !outcome.ok || !outcome.tei) {
      return {
        ...base,
        parserVersion: this.parserVersion,
        quality: {
          ...base.quality,
          grobidAvailable: false,
        },
      };
    }
    const { tei, xml } = outcome;
    const references = tei.references.length > 0
      ? tei.references
      : base.references;
    const citationContexts = this.attachChunkCoordinates(
      base,
      tei.citationContexts,
    );
    return {
      ...base,
      parserVersion: this.parserVersion,
      title: tei.header.title ?? base.title,
      titleJa: base.titleJa,
      authors:
        tei.header.authors.length > 0 ? tei.header.authors : base.authors,
      abstract: tei.header.abstract ?? base.abstract,
      doi: tei.header.doi ?? base.doi,
      arxivId: tei.header.arxivId ?? base.arxivId,
      year: tei.header.year ?? base.year,
      venue: tei.header.venue ?? base.venue,
      references: this.dedupeReferences(references),
      citationContexts,
      teiXml: this.keepTeiXml ? xml : null,
      quality: {
        ...base.quality,
        referenceCount: Math.max(
          base.quality.referenceCount,
          references.length,
        ),
        headerFieldsPresent: tei.headerFieldsPresent,
        headerFieldsRequired: tei.headerFieldsRequired,
        grobidAvailable: true,
      },
    };
  }

  private dedupeReferences(refs: ParsedReference[]): ParsedReference[] {
    const seen = new Set<string>();
    const out: ParsedReference[] = [];
    let ordinal = 0;
    for (const ref of refs) {
      const key = ref.doi
        ? `doi:${ref.doi.toLowerCase()}`
        : ref.title
          ? `title:${ref.title.toLowerCase()}`
          : `raw:${ref.raw.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...ref, ordinal: ordinal++ });
    }
    return out;
  }

  private attachChunkCoordinates(
    base: ParsedDocument,
    contexts: ParsedCitationContext[],
  ): ParsedCitationContext[] {
    if (contexts.length === 0) return contexts;
    const byPage = new Map<number, typeof base.elements>();
    for (const el of base.elements) {
      const arr = byPage.get(el.page) ?? [];
      arr.push(el);
      byPage.set(el.page, arr);
    }
    return contexts.map((ctx) => {
      if (!ctx.bbox) return ctx;
      const candidates = byPage.get(ctx.bbox.page);
      if (!candidates || candidates.length === 0) return ctx;
      const cx = (ctx.bbox.x0 + ctx.bbox.x1) / 2;
      const cy = (ctx.bbox.y0 + ctx.bbox.y1) / 2;
      let best = candidates[0]!;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const el of candidates) {
        const ex = (el.bbox.x0 + el.bbox.x1) / 2;
        const ey = (el.bbox.y0 + el.bbox.y1) / 2;
        const dist = Math.hypot(cx - ex, cy - ey);
        if (dist < bestDist) {
          bestDist = dist;
          best = el;
        }
      }
      return {
        ...ctx,
        page: best.page,
        bbox: best.bbox,
      };
    });
  }
}

type TeiOutcome =
  | {
      fileId: string;
      ok: true;
      xml: string;
      tei: ParsedTei;
    }
  | {
      fileId: string;
      ok: false;
      error: string;
    };
