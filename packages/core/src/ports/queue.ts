import type {
  Job,
  JobError,
  JobId,
  JobResult,
  JobSpec,
  Lane,
} from "../domain/index.js";

export interface JobQueue {
  enqueue(spec: JobSpec): Promise<JobId>;
  enqueueMany(specs: JobSpec[]): Promise<JobId[]>;
  claimNext(lane: Lane, workerId: string): Promise<Job | null>;
  heartbeat(jobId: JobId, workerId: string): Promise<void>;
  succeed(jobId: JobId, result: JobResult): Promise<void>;
  fail(jobId: JobId, error: JobError): Promise<void>;
  recoverStaleJobs(before: Date): Promise<number>;
  getById(jobId: JobId): Promise<Job | null>;
}
