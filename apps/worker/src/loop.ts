import type { Deps, Job, Lane } from "@minato/core";
import { enqueueFollowUp, handlerFor } from "./handlers.js";

const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

const isRetryable = (err: unknown): boolean => {
  if (err && typeof err === "object" && "retryable" in err) {
    const flag = (err as { retryable?: unknown }).retryable;
    if (typeof flag === "boolean") return flag;
  }
  return true;
};

const errorCode = (err: unknown): string => {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "unknown";
};

const errorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  return String(err);
};

export type WorkerOptions = {
  workerId: string;
  lanes: Lane[];
  pollMs: number;
  heartbeatMs: number;
  staleAfterMs: number;
};

export const runWorker = async (
  deps: Deps,
  opts: WorkerOptions,
  signal?: AbortSignal,
): Promise<void> => {
  let lastRecovery = 0;
  const RECOVERY_INTERVAL_MS = 60_000;

  while (!signal?.aborted) {
    const now = Date.now();
    if (now - lastRecovery > RECOVERY_INTERVAL_MS) {
      lastRecovery = now;
      const staleBefore = new Date(now - opts.staleAfterMs);
      const recovered = await deps.jobs.recoverStaleJobs(staleBefore);
      if (recovered > 0) {
        console.log(`recovered ${recovered} stale jobs`);
      }
    }

    let claimed: Job | null = null;
    for (const lane of opts.lanes) {
      claimed = await deps.jobs.claimNext(lane, opts.workerId);
      if (claimed) break;
    }
    if (!claimed) {
      await sleep(opts.pollMs);
      continue;
    }

    const job = claimed;
    const controller = new AbortController();
    const beat = setInterval(() => {
      deps.jobs
        .heartbeat(job.id, opts.workerId)
        .catch((err) =>
          console.error(`heartbeat failed for ${job.id}:`, err),
        );
    }, opts.heartbeatMs);

    try {
      console.log(
        `[${opts.workerId}] running ${job.kind} (${job.id}) attempt=${job.attempts}`,
      );
      const handler = handlerFor(job.kind);
      const result = await handler(deps, job.payload, job);
      await enqueueFollowUp(deps, result.followUp);
      await deps.jobs.succeed(job.id, result);
      console.log(`[${opts.workerId}] ok ${job.kind} (${job.id})`);
    } catch (err) {
      console.error(`[${opts.workerId}] fail ${job.kind} (${job.id}):`, err);
      await deps.jobs.fail(job.id, {
        code: errorCode(err),
        message: errorMessage(err),
        retryable: isRetryable(err),
      });
    } finally {
      clearInterval(beat);
      controller.abort();
    }
  }
};
