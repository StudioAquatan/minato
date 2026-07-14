import type {
  BiblioResolver,
  OaPdfCandidate,
  RefString,
  ResolvedReference,
} from "@minato/core";
import {
  OpenAlexClient,
  openAlexWorkToResolved,
  type OpenAlexWork,
} from "./openalex.js";
import {
  CrossrefClient,
  crossrefWorkToResolved,
  type CrossrefWork,
} from "./crossref.js";
import type { UnpaywallClient } from "./unpaywall.js";

export type BiblioResolverAdapterOptions = {
  openalex?: OpenAlexClient;
  crossref?: CrossrefClient;
  unpaywall?: UnpaywallClient;
  version?: string;
  minTitleLength?: number;
  logger?: {
    warn: (msg: string, extra?: Record<string, unknown>) => void;
  };
};

const DEFAULT_VERSION = "biblio-v1";
const DEFAULT_MIN_TITLE = 8;

const DOI_PATTERN = /(10\.\d{4,9}\/[\-._;()/:a-z0-9]+)/i;

const extractDoi = (ref: RefString): string | null => {
  const m = DOI_PATTERN.exec(ref);
  if (!m) return null;
  return m[1]!
    .toLowerCase()
    .replace(/[\.,;:\)\]]+$/g, "");
};

const looksLikeGoodTitle = (
  candidate: ResolvedReference,
  query: RefString,
  minTitleLen: number,
): boolean => {
  if (!candidate.title || candidate.title.length < minTitleLen) return false;
  const normQuery = query.toLowerCase();
  const normTitle = candidate.title.toLowerCase();
  const words = normTitle
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  if (words.length === 0) return true;
  let hits = 0;
  for (const w of words) {
    if (normQuery.includes(w)) hits += 1;
  }
  return hits / words.length >= 0.3;
};

const defaultLogger = {
  warn: (msg: string, extra?: Record<string, unknown>) => {
    console.warn(`[biblio] ${msg}`, extra ?? "");
  },
};

export class BiblioResolverAdapter implements BiblioResolver {
  readonly version: string;
  private readonly openalex: OpenAlexClient | null;
  private readonly crossref: CrossrefClient | null;
  private readonly unpaywall: UnpaywallClient | null;
  private readonly minTitleLen: number;
  private readonly logger: { warn: (msg: string, extra?: Record<string, unknown>) => void };

  constructor(opts: BiblioResolverAdapterOptions) {
    this.openalex = opts.openalex ?? null;
    this.crossref = opts.crossref ?? null;
    this.unpaywall = opts.unpaywall ?? null;
    this.version = opts.version ?? DEFAULT_VERSION;
    this.minTitleLen = opts.minTitleLength ?? DEFAULT_MIN_TITLE;
    this.logger = opts.logger ?? defaultLogger;
    if (!this.openalex && !this.crossref) {
      throw new Error(
        "BiblioResolverAdapter requires at least one of openalex/crossref",
      );
    }
  }

  async resolve(ref: RefString): Promise<ResolvedReference | null> {
    const doi = extractDoi(ref);

    if (doi) {
      const oaByDoi = await this.tryOpenAlexByDoi(doi);
      if (oaByDoi) return oaByDoi;
      const crByDoi = await this.tryCrossrefByDoi(doi);
      if (crByDoi) return crByDoi;
    }

    const query = ref.trim();
    if (query.length < this.minTitleLen) return null;

    const oaSearch = await this.tryOpenAlexSearch(query);
    if (oaSearch) return oaSearch;
    const crSearch = await this.tryCrossrefSearch(query);
    if (crSearch) return crSearch;
    return null;
  }

  async findOaPdf(ref: ResolvedReference): Promise<OaPdfCandidate | null> {
    if (!ref.doi) {
      if (!ref.openalexId) return null;
      return this.openAlexOaFromWork(ref);
    }

    if (this.unpaywall) {
      try {
        const up = await this.unpaywall.byDoi(ref.doi);
        const loc = up?.best_oa_location ?? up?.oa_locations?.[0] ?? null;
        if (loc?.url_for_pdf) {
          return {
            url: loc.url_for_pdf,
            license: loc.license ?? null,
            version: loc.version ?? null,
            sizeBytes: null,
          };
        }
      } catch (err) {
        this.logger.warn("unpaywall lookup failed", {
          doi: ref.doi,
          error: (err as Error).message,
        });
      }
    }

    return this.openAlexOaFromWork(ref);
  }

  private async openAlexOaFromWork(
    ref: ResolvedReference,
  ): Promise<OaPdfCandidate | null> {
    if (!this.openalex || !ref.doi) return null;
    try {
      const work = await this.openalex.workByDoi(ref.doi);
      const loc = work?.best_oa_location ?? null;
      const url = loc?.pdf_url ?? work?.open_access?.oa_url ?? null;
      if (!url) return null;
      return {
        url,
        license: loc?.license ?? null,
        version: loc?.version ?? null,
        sizeBytes: null,
      };
    } catch (err) {
      this.logger.warn("openalex OA lookup failed", {
        doi: ref.doi,
        error: (err as Error).message,
      });
      return null;
    }
  }

  private async tryOpenAlexByDoi(doi: string): Promise<ResolvedReference | null> {
    if (!this.openalex) return null;
    try {
      const work = await this.openalex.workByDoi(doi);
      return work ? openAlexWorkToResolved(work) : null;
    } catch (err) {
      this.logger.warn("openalex byDoi failed", {
        doi,
        error: (err as Error).message,
      });
      return null;
    }
  }

  private async tryCrossrefByDoi(doi: string): Promise<ResolvedReference | null> {
    if (!this.crossref) return null;
    try {
      const work = await this.crossref.workByDoi(doi);
      return work ? crossrefWorkToResolved(work) : null;
    } catch (err) {
      this.logger.warn("crossref byDoi failed", {
        doi,
        error: (err as Error).message,
      });
      return null;
    }
  }

  private async tryOpenAlexSearch(query: string): Promise<ResolvedReference | null> {
    if (!this.openalex) return null;
    let results: OpenAlexWork[] = [];
    try {
      results = await this.openalex.searchByBibliographic(query, 3);
    } catch (err) {
      this.logger.warn("openalex search failed", {
        error: (err as Error).message,
      });
      return null;
    }
    for (const w of results) {
      const resolved = openAlexWorkToResolved(w);
      if (looksLikeGoodTitle(resolved, query, this.minTitleLen)) return resolved;
    }
    return null;
  }

  private async tryCrossrefSearch(query: string): Promise<ResolvedReference | null> {
    if (!this.crossref) return null;
    let items: CrossrefWork[] = [];
    try {
      items = await this.crossref.searchBibliographic(query, 3);
    } catch (err) {
      this.logger.warn("crossref search failed", {
        error: (err as Error).message,
      });
      return null;
    }
    for (const w of items) {
      const resolved = crossrefWorkToResolved(w);
      if (looksLikeGoodTitle(resolved, query, this.minTitleLen)) return resolved;
    }
    return null;
  }
}
