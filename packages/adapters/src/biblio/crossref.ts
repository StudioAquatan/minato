import type { ResolvedReference } from "@minato/core";
import type { BiblioCache } from "./cache.js";
import { LimitedFetcher } from "./http.js";

export type CrossrefClientOptions = {
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

export type CrossrefAuthor = {
  given?: string | null;
  family?: string | null;
  name?: string | null;
};

export type CrossrefWork = {
  DOI?: string | null;
  title?: string[] | null;
  author?: CrossrefAuthor[] | null;
  issued?: { "date-parts"?: number[][] | null } | null;
  published?: { "date-parts"?: number[][] | null } | null;
  "container-title"?: string[] | null;
};

const DEFAULT_BASE = "https://api.crossref.org";
const DEFAULT_TTL_S = 60 * 60 * 24 * 30;

const stripDoi = (doi: string): string =>
  doi
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:/, "");

const firstYearFromDateParts = (
  parts: number[][] | null | undefined,
): number | null => {
  const first = parts?.[0]?.[0];
  return typeof first === "number" && Number.isFinite(first) ? first : null;
};

const authorName = (a: CrossrefAuthor): string | null => {
  if (a.name && a.name.trim().length > 0) return a.name.trim();
  const parts = [a.given, a.family].filter(
    (s): s is string => !!s && s.trim().length > 0,
  );
  const joined = parts.join(" ").trim();
  return joined.length > 0 ? joined : null;
};

export class CrossrefClient {
  private readonly baseUrl: string;
  private readonly mailto: string | null;
  private readonly http: LimitedFetcher;
  private readonly cache: BiblioCache | null;
  private readonly ttl: number;

  constructor(opts: CrossrefClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    this.mailto = opts.mailto ?? null;
    const ua = opts.userAgent ?? "minato-biblio/0.1";
    this.http = new LimitedFetcher({
      concurrency: opts.concurrency ?? 4,
      requestTimeoutMs: opts.requestTimeoutMs ?? 15_000,
      maxRetries: opts.maxRetries ?? 3,
      ...(opts.fetch ? { fetchImpl: opts.fetch } : {}),
      userAgent: this.mailto ? `${ua} (mailto:${this.mailto})` : ua,
    });
    this.cache = opts.cache ?? null;
    this.ttl = opts.cacheTtlSeconds ?? DEFAULT_TTL_S;
  }

  async workByDoi(doi: string): Promise<CrossrefWork | null> {
    const normalized = stripDoi(doi);
    if (!normalized) return null;
    const cacheKey = `crossref:doi:${normalized}`;
    if (this.cache) {
      const cached = await this.cache.get<CrossrefWork | null>(cacheKey);
      if (cached !== null) return cached;
    }
    const url = new URL(`${this.baseUrl}/works/${encodeURIComponent(normalized)}`);
    const body = await this.http.fetchJson<{ message?: CrossrefWork } | null>(
      url.toString(),
    );
    const value = body?.message ?? null;
    if (this.cache) await this.cache.put(cacheKey, "crossref", "works/doi", value, this.ttl);
    return value;
  }

  async searchBibliographic(query: string, rows = 3): Promise<CrossrefWork[]> {
    if (!query.trim()) return [];
    const cacheKey = `crossref:search:${rows}:${query.trim().slice(0, 200)}`;
    if (this.cache) {
      const cached = await this.cache.get<CrossrefWork[] | null>(cacheKey);
      if (cached !== null) return cached ?? [];
    }
    const url = new URL(`${this.baseUrl}/works`);
    url.searchParams.set("query.bibliographic", query);
    url.searchParams.set("rows", String(Math.max(1, Math.min(20, rows))));
    const body = await this.http.fetchJson<{
      message?: { items?: CrossrefWork[] };
    } | null>(url.toString());
    const items = body?.message?.items ?? [];
    if (this.cache) await this.cache.put(cacheKey, "crossref", "works/search", items, this.ttl);
    return items;
  }
}

export const crossrefWorkToResolved = (
  work: CrossrefWork,
): ResolvedReference => {
  const title = work.title?.[0] ?? "";
  const doi = work.DOI ? stripDoi(work.DOI) : null;
  const authors = (work.author ?? [])
    .map(authorName)
    .filter((n): n is string => n !== null);
  const year =
    firstYearFromDateParts(work.issued?.["date-parts"] ?? null) ??
    firstYearFromDateParts(work.published?.["date-parts"] ?? null);
  const venue = work["container-title"]?.[0] ?? null;
  return {
    doi,
    openalexId: null,
    title,
    authors,
    year,
    venue,
  };
};
