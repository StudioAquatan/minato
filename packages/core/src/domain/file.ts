import type { FileId, PaperId } from "./ids.js";

export type PaperFile = {
  id: FileId;
  paperId: PaperId | null;
  relativePath: string;
  sha256: string;
  byteSize: number;
  mimeType: string;
  source: string | null;
  createdAt: Date;
};
