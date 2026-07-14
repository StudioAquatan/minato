import { and, eq, inArray, sql } from "drizzle-orm";
import type {
  FileId,
  GhostPaper,
  GhostQuery,
  Paper,
  PaperId,
  PaperMatchCandidate,
  PaperMatchQuery,
  PaperStatus,
} from "@minato/core";
import type { PaperRepository } from "@minato/core";
import type { Db } from "./client.js";
import { papers, chunks } from "./schema.js";

const toDomain = (row: typeof papers.$inferSelect): Paper => ({
  id: row.id as PaperId,
  doi: row.doi,
  openalexId: row.openalexId,
  title: row.title,
  titleJa: row.titleJa,
  authors: row.authorsJson,
  year: row.year,
  venue: row.venue,
  lang: row.lang,
  status: row.status as PaperStatus,
  currentFileId: (row.currentFileId as FileId | null) ?? null,
  source: row.source,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const makePaperRepository = (db: Db): PaperRepository => ({
  async get(id) {
    const rows = await db
      .select()
      .from(papers)
      .where(eq(papers.id, id))
      .limit(1);
    return rows[0] ? toDomain(rows[0]) : null;
  },

  async getMany(ids) {
    if (ids.length === 0) return [];
    const rows = await db
      .select()
      .from(papers)
      .where(inArray(papers.id, ids as string[]));
    return rows.map(toDomain);
  },

  async findByDoi(doi) {
    const rows = await db
      .select()
      .from(papers)
      .where(eq(papers.doi, doi))
      .limit(1);
    return rows[0] ? toDomain(rows[0]) : null;
  },

  async findByContentHash(sha256) {
    const rows = await db
      .select({ paper: papers })
      .from(papers)
      .innerJoin(
        sql`paper_files pf`,
        sql`pf.id = ${papers.currentFileId} and pf.sha256 = ${sha256}`,
      )
      .limit(1);
    if (rows[0]) return toDomain(rows[0].paper);
    return null;
  },

  async findCandidates(input: PaperMatchQuery): Promise<PaperMatchCandidate[]> {
    if (input.doi) {
      const rows = await db
        .select()
        .from(papers)
        .where(eq(papers.doi, input.doi))
        .limit(1);
      return rows.map((r) => ({
        paperId: r.id as PaperId,
        score: 1,
        reasons: ["doi_exact"],
      }));
    }
    const rows = await db
      .select()
      .from(papers)
      .where(sql`lower(${papers.title}) = lower(${input.title})`)
      .limit(10);
    return rows.map((r) => ({
      paperId: r.id as PaperId,
      score: 0.7,
      reasons: ["title_normalized"],
    }));
  },

  async upsert(paper) {
    await db
      .insert(papers)
      .values({
        id: paper.id,
        doi: paper.doi,
        openalexId: paper.openalexId,
        title: paper.title,
        titleJa: paper.titleJa,
        authorsJson: paper.authors,
        year: paper.year,
        venue: paper.venue,
        lang: paper.lang,
        status: paper.status,
        currentFileId: paper.currentFileId,
        source: paper.source,
        createdAt: paper.createdAt,
        updatedAt: paper.updatedAt,
      })
      .onConflictDoUpdate({
        target: papers.id,
        set: {
          doi: paper.doi,
          openalexId: paper.openalexId,
          title: paper.title,
          titleJa: paper.titleJa,
          authorsJson: paper.authors,
          year: paper.year,
          venue: paper.venue,
          lang: paper.lang,
          status: paper.status,
          currentFileId: paper.currentFileId,
          source: paper.source,
          updatedAt: paper.updatedAt,
        },
      });
    return paper.id;
  },

  async updateStatus(id, status) {
    await db
      .update(papers)
      .set({ status, updatedAt: new Date() })
      .where(eq(papers.id, id));
  },

  async updateCurrentFile(id, fileId) {
    await db
      .update(papers)
      .set({ currentFileId: fileId, updatedAt: new Date() })
      .where(eq(papers.id, id));
  },

  async listGhosts(query: GhostQuery) {
    const rows = await db
      .select()
      .from(papers)
      .where(eq(papers.status, "ghost"))
      .limit(query.limit ?? 50)
      .offset(query.offset ?? 0);
    return rows.map(toDomain) as GhostPaper[];
  },

  async listAll(limit, offset) {
    const rows = await db
      .select()
      .from(papers)
      .where(and(sql`${papers.status} <> 'deleted'`))
      .limit(limit)
      .offset(offset);
    return rows.map(toDomain);
  },
});

export const countChunksForPaper = async (
  db: Db,
  paperId: PaperId,
): Promise<number> => {
  const row = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chunks)
    .where(eq(chunks.paperId, paperId));
  return row[0]?.count ?? 0;
};
