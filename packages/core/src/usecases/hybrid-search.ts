import type { SearchHit, SearchOptions } from "../domain/index.js";
import type { Deps } from "./types.js";

export type HybridSearchInput = {
  query: string;
  filters?: SearchOptions["filters"];
  limit?: number;
  offset?: number;
  semanticRatio?: number;
};

export const hybridSearch = async (
  deps: Deps,
  input: HybridSearchInput,
): Promise<SearchHit[]> => {
  const embedding = input.query.trim()
    ? await deps.embedder.embedQuery(input.query)
    : undefined;
  return deps.searchIndex.hybridSearch(input.query, {
    limit: input.limit ?? 10,
    offset: input.offset ?? 0,
    semanticRatio: input.semanticRatio ?? 0.5,
    ...(input.filters ? { filters: input.filters } : {}),
    ...(embedding ? { embedding } : {}),
  });
};
