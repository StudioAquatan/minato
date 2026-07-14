import { and, eq, inArray, sql } from "drizzle-orm";
import type {
  CitationEdge,
  CitationRepository,
  LineageGraph,
  LineageQuery,
  PaperId,
  ReferenceRecord,
  ChunkId,
} from "@minato/core";
import type { Db } from "./client.js";
import { citations, referencesTable } from "./schema.js";

export const makeCitationRepository = (db: Db): CitationRepository => ({
  async replaceReferences(paperId, refs: ReferenceRecord[]) {
    await db.transaction(async (tx) => {
      await tx.delete(referencesTable).where(eq(referencesTable.paperId, paperId));
      if (refs.length === 0) return;
      await tx.insert(referencesTable).values(
        refs.map((r) => ({
          id: r.id,
          paperId: r.paperId,
          ordinal: r.ordinal,
          raw: r.raw,
          doi: r.doi,
          title: r.title,
          authorsHint: r.authorsHint,
          year: r.year,
          resolvedPaperId: r.resolvedPaperId,
          resolveState: r.resolveState,
          resolveScore: r.resolveScore,
          resolverVersion: r.resolverVersion,
        })),
      );
    });
  },

  async upsertEdges(edges) {
    if (edges.length === 0) return;
    for (const e of edges) {
      await db
        .insert(citations)
        .values({
          fromPaperId: e.fromPaperId,
          toPaperId: e.toPaperId,
          contextChunkId: e.contextChunkId,
          snippet: e.snippet,
          marker: e.marker,
          confidence: e.confidence,
        })
        .onConflictDoUpdate({
          target: [citations.fromPaperId, citations.toPaperId],
          set: {
            contextChunkId: e.contextChunkId,
            snippet: e.snippet,
            marker: e.marker,
            confidence: e.confidence,
          },
        });
    }
  },

  async findCiting(paperId) {
    const rows = await db
      .select({ to: citations.toPaperId })
      .from(citations)
      .where(eq(citations.fromPaperId, paperId));
    return rows.map((r) => r.to as PaperId);
  },

  async findCitedBy(paperId) {
    const rows = await db
      .select({ from: citations.fromPaperId })
      .from(citations)
      .where(eq(citations.toPaperId, paperId));
    return rows.map((r) => r.from as PaperId);
  },

  async traceLineage(input: LineageQuery): Promise<LineageGraph> {
    if (input.seedPaperIds.length === 0) {
      return { nodes: [], edges: [] };
    }
    const direction = input.direction;
    const maxHops = Math.max(1, Math.min(input.maxHops, 6));
    const maxNodes = Math.max(1, Math.min(input.maxNodes, 5000));
    const seedIds = input.seedPaperIds as string[];

    const expand = async (
      seedCol: "from_paper_id" | "to_paper_id",
      nextCol: "from_paper_id" | "to_paper_id",
    ): Promise<CitationEdge[]> => {
      const res = await db.execute(sql`
        with recursive walk(seed, hop, cur) as (
          select id, 0, id from unnest(${sql.raw("array[")}${sql.join(
            seedIds.map((id) => sql`${id}::text`),
            sql`, `,
          )}${sql.raw("]")}) as id
          union all
          select w.seed, w.hop + 1, c.${sql.raw(nextCol)}
          from walk w
          join citations c on c.${sql.raw(seedCol)} = w.cur
          where w.hop < ${maxHops}
        )
        select distinct c.from_paper_id, c.to_paper_id, c.context_chunk_id,
          c.snippet, c.marker, c.confidence
        from walk w
        join citations c on c.${sql.raw(seedCol)} = w.cur
        limit ${maxNodes}
      `);
      return (res.rows as Array<{
        from_paper_id: string;
        to_paper_id: string;
        context_chunk_id: string | null;
        snippet: string | null;
        marker: string | null;
        confidence: number | null;
      }>).map((r) => ({
        fromPaperId: r.from_paper_id as PaperId,
        toPaperId: r.to_paper_id as PaperId,
        contextChunkId: (r.context_chunk_id as ChunkId | null) ?? null,
        snippet: r.snippet,
        marker: r.marker,
        confidence: r.confidence,
      }));
    };

    const edges: CitationEdge[] = [];
    if (direction === "ancestors" || direction === "both") {
      edges.push(...(await expand("to_paper_id", "from_paper_id")));
    }
    if (direction === "descendants" || direction === "both") {
      edges.push(...(await expand("from_paper_id", "to_paper_id")));
    }

    const nodes = new Set<string>(seedIds);
    for (const e of edges) {
      nodes.add(e.fromPaperId);
      nodes.add(e.toPaperId);
    }
    return {
      nodes: [...nodes].slice(0, maxNodes) as PaperId[],
      edges,
    };
  },
});

// silence unused import warning in phase-1 builds
void and;
void inArray;
