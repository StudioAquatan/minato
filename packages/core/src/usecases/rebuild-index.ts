import type {
  IndexGeneration,
  IndexGenerationId,
  PaperId,
  RebuildOptions,
  RebuildResult,
} from "../domain/index.js";
import type { Deps } from "./types.js";

export const rebuildIndex = async (
  deps: Deps,
  options: RebuildOptions,
): Promise<RebuildResult> => {
  const startedAt = deps.clock.now();
  const id = deps.idGen.newId("idxgen") as IndexGenerationId;
  const gen: IndexGeneration = {
    id,
    embeddingModel: options.embeddingModel ?? deps.embedder.modelKey,
    embeddingRevision: null,
    documentTemplateVersion:
      options.documentTemplateVersion ?? "template-v1",
    chunkerVersion: options.chunkerVersion ?? deps.chunker.version,
    parserVersion: deps.parser.parserVersion,
    startedAt,
    finishedAt: null,
    targetCount: null,
    successCount: 0,
    failureCount: 0,
    active: false,
  };
  await deps.indexGens.create(gen);

  await deps.indexAdmin.clear();

  let chunksIndexed = 0;
  const failedPapers: PaperId[] = [];
  let papersIndexed = 0;
  const pageSize = 100;
  let offset = 0;
  while (true) {
    const papers =
      options.paperIds && options.paperIds.length
        ? await deps.papers.getMany(options.paperIds)
        : await deps.papers.listAll(pageSize, offset);
    if (papers.length === 0) break;
    for (const paper of papers) {
      try {
        const chunks = await deps.chunks.listForPaper(paper.id);
        if (chunks.length === 0) continue;
        await deps.indexAdmin.upsertPaper(paper, chunks);
        chunksIndexed += chunks.length;
        papersIndexed += 1;
      } catch (err) {
        failedPapers.push(paper.id);
        console.error(`rebuild failed for ${paper.id}:`, err);
      }
    }
    if (options.paperIds) break;
    if (papers.length < pageSize) break;
    offset += papers.length;
  }

  const finishedAt = deps.clock.now();
  await deps.indexGens.markFinished(id, {
    finishedAt,
    successCount: chunksIndexed,
    failureCount: failedPapers.length,
    active: true,
  });
  await deps.indexGens.deactivateOthers(id);

  return {
    generationId: id,
    chunksIndexed,
    papersIndexed,
    failedPapers,
    startedAt,
    finishedAt,
  };
};
