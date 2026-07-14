import type { BiblioCache } from "./cache.js";
import { LimitedFetcher } from "./http.js";

export type UnpaywallClientOptions = {
  baseUrl?: string;
  email: string;
  concurrency?: number;
  requestTimeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  cache?: BiblioCache;
  cacheTtlSeconds?: number;
  userAgent?: string;
};

export type UnpaywallOaLocation = {
  url_for_pdf?: string | null;
  url?: string | null;
  license?: string | null;
  version?: string | null;
  host_type?: string | null;
};

export type UnpaywallWork = {
  doi?: string | null;
  is_oa?: boolean;
  best_oa_location?: UnpaywallOaLocation | null;
  oa_locations?: UnpaywallOaLocation[] | null;
};

const DEFAULT_BASE = "https://api.unpaywall.org";
const DEFAULT_TTL_S = 60 * 60 * 24 * 30;

const stripDoi = (doi: string): string =>
  doi
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:/, "");

export class UnpaywallClient {
  private readonly baseUrl: string;
  private readonly email: string;
  private readonly http: LimitedFetcher;
  private readonly cache: BiblioCache | null;
  private readonly ttl: number;

  constructor(opts: UnpaywallClientOptions) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    this.email = opts.email;
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

  async byDoi(doi: string): Promise<UnpaywallWork | null> {
    const normalized = stripDoi(doi);
    if (!normalized) return null;
    const cacheKey = `unpaywall:doi:${normalized}`;
    if (this.cache) {
      const cached = await this.cache.get<UnpaywallWork | null>(cacheKey);
      if (cached !== null) return cached;
    }
    const url = new URL(`${this.baseUrl}/v2/${encodeURIComponent(normalized)}`);
    url.searchParams.set("email", this.email);
    const body = await this.http.fetchJson<UnpaywallWork | null>(url.toString());
    const value = body ?? null;
    if (this.cache) {
      await this.cache.put(cacheKey, "unpaywall", "v2/doi", value, this.ttl);
    }
    return value;
  }
}
