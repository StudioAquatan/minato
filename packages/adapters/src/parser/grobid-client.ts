import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export type GrobidEndpoint =
  | "processFulltextDocument"
  | "processHeaderDocument"
  | "processReferences";

export type GrobidClientOptions = {
  baseUrl: string;
  concurrency?: number;
  requestTimeoutMs?: number;
  maxRetries?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  circuitBreakerFailureThreshold?: number;
  circuitBreakerCooldownMs?: number;
  consolidateHeader?: 0 | 1 | 2;
  consolidateCitations?: 0 | 1 | 2;
  consolidateFunders?: 0 | 1 | 2;
  includeRawCitations?: 0 | 1;
  includeRawAffiliations?: 0 | 1;
  teiCoordinates?: string;
  segmentSentences?: 0 | 1;
  fetch?: typeof fetch;
};

export type GrobidCallOptions = {
  signal?: AbortSignal;
};

export type GrobidRequest = {
  endpoint: GrobidEndpoint;
  fileName: string;
  bytes: Uint8Array;
};

export type GrobidResponse = {
  xml: string;
  status: number;
};

class GrobidCircuitOpenError extends Error {
  constructor(cooldownRemainingMs: number) {
    super(
      `grobid circuit breaker open (cooldown ${cooldownRemainingMs}ms remaining)`,
    );
    this.name = "GrobidCircuitOpenError";
  }
}

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const parseRetryAfter = (headerValue: string | null): number | null => {
  if (!headerValue) return null;
  const asNumber = Number(headerValue);
  if (!Number.isNaN(asNumber)) return Math.max(0, asNumber * 1000);
  const asDate = Date.parse(headerValue);
  if (!Number.isNaN(asDate)) {
    return Math.max(0, asDate - Date.now());
  }
  return null;
};

