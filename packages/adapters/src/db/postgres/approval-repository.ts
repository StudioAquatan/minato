import { eq } from "drizzle-orm";
import type {
  ApprovalActionType,
  ApprovalActor,
  ApprovalId,
  ApprovalRepository,
  ApprovalRequest,
  ApprovalStatus,
  PaperId,
} from "@minato/core";
import type { Db } from "./client.js";
import { approvals } from "./schema.js";

const toDomain = (row: typeof approvals.$inferSelect): ApprovalRequest => ({
  id: row.id as ApprovalId,
  actionType: row.actionType as ApprovalActionType,
  targetPaperId: (row.targetPaperId as PaperId | null) ?? null,
  targetUrl: row.targetUrl,
  reason: row.reason,
  contextSnippet: row.contextSnippet,
  destinationHost: row.destinationHost,
  estimatedSizeBytes: row.estimatedSizeBytes,
  estimatedCostUsd: row.estimatedCostUsd,
  createdBy: row.createdBy as ApprovalActor,
  expiresAt: row.expiresAt,
  status: row.status as ApprovalStatus,
  decidedAt: row.decidedAt,
  decidedBy: row.decidedBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const makeApprovalRepository = (db: Db): ApprovalRepository => ({
  async create(request) {
    await db.insert(approvals).values({
      id: request.id,
      actionType: request.actionType,
      targetPaperId: request.targetPaperId,
      targetUrl: request.targetUrl,
      reason: request.reason,
      contextSnippet: request.contextSnippet,
      destinationHost: request.destinationHost,
      estimatedSizeBytes: request.estimatedSizeBytes,
      estimatedCostUsd: request.estimatedCostUsd,
      createdBy: request.createdBy,
      expiresAt: request.expiresAt,
      status: request.status,
      decidedAt: request.decidedAt,
      decidedBy: request.decidedBy,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    });
    return request.id;
  },
  async get(id) {
    const rows = await db
      .select()
      .from(approvals)
      .where(eq(approvals.id, id))
      .limit(1);
    return rows[0] ? toDomain(rows[0]) : null;
  },
  async listPending() {
    const rows = await db
      .select()
      .from(approvals)
      .where(eq(approvals.status, "pending"));
    return rows.map(toDomain);
  },
  async decide(id, decision) {
    await db
      .update(approvals)
      .set({
        status: decision.outcome,
        decidedAt: new Date(),
        decidedBy: decision.decidedBy,
        updatedAt: new Date(),
      })
      .where(eq(approvals.id, id));
  },
});
