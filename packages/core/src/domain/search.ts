import type { ChunkId, PaperId } from "./ids.js";

export type SearchFilters = {
  lang?: string[];
  yearFrom?: number;
  yearTo?: number;
  paperIds?: PaperId[];
  status?: string[];
};

export type SearchOptions = {
  filters?: SearchFilters;
  limit: number;
  offset?: number;
  semanticRatio?: number;
  embedding?: number[];
};

export type SearchHit = {
  chunkId: ChunkId;
  paperId: PaperId;
  title: string;
  authors: string[];
  year: number | null;
  lang: string;
  sectionTitle: string | null;
  pageFrom: number;
  pageTo: number;
  snippet: string;
  score: number;
};

export type IndexState = {
  activeGenerationId: string | null;
  documentCount: number;
  embeddingModel: string | null;
  updatedAt: Date;
};

export type RebuildOptions = {
  paperIds?: PaperId[];
  embeddingModel?: string;
  chunkerVersion?: string;
  documentTemplateVersion?: string;
};

export type RebuildResult = {
  generationId: string;
  chunksIndexed: number;
  papersIndexed: number;
  failedPapers: PaperId[];
  startedAt: Date;
  finishedAt: Date;
};

export type IndexGeneration = {
  id: string;
  embeddingModel: string;
  embeddingRevision: string | null;
  documentTemplateVersion: string;
  chunkerVersion: string;
  parserVersion: string;
  startedAt: Date;
  finishedAt: Date | null;
  targetCount: number | null;
  successCount: number;
  failureCount: number;
  active: boolean;
};

export type AnswerCitation = {
  paperId: PaperId;
  chunkId: ChunkId;
  pageFrom: number;
  pageTo: number;
  snippet: string;
};
