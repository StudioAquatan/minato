import { and, desc, eq, ne } from "drizzle-orm";
import type {
  IndexGeneration,
  IndexGenerationId,
  IndexGenerationRepository,
} from "@minato/core";
import type { Db } from "./client.js";
import { indexGenerations } from "./schema.js";

const toDomain = (
  row: typeof indexGenerations.$inferSelect,
): IndexGeneration => ({
  id: row.id,
  embeddingModel: row.embeddingModel,
  embeddingRevision: row.embeddingRevision,
  documentTemplateVersion: row.documentTemplateVersion,
  chunkerVersion: row.chunkerVersion,
  parserVersion: row.parserVersion,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt,
  targetCount: row.targetCount,
  successCount: row.successCount,
  failureCount: row.failureCount,
  active: row.active,
});

export const makeIndexGenerationRepository = (
  db: Db,
): IndexGenerationRepository => ({
  async create(gen) {
    await db.insert(indexGenerations).values({
      id: gen.id,
      embeddingModel: gen.embeddingModel,
      embeddingRevision: gen.embeddingRevision,
      documentTemplateVersion: gen.documentTemplateVersion,
      chunkerVersion: gen.chunkerVersion,
      parserVersion: gen.parserVersion,
      startedAt: gen.startedAt,
      finishedAt: gen.finishedAt,
      targetCount: gen.targetCount,
      successCount: gen.successCount,
      failureCount: gen.failureCount,
      active: gen.active,
    });
    return gen.id as IndexGenerationId;
  },
  async markFinished(id, result) {
    await db
      .update(indexGenerations)
      .set({
        finishedAt: result.finishedAt,
        successCount: result.successCount,
        failureCount: result.failureCount,
        active: result.active,
      })
      .where(eq(indexGenerations.id, id));
  },
  async getActive() {
    const rows = await db
      .select()
      .from(indexGenerations)
      .where(eq(indexGenerations.active, true))
      .orderBy(desc(indexGenerations.startedAt))
      .limit(1);
    return rows[0] ? toDomain(rows[0]) : null;
  },
  async list(limit) {
    const rows = await db
      .select()
      .from(indexGenerations)
      .orderBy(desc(indexGenerations.startedAt))
      .limit(limit);
    return rows.map(toDomain);
  },
  async deactivateOthers(id) {
    await db
      .update(indexGenerations)
      .set({ active: false })
      .where(and(ne(indexGenerations.id, id), eq(indexGenerations.active, true)));
  },
});
