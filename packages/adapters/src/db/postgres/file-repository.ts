import { eq } from "drizzle-orm";
import type {
  FileId,
  FileRepository,
  PaperFile,
  PaperId,
} from "@minato/core";
import type { Db } from "./client.js";
import { paperFiles } from "./schema.js";

const toDomain = (row: typeof paperFiles.$inferSelect): PaperFile => ({
  id: row.id as FileId,
  paperId: (row.paperId as PaperId | null) ?? null,
  relativePath: row.relativePath,
  sha256: row.sha256,
  byteSize: row.byteSize,
  mimeType: row.mimeType,
  source: row.source,
  createdAt: row.createdAt,
});

export const makeFileRepository = (db: Db): FileRepository => ({
  async get(id) {
    const rows = await db
      .select()
      .from(paperFiles)
      .where(eq(paperFiles.id, id))
      .limit(1);
    return rows[0] ? toDomain(rows[0]) : null;
  },
  async findByHash(sha256) {
    const rows = await db
      .select()
      .from(paperFiles)
      .where(eq(paperFiles.sha256, sha256))
      .limit(1);
    return rows[0] ? toDomain(rows[0]) : null;
  },
  async upsert(file) {
    await db
      .insert(paperFiles)
      .values({
        id: file.id,
        paperId: file.paperId,
        relativePath: file.relativePath,
        sha256: file.sha256,
        byteSize: file.byteSize,
        mimeType: file.mimeType,
        source: file.source,
        createdAt: file.createdAt,
      })
      .onConflictDoUpdate({
        target: paperFiles.sha256,
        set: {
          relativePath: file.relativePath,
          byteSize: file.byteSize,
          mimeType: file.mimeType,
          paperId: file.paperId,
        },
      });
    return file.id;
  },
});
