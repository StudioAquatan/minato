import { eq } from "drizzle-orm";
import type {
  PaperId,
  Section,
  SectionId,
  SectionRepository,
} from "@minato/core";
import type { Db } from "./client.js";
import { sections } from "./schema.js";

const toDomain = (row: typeof sections.$inferSelect): Section => ({
  id: row.id as SectionId,
  paperId: row.paperId as PaperId,
  ordinal: row.ordinal,
  level: row.level,
  title: row.title,
  pageFrom: row.pageFrom,
  pageTo: row.pageTo,
});

export const makeSectionRepository = (db: Db): SectionRepository => ({
  async replaceForPaper(paperId, secs) {
    await db.transaction(async (tx) => {
      await tx.delete(sections).where(eq(sections.paperId, paperId));
      if (secs.length === 0) return;
      await tx.insert(sections).values(
        secs.map((s) => ({
          id: s.id,
          paperId: s.paperId,
          ordinal: s.ordinal,
          level: s.level,
          title: s.title,
          pageFrom: s.pageFrom,
          pageTo: s.pageTo,
        })),
      );
    });
  },
  async listForPaper(paperId) {
    const rows = await db
      .select()
      .from(sections)
      .where(eq(sections.paperId, paperId))
      .orderBy(sections.ordinal);
    return rows.map(toDomain);
  },
});
