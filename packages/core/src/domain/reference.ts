import type { ChunkId, PaperId, ReferenceId } from "./ids.js";

export type RefString = string;

export type ReferenceRecord = {
  id: ReferenceId;
  paperId: PaperId;
  ordinal: number;
  raw: RefString;
  doi: string | null;
  title: string | null;
  authorsHint: string | null;
  year: number | null;
  resolvedPaperId: PaperId | null;
  resolveState: "unresolved" | "resolved" | "ambiguous" | "manual";
  resolveScore: number | null;
  resolverVersion: string | null;
};

export type CitationEdge = {
  fromPaperId: PaperId;
  toPaperId: PaperId;
  contextChunkId: ChunkId | null;
  snippet: string | null;
  marker: string | null;
  confidence: number | null;
};

export type LineageQuery = {
  seedPaperIds: PaperId[];
  direction: "ancestors" | "descendants" | "both";
  maxHops: number;
  maxNodes: number;
};

export type LineageGraph = {
  nodes: PaperId[];
  edges: CitationEdge[];
};

export type ResolvedReference = {
  doi: string | null;
  openalexId: string | null;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
};

export type OaPdfCandidate = {
  url: string;
  license: string | null;
  version: string | null;
  sizeBytes: number | null;
};

export type PaperMatchResult =
  | { kind: "resolved"; paperId: PaperId; score: number }
  | { kind: "ambiguous"; candidates: { paperId: PaperId; score: number }[] }
  | { kind: "unresolved" };
