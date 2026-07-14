import type {
  Chunk,
  IndexState,
  Paper,
  PaperId,
  RebuildOptions,
  RebuildResult,
  SearchFilters,
  SearchHit,
  SearchOptions,
} from "../domain/index.js";

export interface SearchIndex {
  hybridSearch(
    query: string,
    options: SearchOptions,
  ): Promise<SearchHit[]>;
  facetByYear(
    query: string,
    filters: SearchFilters,
  ): Promise<Record<number, number>>;
}

export interface IndexAdmin {
  upsertPaper(paper: Paper, chunks: Chunk[]): Promise<void>;
  deletePaper(paperId: PaperId): Promise<void>;
  clear(): Promise<void>;
  getState(): Promise<IndexState>;
}

export type { RebuildOptions, RebuildResult };
