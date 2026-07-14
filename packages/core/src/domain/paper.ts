import type { FileId, PaperId } from "./ids.js";

export type PaperStatus =
  | "ghost"
  | "ingesting"
  | "ready"
  | "failed"
  | "deleted";

export type Author = {
  fullName: string;
  givenName?: string;
  familyName?: string;
  affiliations?: string[];
  orcid?: string;
};

export type Paper = {
  id: PaperId;
  doi: string | null;
  openalexId: string | null;
  title: string;
  titleJa: string | null;
  authors: Author[];
  year: number | null;
  venue: string | null;
  lang: string;
  status: PaperStatus;
  currentFileId: FileId | null;
  source: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type GhostPaper = Paper & { status: "ghost" };

export type GhostQuery = {
  limit?: number;
  offset?: number;
};

export type PaperMatchQuery = {
  doi?: string;
  title: string;
  authors?: Author[];
  year?: number;
};

export type PaperMatchCandidate = {
  paperId: PaperId;
  score: number;
  reasons: string[];
};
