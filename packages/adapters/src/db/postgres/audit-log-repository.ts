import { randomUUID } from "node:crypto";
import type { AuditEntry, AuditLogRepository } from "@minato/core";
import type { Db } from "./client.js";
import { toolAuditLogs } from "./schema.js";

export const makeAuditLogRepository = (db: Db): AuditLogRepository => ({
  async append(entry: AuditEntry) {
    await db.insert(toolAuditLogs).values({
      id: `audit_${randomUUID()}`,
      sessionId: entry.sessionId,
      runId: entry.runId,
      actor: entry.actor,
      provider: entry.provider,
      model: entry.model,
      toolName: entry.toolName,
      args: entry.args,
      resultSummary: entry.resultSummary,
      success: entry.success,
      startedAt: entry.startedAt,
      finishedAt: entry.finishedAt,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      estimatedCostUsd: entry.estimatedCostUsd,
      approvalId: entry.approvalId,
      jobId: entry.jobId,
    });
  },
});
