import type {
  FileId,
  JobSpec,
  Paper,
  PaperId,
  ParsedDocument,
  ReferenceId,
  ReferenceRecord,
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
    doi: document.doi ?? existing?.doi ?? null,
    openalexId: existing?.openalexId ?? null,
    title: document.title ?? existing?.title ?? "(untitled)",
    titleJa: document.titleJa ?? existing?.titleJa ?? null,
    authors: document.authors.map((a) => ({
      fullName: a.fullName,
      ...(a.affiliation ? { affiliations: [a.affiliation] } : {}),
    })),
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

  if (deps.citations && document.references.length > 0) {
    const refs: ReferenceRecord[] = document.references.map((r) => ({
      id: deps.idGen.newId("ref") as ReferenceId,
      paperId,
      ordinal: r.ordinal,
      raw: r.raw,
      doi: r.doi,
      title: r.title,
      authorsHint: r.authorsHint,
      year: r.year,
      resolvedPaperId: null,
      resolveState: "unresolved",
      resolveScore: null,
      resolverVersion: null,
    }));
    await deps.citations.replaceReferences(paperId, refs);
  }

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
