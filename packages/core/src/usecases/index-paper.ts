import type { PaperId } from "../domain/index.js";
import type { Deps } from "./types.js";

export type IndexPaperInput = { paperId: PaperId };

export type IndexPaperOutput = {
  chunksIndexed: number;
};

export const indexPaper = async (
  deps: Deps,
  input: IndexPaperInput,
): Promise<IndexPaperOutput> => {
  const paper = await deps.papers.get(input.paperId);
  if (!paper) {
    throw new Error(`paper not found: ${input.paperId}`);
  }
  const chunks = await deps.chunks.listForPaper(input.paperId);
  if (chunks.length === 0) {
    await deps.indexAdmin.deletePaper(input.paperId);
    return { chunksIndexed: 0 };
  }
  await deps.indexAdmin.upsertPaper(paper, chunks);
  return { chunksIndexed: chunks.length };
};
