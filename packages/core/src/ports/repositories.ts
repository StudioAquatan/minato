import type {
  ApprovalDecision,
  ApprovalId,
  ApprovalRequest,
  AuditEntry,
  Chunk,
  ChunkId,
  CitationEdge,
  GhostPaper,
  GhostQuery,
  IndexGeneration,
  IndexGenerationId,
  LineageGraph,
  LineageQuery,
  Paper,
  PaperFile,
  PaperId,
  PaperMatchCandidate,
  PaperMatchQuery,
  PaperStatus,
  ReferenceId,
  ReferenceRecord,
  Section,
  StoredSummary,
  FileId,
} from "../domain/index.js";

export interface PaperRepository {
  get(id: PaperId): Promise<Paper | null>;
  getMany(ids: PaperId[]): Promise<Paper[]>;
  findByDoi(doi: string): Promise<Paper | null>;
  findByContentHash(sha256: string): Promise<Paper | null>;
  findCandidates(input: PaperMatchQuery): Promise<PaperMatchCandidate[]>;
  upsert(paper: Paper): Promise<PaperId>;
  updateStatus(id: PaperId, status: PaperStatus): Promise<void>;
  updateCurrentFile(id: PaperId, fileId: FileId | null): Promise<void>;
  listGhosts(query: GhostQuery): Promise<GhostPaper[]>;
  listAll(limit: number, offset: number): Promise<Paper[]>;
}

export interface FileRepository {
  get(id: FileId): Promise<PaperFile | null>;
  findByHash(sha256: string): Promise<PaperFile | null>;
  upsert(file: PaperFile): Promise<FileId>;
}

export interface SectionRepository {
  replaceForPaper(paperId: PaperId, sections: Section[]): Promise<void>;
  listForPaper(paperId: PaperId): Promise<Section[]>;
}

export interface ChunkRepository {
  replaceForPaper(paperId: PaperId, chunks: Chunk[]): Promise<void>;
  get(chunkId: ChunkId): Promise<Chunk | null>;
  getMany(ids: ChunkId[]): Promise<Chunk[]>;
  listForPaper(paperId: PaperId): Promise<Chunk[]>;
  deleteForPaper(paperId: PaperId): Promise<void>;
  countAll(): Promise<number>;
  streamAll(batchSize: number): AsyncIterable<Chunk[]>;
}

export type ReferenceResolutionUpdate = {
  resolvedPaperId: PaperId | null;
  resolveState: ReferenceRecord["resolveState"];
  resolveScore: number | null;
  resolverVersion: string | null;
  doi?: string | null;
  title?: string | null;
  authorsHint?: string | null;
  year?: number | null;
};

export interface CitationRepository {
  replaceReferences(
    paperId: PaperId,
    refs: ReferenceRecord[],
  ): Promise<void>;
  listReferencesForPaper(paperId: PaperId): Promise<ReferenceRecord[]>;
  updateReferenceResolution(
    referenceId: ReferenceId,
    update: ReferenceResolutionUpdate,
  ): Promise<void>;
  upsertEdges(edges: CitationEdge[]): Promise<void>;
  findCiting(paperId: PaperId): Promise<PaperId[]>;
  findCitedBy(paperId: PaperId): Promise<PaperId[]>;
  traceLineage(input: LineageQuery): Promise<LineageGraph>;
}

export interface SummaryRepository {
  put(summary: StoredSummary): Promise<void>;
  get(
    paperId: PaperId,
    modelKey: string,
  ): Promise<StoredSummary | null>;
  listForPaper(paperId: PaperId): Promise<StoredSummary[]>;
}

export interface ApprovalRepository {
  create(request: ApprovalRequest): Promise<ApprovalId>;
  get(id: ApprovalId): Promise<ApprovalRequest | null>;
  listPending(): Promise<ApprovalRequest[]>;
  decide(id: ApprovalId, decision: ApprovalDecision): Promise<void>;
}

export interface AuditLogRepository {
  append(entry: AuditEntry): Promise<void>;
}

export interface IndexGenerationRepository {
  create(gen: IndexGeneration): Promise<IndexGenerationId>;
  markFinished(
    id: IndexGenerationId,
    result: {
      finishedAt: Date;
      successCount: number;
      failureCount: number;
      active: boolean;
    },
  ): Promise<void>;
  getActive(): Promise<IndexGeneration | null>;
  list(limit: number): Promise<IndexGeneration[]>;
  deactivateOthers(id: IndexGenerationId): Promise<void>;
}
