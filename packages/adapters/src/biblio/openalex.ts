import type { ResolvedReference } from "@minato/core";
import type { BiblioCache } from "./cache.js";
import { LimitedFetcher } from "./http.js";

export type OpenAlexClientOptions = {
  baseUrl?: string;
  mailto?: string;
  concurrency?: number;
  requestTimeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  cache?: BiblioCache;
  cacheTtlSeconds?: number;
  userAgent?: string;
};

export type OpenAlexOaLocation = {
  is_oa?: boolean;
  pdf_url?: string | null;
  license?: string | null;
  version?: string | null;
  landing_page_url?: string | null;
};

export type OpenAlexWork = {
  id: string;
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  authorships?: Array<{
    author?: { display_name?: string | null } | null;
  }> | null;
  host_venue?: { display_name?: string | null } | null;
  primary_location?: {
    source?: { display_name?: string | null } | null;
  } | null;
  best_oa_location?: OpenAlexOaLocation | null;
  open_access?: {
    is_oa?: boolean;
    oa_url?: string | null;
    oa_status?: string | null;
  } | null;
};

const DEFAULT_BASE = "https://api.openalex.org";
const DEFAULT_TTL_S = 60 * 60 * 24 * 30;

const stripDoi = (doi: string): string => {
  return doi
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:/, "");
};

export class OpenAlexClient {
  private readonly baseUrl: string;
  private readonly mailto: string | null;
  private readonly http: LimitedFetcher;
  private readonly cache: BiblioCache | null;
  private readonly ttl: number;

  constructor(opts: OpenAlexClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    this.mailto = opts.mailto ?? null;
    this.http = new LimitedFetcher({
      concurrency: opts.concurrency ?? 4,
      requestTimeoutMs: opts.requestTimeoutMs ?? 15_000,
      maxRetries: opts.maxRetries ?? 3,
      ...(opts.fetch ? { fetchImpl: opts.fetch } : {}),
      userAgent: opts.userAgent ?? "minato-biblio/0.1",
    });
    this.cache = opts.cache ?? null;
    this.ttl = opts.cacheTtlSeconds ?? DEFAULT_TTL_S;
  }

  private appendMailto(url: URL) {
    if (this.mailto) url.searchParams.set("mailto", this.mailto);
  }

  async workByDoi(doi: string): Promise<OpenAlexWork | null> {
    const normalized = stripDoi(doi);
    if (!normalized) return null;
    const cacheKey = `openalex:doi:${normalized}`;
    if (this.cache) {
      const cached = await this.cache.get<OpenAlexWork | null>(cacheKey);
      if (cached !== null) return cached;
    }
    const url = new URL(`${this.baseUrl}/works/doi:${encodeURIComponent(normalized)}`);
    this.appendMailto(url);
    const body = await this.http.fetchJson<OpenAlexWork | null>(url.toString());
    const value = body ?? null;
    if (this.cache) await this.cache.put(cacheKey, "openalex", "works/doi", value, this.ttl);
    return value;
  }

  async searchByBibliographic(
    query: string,
    limit = 3,
  ): Promise<OpenAlexWork[]> {
    if (!query.trim()) return [];
    const cacheKey = `openalex:search:${limit}:${query.trim().slice(0, 200)}`;
    if (this.cache) {
      const cached = await this.cache.get<OpenAlexWork[] | null>(cacheKey);
      if (cached !== null) return cached ?? [];
    }
    const url = new URL(`${this.baseUrl}/works`);
    url.searchParams.set("search", query);
    url.searchParams.set("per-page", String(Math.max(1, Math.min(25, limit))));
    this.appendMailto(url);
    const body = await this.http.fetchJson<{ results?: OpenAlexWork[] } | null>(
      url.toString(),
    );
    const results = body?.results ?? [];
    if (this.cache) await this.cache.put(cacheKey, "openalex", "works/search", results, this.ttl);
    return results;
  }
}

export const openAlexWorkToResolved = (
  work: OpenAlexWork,
): ResolvedReference => {
  const title = work.title ?? work.display_name ?? "";
  const doi = work.doi ? stripDoi(work.doi) : null;
  const authors = (work.authorships ?? [])
    .map((a) => a?.author?.display_name ?? null)
    .filter((n): n is string => !!n && n.length > 0);
  const venue =
    work.primary_location?.source?.display_name ??
    work.host_venue?.display_name ??
    null;
  return {
    doi,
    openalexId: work.id ?? null,
    title,
    authors,
    year: work.publication_year ?? null,
    venue,
  };
};
