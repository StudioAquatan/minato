import { and, eq } from "drizzle-orm";
import type {
  PaperId,
  StoredSummary,
  SummaryRepository,
} from "@minato/core";
import type { Db } from "./client.js";
import { summaries } from "./schema.js";

const parseModelKey = (modelKey: string) => {
  const [provider, model, promptVersion, sourceContentHash] =
    modelKey.split(":");
  return {
    provider: provider ?? "",
    model: model ?? "",
    promptVersion: promptVersion ?? "",
    sourceContentHash: sourceContentHash ?? "",
  };
};

const toDomain = (row: typeof summaries.$inferSelect): StoredSummary => ({
  paperId: row.paperId as PaperId,
  provider: row.provider,
  model: row.model,
  promptVersion: row.promptVersion,
  sourceContentHash: row.sourceContentHash,
  lang: row.lang,
  payload: row.payload,
  inputTokens: row.inputTokens,
  outputTokens: row.outputTokens,
  createdAt: row.createdAt,
});

export const makeSummaryRepository = (db: Db): SummaryRepository => ({
  async put(summary) {
    await db
      .insert(summaries)
      .values({
        paperId: summary.paperId,
        provider: summary.provider,
        model: summary.model,
        promptVersion: summary.promptVersion,
        sourceContentHash: summary.sourceContentHash,
        lang: summary.lang,
        payload: summary.payload,
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
        createdAt: summary.createdAt,
      })
      .onConflictDoUpdate({
        target: [
          summaries.paperId,
          summaries.provider,
          summaries.model,
          summaries.promptVersion,
          summaries.sourceContentHash,
        ],
        set: {
          payload: summary.payload,
          inputTokens: summary.inputTokens,
          outputTokens: summary.outputTokens,
        },
      });
  },
  async get(paperId, modelKey) {
    const { provider, model, promptVersion, sourceContentHash } =
      parseModelKey(modelKey);
    const rows = await db
      .select()
      .from(summaries)
      .where(
        and(
          eq(summaries.paperId, paperId),
          eq(summaries.provider, provider),
          eq(summaries.model, model),
          eq(summaries.promptVersion, promptVersion),
          eq(summaries.sourceContentHash, sourceContentHash),
        ),
      )
      .limit(1);
    return rows[0] ? toDomain(rows[0]) : null;
  },
  async listForPaper(paperId) {
    const rows = await db
      .select()
      .from(summaries)
      .where(eq(summaries.paperId, paperId));
    return rows.map(toDomain);
  },
});
