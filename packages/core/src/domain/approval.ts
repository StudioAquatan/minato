import type { ApprovalId, PaperId } from "./ids.js";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";

export type ApprovalActor = "user" | "agent" | "system";

export type ApprovalActionType =
  | "download_and_ingest"
  | "external_api_call"
  | "merge_papers"
  | "purge_paper";

export type ApprovalRequest = {
  id: ApprovalId;
  actionType: ApprovalActionType;
  targetPaperId: PaperId | null;
  targetUrl: string | null;
  reason: string;
  contextSnippet: string | null;
  destinationHost: string | null;
  estimatedSizeBytes: number | null;
  estimatedCostUsd: number | null;
  createdBy: ApprovalActor;
  expiresAt: Date | null;
  status: ApprovalStatus;
  decidedAt: Date | null;
  decidedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ApprovalDecision = {
  decidedBy: string;
  outcome: "approved" | "rejected";
  note?: string;
};
