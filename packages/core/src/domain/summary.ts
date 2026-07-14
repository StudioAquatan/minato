import type { PaperId } from "./ids.js";

export type SummaryPayload = {
  researchQuestion: string;
  method: string;
  keyFindings: string[];
  limitations: string[];
  positioning: string;
  keywords: string[];
};

export type StoredSummary = {
  paperId: PaperId;
  provider: string;
  model: string;
  promptVersion: string;
  sourceContentHash: string;
  lang: string;
  payload: SummaryPayload;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: Date;
};
