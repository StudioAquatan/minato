import { eq, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { externalApiCache } from "./schema.js";

export type ExternalApiCacheEntry = {
  cacheKey: string;
  provider: string;
  endpoint: string;
  responseJson: unknown;
  etag: string | null;
  fetchedAt: Date;
  expiresAt: Date | null;
};

export interface ExternalApiCacheRepository {
  get(cacheKey: string): Promise<ExternalApiCacheEntry | null>;
  put(entry: ExternalApiCacheEntry): Promise<void>;
  purgeExpired(now: Date): Promise<number>;
}

export const makeExternalApiCacheRepository = (
  db: Db,
): ExternalApiCacheRepository => ({
  async get(cacheKey) {
    const rows = await db
      .select()
      .from(externalApiCache)
      .where(eq(externalApiCache.cacheKey, cacheKey))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      cacheKey: row.cacheKey,
      provider: row.provider,
      endpoint: row.endpoint,
      responseJson: row.responseJson,
      etag: row.etag,
      fetchedAt: row.fetchedAt,
      expiresAt: row.expiresAt,
    };
  },

  async put(entry) {
    await db
      .insert(externalApiCache)
      .values({
        cacheKey: entry.cacheKey,
        provider: entry.provider,
        endpoint: entry.endpoint,
        responseJson: entry.responseJson,
        etag: entry.etag,
        fetchedAt: entry.fetchedAt,
        expiresAt: entry.expiresAt,
      })
      .onConflictDoUpdate({
        target: externalApiCache.cacheKey,
        set: {
          provider: entry.provider,
          endpoint: entry.endpoint,
          responseJson: entry.responseJson,
          etag: entry.etag,
          fetchedAt: entry.fetchedAt,
          expiresAt: entry.expiresAt,
        },
      });
  },

  async purgeExpired(now) {
    const result = await db
      .delete(externalApiCache)
      .where(sql`${externalApiCache.expiresAt} is not null and ${externalApiCache.expiresAt} < ${now}`)
      .returning({ cacheKey: externalApiCache.cacheKey });
    return result.length;
  },
});
