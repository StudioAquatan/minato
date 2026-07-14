import type { FileId, JobSpec, PdfParseInput } from "../domain/index.js";
import type { Deps } from "./types.js";

export type ParsePdfBatchInput = {
  fileIds: FileId[];
};

export type ParsePdfBatchOutput = {
  parsed: number;
  followUp: JobSpec[];
};

export const parsePdfBatch = async (
  deps: Deps,
  input: ParsePdfBatchInput,
): Promise<ParsePdfBatchOutput> => {
  const parseInputs: PdfParseInput[] = [];
  for (const fileId of input.fileIds) {
    const file = await deps.files.get(fileId);
    if (!file) continue;
    parseInputs.push({
      fileId,
      absolutePath: deps.storage.absolutePathFor(file.relativePath),
      sha256: file.sha256,
    });
  }
  if (parseInputs.length === 0) {
    return { parsed: 0, followUp: [] };
  }

  const parsed = await deps.parser.parse(parseInputs);

  const followUp: JobSpec[] = parsed.map((doc) => ({
    kind: "persist_document",
    lane: "parse",
    payload: {
      fileId: doc.fileId,
      document: doc,
    },
    idempotencyKey: `persist:${doc.sha256}:${doc.parserVersion}`,
  }));

  return { parsed: parsed.length, followUp };
};
