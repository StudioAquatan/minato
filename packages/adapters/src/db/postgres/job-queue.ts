import { randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import type {
  Job,
  JobError,
  JobId,
  JobKind,
  JobQueue,
  JobResult,
  JobSpec,
  JobStatus,
  Lane,
} from "@minato/core";
import type { Db } from "./client.js";
import { jobs } from "./schema.js";

const toDomain = (row: typeof jobs.$inferSelect): Job => ({
  id: row.id as JobId,
  kind: row.kind as JobKind,
  lane: row.lane,
  status: row.status as JobStatus,
  payload: row.payload,
  idempotencyKey: row.idempotencyKey,
  attempts: row.attempts,
  maxAttempts: row.maxAttempts,
  priority: row.priority,
  runAt: row.runAt,
  claimedBy: row.claimedBy,
  claimedAt: row.claimedAt,
  heartbeatAt: row.heartbeatAt,
  lastError: row.lastError,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const backoffMs = (attempts: number) => {
  const base = 5_000;
  const capped = Math.min(attempts, 10);
  return base * Math.pow(2, capped);
};

export type JobQueueOptions = {
  defaultMaxAttempts?: number;
};

export const makeJobQueue = (
  db: Db,
  opts: JobQueueOptions = {},
): JobQueue => {
  const defaultMaxAttempts = opts.defaultMaxAttempts ?? 5;

  const enqueueOne = async (spec: JobSpec): Promise<JobId> => {
    const id = `job_${randomUUID()}` as JobId;
    const now = new Date();
    const rows = await db
      .insert(jobs)
      .values({
        id,
        kind: spec.kind,
        lane: spec.lane,
        status: "queued" as JobStatus,
        payload: spec.payload,
        idempotencyKey: spec.idempotencyKey,
        attempts: 0,
        maxAttempts: spec.maxAttempts ?? defaultMaxAttempts,
        priority: spec.priority ?? 0,
        runAt: spec.runAt ?? now,
        claimedBy: null,
        claimedAt: null,
        heartbeatAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: jobs.idempotencyKey })
      .returning({ id: jobs.id });
    if (rows[0]) return rows[0].id as JobId;
    const existing = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.idempotencyKey, spec.idempotencyKey))
      .limit(1);
    return (existing[0]?.id ?? id) as JobId;
  };

  return {
    async enqueue(spec) {
      return enqueueOne(spec);
    },
    async enqueueMany(specs) {
      const ids: JobId[] = [];
      for (const spec of specs) {
        ids.push(await enqueueOne(spec));
      }
      return ids;
    },
    async claimNext(lane: Lane, workerId: string) {
      const now = new Date();
      const result = await db.execute(sql`
        with next as (
          select id
          from jobs
          where lane = ${lane}
            and status = 'queued'
            and run_at <= ${now}
          order by priority desc, run_at asc
          for update skip locked
          limit 1
        )
        update jobs
        set status = 'running',
            claimed_by = ${workerId},
            claimed_at = ${now},
            heartbeat_at = ${now},
            attempts = jobs.attempts + 1,
            updated_at = ${now}
        from next
        where jobs.id = next.id
        returning jobs.*
      `);
      const row = (result.rows as Array<Record<string, unknown>>)[0];
      if (!row) return null;
      return toDomain({
        id: row.id as string,
        kind: row.kind as string,
        lane: row.lane as string,
        status: row.status as string,
        payload: row.payload,
        idempotencyKey: row.idempotency_key as string,
        attempts: row.attempts as number,
        maxAttempts: row.max_attempts as number,
        priority: row.priority as number,
        runAt: row.run_at as Date,
        claimedBy: (row.claimed_by as string | null) ?? null,
        claimedAt: (row.claimed_at as Date | null) ?? null,
        heartbeatAt: (row.heartbeat_at as Date | null) ?? null,
        lastError: (row.last_error as string | null) ?? null,
        createdAt: row.created_at as Date,
        updatedAt: row.updated_at as Date,
      });
    },
    async heartbeat(jobId, workerId) {
      const now = new Date();
      await db
        .update(jobs)
        .set({ heartbeatAt: now, updatedAt: now })
        .where(and(eq(jobs.id, jobId), eq(jobs.claimedBy, workerId)));
    },
    async succeed(jobId, _result: JobResult) {
      const now = new Date();
      await db
        .update(jobs)
        .set({
          status: "succeeded",
          heartbeatAt: now,
          updatedAt: now,
        })
        .where(eq(jobs.id, jobId));
    },
    async fail(jobId, error: JobError) {
      const now = new Date();
      const rows = await db
        .select({
          attempts: jobs.attempts,
          maxAttempts: jobs.maxAttempts,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);
      const attempts = rows[0]?.attempts ?? 0;
      const maxAttempts = rows[0]?.maxAttempts ?? defaultMaxAttempts;
      const shouldRetry = error.retryable && attempts < maxAttempts;
      const nextRunAt = shouldRetry
        ? new Date(
            now.getTime() + (error.retryAfterMs ?? backoffMs(attempts)),
          )
        : now;
      await db
        .update(jobs)
        .set({
          status: shouldRetry ? "queued" : "dead",
          runAt: nextRunAt,
          claimedBy: null,
          claimedAt: null,
          heartbeatAt: null,
          lastError: `${error.code}: ${error.message}`,
          updatedAt: now,
        })
        .where(eq(jobs.id, jobId));
    },
    async recoverStaleJobs(before) {
      const result = await db
        .update(jobs)
        .set({
          status: "queued",
          claimedBy: null,
          claimedAt: null,
          heartbeatAt: null,
          runAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(jobs.status, "running"), lt(jobs.heartbeatAt, before)))
        .returning({ id: jobs.id });
      return result.length;
    },
    async getById(jobId) {
      const rows = await db
        .select()
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);
      return rows[0] ? toDomain(rows[0]) : null;
    },
  };
};