export class GrobidError extends Error {
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
    this.name = "GrobidError";
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

const jitter = (ms: number) => ms + Math.floor(Math.random() * (ms * 0.25));

/**
 * Minimal semaphore for capping concurrent GROBID requests.
 */
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
    return new Promise<() => void>((resolve) => {
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

export class GrobidClient {
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly cbThreshold: number;
  private readonly cbCooldownMs: number;
  private readonly formDefaults: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly sem: Semaphore;

  private consecutiveFailures = 0;
  private circuitOpenedAt: number | null = null;

  constructor(opts: GrobidClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 5 * 60 * 1000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.initialBackoffMs = opts.initialBackoffMs ?? 1000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 30_000;
    this.cbThreshold = opts.circuitBreakerFailureThreshold ?? 5;
    this.cbCooldownMs = opts.circuitBreakerCooldownMs ?? 60_000;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.sem = new Semaphore(opts.concurrency ?? 4);
    this.formDefaults = {
      consolidateHeader: String(opts.consolidateHeader ?? 0),
      consolidateCitations: String(opts.consolidateCitations ?? 0),
      consolidateFunders: String(opts.consolidateFunders ?? 0),
      includeRawCitations: String(opts.includeRawCitations ?? 1),
      includeRawAffiliations: String(opts.includeRawAffiliations ?? 1),
      teiCoordinates:
        opts.teiCoordinates ?? "biblStruct,ref,persName,figure,formula,s",
      segmentSentences: String(opts.segmentSentences ?? 1),
    };
  }

  async isAlive(callOpts: GrobidCallOptions = {}): Promise<boolean> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    try {
      const signal = mergeSignals(controller.signal, callOpts.signal);
      const res = await this.fetchImpl(`${this.baseUrl}/api/isalive`, {
        method: "GET",
        signal,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(t);
    }
  }

  async processFulltextFromPath(
    absolutePath: string,
    callOpts: GrobidCallOptions = {},
  ): Promise<GrobidResponse> {
    const bytes = await readFile(absolutePath);
    return this.call(
      {
        endpoint: "processFulltextDocument",
        fileName: basename(absolutePath),
        bytes,
      },
      callOpts,
    );
  }

  async processHeaderFromPath(
    absolutePath: string,
    callOpts: GrobidCallOptions = {},
  ): Promise<GrobidResponse> {
    const bytes = await readFile(absolutePath);
    return this.call(
      {
        endpoint: "processHeaderDocument",
        fileName: basename(absolutePath),
        bytes,
      },
      callOpts,
    );
  }

  async processReferencesFromPath(
    absolutePath: string,
    callOpts: GrobidCallOptions = {},
  ): Promise<GrobidResponse> {
    const bytes = await readFile(absolutePath);
    return this.call(
      {
        endpoint: "processReferences",
        fileName: basename(absolutePath),
        bytes,
      },
      callOpts,
    );
  }

  async call(
    req: GrobidRequest,
    callOpts: GrobidCallOptions = {},
  ): Promise<GrobidResponse> {
    this.checkCircuit();
    const release = await this.sem.acquire();
    try {
      return await this.callWithRetry(req, callOpts);
    } finally {
      release();
    }
  }

  private checkCircuit() {
    if (this.circuitOpenedAt === null) return;
    const elapsed = Date.now() - this.circuitOpenedAt;
    if (elapsed >= this.cbCooldownMs) {
      this.circuitOpenedAt = null;
      this.consecutiveFailures = 0;
      return;
    }
    throw new GrobidCircuitOpenError(this.cbCooldownMs - elapsed);
  }

  private recordSuccess() {
    this.consecutiveFailures = 0;
    this.circuitOpenedAt = null;
  }

  private recordFailure() {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.cbThreshold) {
      this.circuitOpenedAt = Date.now();
    }
  }

  private async callWithRetry(
    req: GrobidRequest,
    callOpts: GrobidCallOptions,
  ): Promise<GrobidResponse> {
    let attempt = 0;
    let lastErr: unknown;
    while (attempt <= this.maxRetries) {
      try {
        const res = await this.doRequest(req, callOpts);
        this.recordSuccess();
        return res;
      } catch (err) {
        lastErr = err;
        const isRetryable =
          err instanceof GrobidError ? err.retryable : true;
        if (!isRetryable || attempt === this.maxRetries) {
          this.recordFailure();
          throw err;
        }
        const retryAfterMs =
          err instanceof GrobidError && err.retryAfterMs !== null
            ? err.retryAfterMs
            : null;
        const backoff =
          retryAfterMs !== null
            ? retryAfterMs
            : jitter(
                Math.min(
                  this.maxBackoffMs,
                  this.initialBackoffMs * 2 ** attempt,
                ),
              );
        await delay(backoff);
        attempt += 1;
      }
    }
    this.recordFailure();
    throw lastErr instanceof Error
      ? lastErr
      : new Error("grobid call failed");
  }

  private async doRequest(
    req: GrobidRequest,
    callOpts: GrobidCallOptions,
  ): Promise<GrobidResponse> {
    const form = new FormData();
    const blob = new Blob([toArrayBufferSlice(req.bytes)], {
      type: "application/pdf",
    });
    form.set("input", blob, req.fileName);
    if (req.endpoint === "processFulltextDocument") {
      for (const [k, v] of Object.entries(this.formDefaults)) {
        form.set(k, v);
      }
    } else if (req.endpoint === "processHeaderDocument") {
      form.set("consolidateHeader", this.formDefaults.consolidateHeader);
      form.set(
        "includeRawAffiliations",
        this.formDefaults.includeRawAffiliations,
      );
    } else if (req.endpoint === "processReferences") {
      form.set(
        "consolidateCitations",
        this.formDefaults.consolidateCitations,
      );
      form.set(
        "includeRawCitations",
        this.formDefaults.includeRawCitations,
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.requestTimeoutMs,
    );
    try {
      const signal = mergeSignals(controller.signal, callOpts.signal);
      const res = await this.fetchImpl(
        `${this.baseUrl}/api/${req.endpoint}`,
        {
          method: "POST",
          headers: { Accept: "application/xml" },
          body: form,
          signal,
        },
      );
      if (!res.ok) {
        const retryable = TRANSIENT_STATUS.has(res.status);
        const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
        const text = await safeText(res);
        throw new GrobidError(
          `grobid ${req.endpoint} failed: ${res.status} ${res.statusText} ${text.slice(0, 200)}`,
          res.status,
          retryable,
          retryAfterMs,
        );
      }
      const xml = await res.text();
      return { xml, status: res.status };
    } catch (err) {
      if (err instanceof GrobidError) throw err;
      if ((err as Error)?.name === "AbortError") {
        throw new GrobidError("grobid request aborted (timeout)", null, true);
      }
      throw new GrobidError(
        `grobid transport error: ${(err as Error).message}`,
        null,
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

const safeText = async (res: Response): Promise<string> => {
  try {
    return await res.text();
  } catch {
    return "";
  }
};

const toArrayBufferSlice = (bytes: Uint8Array): ArrayBuffer => {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
};

const mergeSignals = (
  a: AbortSignal,
  b: AbortSignal | undefined,
): AbortSignal => {
  if (!b) return a;
  const controller = new AbortController();
  const forwardA = () => controller.abort(a.reason);
  const forwardB = () => controller.abort(b.reason);
  if (a.aborted) forwardA();
  else a.addEventListener("abort", forwardA, { once: true });
  if (b.aborted) forwardB();
  else b.addEventListener("abort", forwardB, { once: true });
  return controller.signal;
};

export const isGrobidCircuitOpen = (err: unknown): boolean =>
  err instanceof GrobidCircuitOpenError;
