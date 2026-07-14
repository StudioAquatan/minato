import type { ApprovalId, JobId } from "./ids.js";

export type AuditEntry = {
  sessionId: string;
  runId: string | null;
  actor: "user" | "agent" | "system";
  provider: string | null;
  model: string | null;
  toolName: string;
  args: unknown;
  resultSummary: string | null;
  success: boolean;
  startedAt: Date;
  finishedAt: Date;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  approvalId: ApprovalId | null;
  jobId: JobId | null;
};
