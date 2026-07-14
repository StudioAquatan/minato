import { rebuildIndex } from "@minato/core";
import type { CliRuntime } from "../bootstrap.js";

export const reindexCommand = async (
  runtime: CliRuntime,
): Promise<void> => {
  console.log("rebuilding index...");
  const result = await rebuildIndex(runtime.deps, {});
  console.log(
    `done. generation=${result.generationId} papers=${result.papersIndexed} chunks=${result.chunksIndexed} failed=${result.failedPapers.length} took=${(result.finishedAt.getTime() - result.startedAt.getTime()) / 1000}s`,
  );
};
