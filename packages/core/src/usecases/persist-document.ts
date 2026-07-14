import type {
  FileId,
  JobSpec,
  Paper,
  PaperId,
  ParsedDocument,
} from "../domain/index.js";
import type { Deps } from "./types.js";
import { chunkDocument } from "../services/chunker.js";
import { detectLang } from "../services/lang.js";

export type PersistDocumentInput = {
  fileId: FileId;
  document: ParsedDocument;
};

export type PersistDocumentOutput = {
  paperId: PaperId;
  chunkCount: number;
  followUp: JobSpec[];
};

const primaryText = (doc: ParsedDocument) =>
  doc.elements
    .slice(0, 40)
    .map((el) => el.text)
    .join("\n");

export const persistDocument = async (
  deps: Deps,
  input: PersistDocumentInput,
): Promise<PersistDocumentOutput> => {
  const { document, fileId } = input;
  const file = await deps.files.get(fileId);
  if (!file) {
    throw new Error(`file not found: ${fileId}`);
  }

  const now = deps.clock.now();
  const detectedLang = document.lang || detectLang(primaryText(document));
  const existing = await deps.papers.findByContentHash(document.sha256);
  const paperId =
    existing?.id ?? (deps.idGen.newId("pap") as PaperId);

  const paper: Paper = {
    id: paperId,
    doi: existing?.doi ?? null,
    openalexId: existing?.openalexId ?? null,
    title: document.title ?? existing?.title ?? "(untitled)",
    titleJa: existing?.titleJa ?? null,
    authors: document.authors.map((name) => ({ fullName: name })),
    year: document.year ?? existing?.year ?? null,
    venue: document.venue ?? existing?.venue ?? null,
    lang: detectedLang,
    status: "ready",
    currentFileId: fileId,
    source: existing?.source ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await deps.papers.upsert(paper);
  await deps.papers.updateCurrentFile(paperId, fileId);

  const { sections, chunks } = chunkDocument(
    paperId,
    document,
    deps.chunker,
    deps.idGen,
  );

  await deps.sections.replaceForPaper(paperId, sections);
  await deps.chunks.replaceForPaper(paperId, chunks);

  const followUp: JobSpec[] = [
    {
      kind: "index_paper",
      lane: "index",
      payload: { paperId },
      idempotencyKey: `index:${paperId}:${deps.embedder.modelKey}:${deps.chunker.version}`,
    },
  ];

  return { paperId, chunkCount: chunks.length, followUp };
};
