import type {
  CitationEdge,
  JobSpec,
  PaperId,
} from "../domain/index.js";
import type { Deps } from "./types.js";

export type BuildCitationEdgesInput = {
  paperId: PaperId;
};

export type BuildCitationEdgesOutput = {
  paperId: PaperId;
  edgeCount: number;
  skippedUnresolved: number;
  skippedSelf: number;
  followUp: JobSpec[];
};

export const buildCitationEdges = async (
  deps: Deps,
  input: BuildCitationEdgesInput,
): Promise<BuildCitationEdgesOutput> => {
  const { citations } = deps;
  if (!citations) {
    return {
      paperId: input.paperId,
      edgeCount: 0,
      skippedUnresolved: 0,
      skippedSelf: 0,
      followUp: [],
    };
  }

  const refs = await citations.listReferencesForPaper(input.paperId);
  const edgesByTarget = new Map<PaperId, CitationEdge>();
  let skippedUnresolved = 0;
  let skippedSelf = 0;

  for (const ref of refs) {
    if (!ref.resolvedPaperId) {
      skippedUnresolved += 1;
      continue;
    }
    if (ref.resolvedPaperId === input.paperId) {
      skippedSelf += 1;
      continue;
    }
    const existing = edgesByTarget.get(ref.resolvedPaperId);
    const confidence = ref.resolveScore;
    if (existing) {
      if (
        confidence != null &&
        (existing.confidence == null || confidence > existing.confidence)
      ) {
        existing.confidence = confidence;
      }
      continue;
    }
    edgesByTarget.set(ref.resolvedPaperId, {
      fromPaperId: input.paperId,
      toPaperId: ref.resolvedPaperId,
      contextChunkId: null,
      snippet: null,
      marker: null,
      confidence,
    });
  }

  const edges = [...edgesByTarget.values()];
  if (edges.length > 0) {
    await citations.upsertEdges(edges);
  }

  return {
    paperId: input.paperId,
    edgeCount: edges.length,
    skippedUnresolved,
    skippedSelf,
    followUp: [],
  };
};
