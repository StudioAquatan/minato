import { asc, eq, inArray, sql } from "drizzle-orm";
import type {
  Chunk,
  ChunkId,
  ChunkRepository,
  PaperId,
  SectionId,
} from "@minato/core";
import type { Db } from "./client.js";
import { chunks } from "./schema.js";

const toDomain = (row: typeof chunks.$inferSelect): Chunk => ({
  id: row.id as ChunkId,
  paperId: row.paperId as PaperId,
  sectionId: (row.sectionId as SectionId | null) ?? null,
  ordinal: row.ordinal,
  text: row.text,
  pageFrom: row.pageFrom,
  pageTo: row.pageTo,
  bboxes: row.bboxJson ?? [],
  tokenCount: row.tokenCount,
  contentHash: row.contentHash,
  parserVersion: row.parserVersion,
  chunkerVersion: row.chunkerVersion,
});

export const makeChunkRepository = (db: Db): ChunkRepository => ({
  async replaceForPaper(paperId, list) {
    await db.transaction(async (tx) => {
      await tx.delete(chunks).where(eq(chunks.paperId, paperId));
      if (list.length === 0) return;
      const rows = list.map((c) => ({
        id: c.id,
        paperId: c.paperId,
        sectionId: c.sectionId,
        ordinal: c.ordinal,
        text: c.text,
        pageFrom: c.pageFrom,
        pageTo: c.pageTo,
        bboxJson: c.bboxes,
        tokenCount: c.tokenCount,
        contentHash: c.contentHash,
        parserVersion: c.parserVersion,
        chunkerVersion: c.chunkerVersion,
      }));
      const CHUNK_INSERT_BATCH = 500;
      for (let i = 0; i < rows.length; i += CHUNK_INSERT_BATCH) {
        await tx.insert(chunks).values(rows.slice(i, i + CHUNK_INSERT_BATCH));
      }
    });
  },
  async get(id) {
    const rows = await db
      .select()
      .from(chunks)
      .where(eq(chunks.id, id))
      .limit(1);
    return rows[0] ? toDomain(rows[0]) : null;
  },
  async getMany(ids) {
    if (ids.length === 0) return [];
    const rows = await db
      .select()
      .from(chunks)
      .where(inArray(chunks.id, ids as string[]));
    return rows.map(toDomain);
  },
  async listForPaper(paperId) {
    const rows = await db
      .select()
      .from(chunks)
      .where(eq(chunks.paperId, paperId))
      .orderBy(asc(chunks.ordinal));
    return rows.map(toDomain);
  },
  async deleteForPaper(paperId) {
    await db.delete(chunks).where(eq(chunks.paperId, paperId));
  },
  async countAll() {
    const row = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(chunks);
    return row[0]?.count ?? 0;
  },
  async *streamAll(batchSize: number) {
    let offset = 0;
    while (true) {
      const rows = await db
        .select()
        .from(chunks)
        .orderBy(asc(chunks.paperId), asc(chunks.ordinal))
        .limit(batchSize)
        .offset(offset);
      if (rows.length === 0) return;
      yield rows.map(toDomain);
      if (rows.length < batchSize) return;
      offset += rows.length;
    }
  },
});
