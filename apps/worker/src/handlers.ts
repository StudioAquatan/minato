import type { Job, JobKind, JobResult, JobSpec, Deps } from "@minato/core";
import {
  indexPaper,
  parsePdfBatch,
  persistDocument,
  rebuildIndex,
} from "@minato/core";

export type Handler = (
  deps: Deps,
  payload: unknown,
  job: Job,
) => Promise<JobResult>;

const parsePdfBatchHandler: Handler = async (deps, payload) => {
  const out = await parsePdfBatch(deps, payload as Parameters<typeof parsePdfBatch>[1]);
  return { output: out, followUp: out.followUp };
};

const persistDocumentHandler: Handler = async (deps, payload) => {
  const out = await persistDocument(
    deps,
    payload as Parameters<typeof persistDocument>[1],
  );
  return { output: out, followUp: out.followUp };
};

const indexPaperHandler: Handler = async (deps, payload) => {
  const out = await indexPaper(
    deps,
    payload as Parameters<typeof indexPaper>[1],
  );
  return { output: out };
};

const rebuildIndexHandler: Handler = async (deps, payload) => {
  const out = await rebuildIndex(
    deps,
    payload as Parameters<typeof rebuildIndex>[1],
  );
  return { output: out };
};

const unhandled: Handler = async (_deps, _payload, job) => {
  throw Object.assign(
    new Error(`no handler for job kind: ${job.kind}`),
    { code: "unhandled_kind", retryable: false },
  );
};

export const handlerFor = (kind: JobKind): Handler => {
  switch (kind) {
    case "parse_pdf_batch":
      return parsePdfBatchHandler;
    case "persist_document":
      return persistDocumentHandler;
    case "index_paper":
      return indexPaperHandler;
    case "rebuild_index":
      return rebuildIndexHandler;
    default:
      return unhandled;
  }
};

export const enqueueFollowUp = async (
  deps: Deps,
  specs: JobSpec[] | undefined,
) => {
  if (!specs || specs.length === 0) return;
  await deps.jobs.enqueueMany(specs);
};
