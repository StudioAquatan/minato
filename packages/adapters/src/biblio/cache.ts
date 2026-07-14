import type { ExternalApiCacheRepository } from "../db/postgres/external-api-cache-repository.js";

export interface BiblioCache {
  get<T>(cacheKey: string): Promise<T | null>;
  put(
    cacheKey: string,
    provider: string,
    endpoint: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void>;
}

export class DbBiblioCache implements BiblioCache {
  constructor(private readonly repo: ExternalApiCacheRepository) {}

  async get<T>(cacheKey: string): Promise<T | null> {
    const entry = await this.repo.get(cacheKey);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt.getTime() < Date.now()) {
      return null;
    }
    return entry.responseJson as T;
  }

  async put(
    cacheKey: string,
    provider: string,
    endpoint: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    const now = new Date();
    const expiresAt =
      ttlSeconds > 0 ? new Date(now.getTime() + ttlSeconds * 1000) : null;
    await this.repo.put({
      cacheKey,
      provider,
      endpoint,
      responseJson: value ?? null,
      etag: null,
      fetchedAt: now,
      expiresAt,
    });
  }
}

export class NullBiblioCache implements BiblioCache {
  async get<T>(_key: string): Promise<T | null> {
    return null;
  }
  async put(): Promise<void> {}
}
