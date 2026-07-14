import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import type { PaperFile, FileId, JobSpec } from "../domain/index.js";
import type { Deps } from "./types.js";

export type RegisterFileInput = {
  sourcePath: string;
  source?: string;
};

export type RegisterFileOutput = {
  fileId: FileId;
  sha256: string;
  isDuplicate: boolean;
  enqueuedJobId: string | null;
};

const sha256Of = async (path: string) => {
  const buf = await fs.readFile(path);
  return createHash("sha256").update(buf).digest("hex");
};

export const registerFile = async (
  deps: Deps,
  input: RegisterFileInput,
): Promise<RegisterFileOutput> => {
  const sha256 = await sha256Of(input.sourcePath);
  const existing = await deps.files.findByHash(sha256);
  if (existing) {
    return {
      fileId: existing.id,
      sha256,
      isDuplicate: true,
      enqueuedJobId: null,
    };
  }

  const stored = await deps.storage.store(input.sourcePath, sha256);
  const file: PaperFile = {
    id: deps.idGen.newId("file") as FileId,
    paperId: null,
    relativePath: stored.relativePath,
    sha256,
    byteSize: stored.byteSize,
    mimeType: "application/pdf",
    source: input.source ?? null,
    createdAt: deps.clock.now(),
  };
  const fileId = await deps.files.upsert(file);

  const spec: JobSpec = {
    kind: "parse_pdf_batch",
    lane: "parse",
    payload: { fileIds: [fileId] },
    idempotencyKey: `parse:${sha256}:${deps.parser.parserVersion}`,
  };
  const jobId = await deps.jobs.enqueue(spec);

  return {
    fileId,
    sha256,
    isDuplicate: false,
    enqueuedJobId: jobId,
  };
};
