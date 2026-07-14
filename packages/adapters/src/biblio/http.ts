import { setTimeout as delay } from "node:timers/promises";

export type HttpFetch = typeof fetch;

export class HttpError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  constructor(
    message: string,
    status: number | null,
    retryable: boolean,
    retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];
  constructor(permits: number) {
    this.permits = Math.max(1, permits);
  }
  async acquire(): Promise<() => void> {
    if (this.permits > 0) {
      this.permits -= 1;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.permits -= 1;
        resolve(() => this.release());
      });
    });
  }
  private release() {
    this.permits += 1;
    const next = this.queue.shift();
    if (next) next();
  }
}

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const parseRetryAfter = (v: string | null): number | null => {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isNaN(n)) return Math.max(0, n * 1000);
  const d = Date.parse(v);
  if (!Number.isNaN(d)) return Math.max(0, d - Date.now());
  return null;
};

const jitter = (ms: number) => ms + Math.floor(Math.random() * (ms * 0.25));

export type LimitedFetcherOptions = {
  concurrency?: number;
  requestTimeoutMs?: number;
  maxRetries?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  fetchImpl?: HttpFetch;
  userAgent?: string;
};

export class LimitedFetcher {
  private readonly sem: Semaphore;
  private readonly fetchImpl: HttpFetch;
  private readonly requestTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly userAgent: string | null;

  constructor(opts: LimitedFetcherOptions = {}) {
    this.sem = new Semaphore(opts.concurrency ?? 4);
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 15_000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.initialBackoffMs = opts.initialBackoffMs ?? 500;
    this.maxBackoffMs = opts.maxBackoffMs ?? 10_000;
    this.userAgent = opts.userAgent ?? null;
  }

  async fetchJson<T>(
    url: string,
    init: RequestInit = {},
    parse?: (raw: unknown) => T,
  ): Promise<T> {
    const release = await this.sem.acquire();
    try {
      const body = await this.callWithRetry(url, init);
      return parse ? parse(body) : (body as T);
    } finally {
      release();
    }
  }

  private async callWithRetry(url: string, init: RequestInit): Promise<unknown> {
    let attempt = 0;
    let lastErr: unknown;
    while (attempt <= this.maxRetries) {
      try {
        return await this.doRequest(url, init);
      } catch (err) {
        lastErr = err;
        const retryable = err instanceof HttpError ? err.retryable : true;
        if (!retryable || attempt === this.maxRetries) throw err;
        const retryAfter =
          err instanceof HttpError && err.retryAfterMs != null
            ? err.retryAfterMs
            : null;
        const backoff =
          retryAfter ??
          jitter(
            Math.min(this.maxBackoffMs, this.initialBackoffMs * 2 ** attempt),
          );
        await delay(backoff);
        attempt += 1;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("http call failed");
  }

  private async doRequest(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const headers = new Headers(init.headers);
    headers.set("Accept", headers.get("Accept") ?? "application/json");
    if (this.userAgent && !headers.has("User-Agent")) {
      headers.set("User-Agent", this.userAgent);
    }
    try {
      const res = await this.fetchImpl(url, {
        ...init,
        headers,
        signal: controller.signal,
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        const retryable = TRANSIENT_STATUS.has(res.status);
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
        const text = await safeText(res);
        throw new HttpError(
          `http ${res.status} ${res.statusText} ${text.slice(0, 200)}`,
          res.status,
          retryable,
          retryAfter,
        );
      }
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json") || ct.includes("+json") || ct.length === 0) {
        return await res.json();
      }
      return await res.text();
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if ((err as Error)?.name === "AbortError") {
        throw new HttpError("http request aborted (timeout)", null, true);
      }
      throw new HttpError(
        `http transport error: ${(err as Error).message}`,
        null,
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

const safeText = async (res: Response) => {
  try {
    return await res.text();
  } catch {
    return "";
  }
};
