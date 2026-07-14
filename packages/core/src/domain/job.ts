import type { JobId } from "./ids.js";

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "retry_wait"
  | "dead";

export type Lane = string;

export type JobKind =
  | "register_file"
  | "parse_pdf_batch"
  | "persist_document"
  | "resolve_references"
  | "build_citation_edges"
  | "index_paper"
  | "summarize"
  | "rebuild_index";

export type JobSpec = {
  kind: JobKind;
  lane: Lane;
  payload: unknown;
  idempotencyKey: string;
  maxAttempts?: number;
  runAt?: Date;
  priority?: number;
};

export type Job = {
  id: JobId;
  kind: JobKind;
  lane: Lane;
  status: JobStatus;
  payload: unknown;
  idempotencyKey: string;
  attempts: number;
  maxAttempts: number;
  priority: number;
  runAt: Date;
  claimedBy: string | null;
  claimedAt: Date | null;
  heartbeatAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type JobResult = {
  output?: unknown;
  followUp?: JobSpec[];
};

export type JobError = {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
};
