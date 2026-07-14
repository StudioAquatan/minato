import type { ChunkId, PaperId, SectionId } from "./ids.js";

export type PageBBox = {
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type Section = {
  id: SectionId;
  paperId: PaperId;
  ordinal: number;
  level: number | null;
  title: string | null;
  pageFrom: number;
  pageTo: number;
};

export type Chunk = {
  id: ChunkId;
  paperId: PaperId;
  sectionId: SectionId | null;
  ordinal: number;
  text: string;
  pageFrom: number;
  pageTo: number;
  bboxes: PageBBox[];
  tokenCount: number | null;
  contentHash: string;
  parserVersion: string;
  chunkerVersion: string;
};
