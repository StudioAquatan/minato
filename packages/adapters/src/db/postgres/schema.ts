import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  Author,
  PageBBox,
  SummaryPayload,
} from "@minato/core";

export const papers = pgTable(
  "papers",
  {
    id: text("id").primaryKey(),
    doi: text("doi"),
    openalexId: text("openalex_id"),
    title: text("title").notNull(),
    titleJa: text("title_ja"),
    authorsJson: jsonb("authors_json").$type<Author[]>().notNull(),
    year: integer("year"),
    venue: text("venue"),
    lang: text("lang").notNull(),
    status: text("status").notNull(),
    currentFileId: text("current_file_id"),
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    doiUnique: uniqueIndex("papers_doi_unique")
      .on(t.doi)
      .where(sql`${t.doi} is not null`),
    openalexUnique: uniqueIndex("papers_openalex_unique")
      .on(t.openalexId)
      .where(sql`${t.openalexId} is not null`),
    statusIdx: index("papers_status_idx").on(t.status),
    yearIdx: index("papers_year_idx").on(t.year),
  }),
);

export const paperFiles = pgTable(
  "paper_files",
  {
    id: text("id").primaryKey(),
    paperId: text("paper_id"),
    relativePath: text("relative_path").notNull(),
    sha256: text("sha256").notNull(),
    byteSize: integer("byte_size").notNull(),
    mimeType: text("mime_type").notNull(),
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    sha256Unique: uniqueIndex("paper_files_sha256_unique").on(t.sha256),
    paperIdx: index("paper_files_paper_idx").on(t.paperId),
  }),
);

export const sections = pgTable(
  "sections",
  {
    id: text("id").primaryKey(),
    paperId: text("paper_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    level: integer("level"),
    title: text("title"),
    pageFrom: integer("page_from").notNull(),
    pageTo: integer("page_to").notNull(),
  },
  (t) => ({
    paperIdx: index("sections_paper_idx").on(t.paperId, t.ordinal),
  }),
);

export const chunks = pgTable(
  "chunks",
  {
    id: text("id").primaryKey(),
    paperId: text("paper_id").notNull(),
    sectionId: text("section_id"),
    ordinal: integer("ordinal").notNull(),
    text: text("text").notNull(),
    pageFrom: integer("page_from").notNull(),
    pageTo: integer("page_to").notNull(),
    bboxJson: jsonb("bbox_json").$type<PageBBox[]>(),
    tokenCount: integer("token_count"),
    contentHash: text("content_hash").notNull(),
    parserVersion: text("parser_version").notNull(),
    chunkerVersion: text("chunker_version").notNull(),
  },
  (t) => ({
    paperIdx: index("chunks_paper_idx").on(t.paperId, t.ordinal),
    hashIdx: index("chunks_hash_idx").on(t.contentHash),
  }),
);

export const referencesTable = pgTable(
  "references",
  {
    id: text("id").primaryKey(),
    paperId: text("paper_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    raw: text("raw").notNull(),
    doi: text("doi"),
    title: text("title"),
    authorsHint: text("authors_hint"),
    year: integer("year"),
    resolvedPaperId: text("resolved_paper_id"),
    resolveState: text("resolve_state").notNull(),
    resolveScore: real("resolve_score"),
    resolverVersion: text("resolver_version"),
  },
  (t) => ({
    paperIdx: index("references_paper_idx").on(t.paperId, t.ordinal),
    resolvedIdx: index("references_resolved_idx").on(t.resolvedPaperId),
  }),
);

export const citations = pgTable(
  "citations",
  {
    fromPaperId: text("from_paper_id").notNull(),
    toPaperId: text("to_paper_id").notNull(),
    contextChunkId: text("context_chunk_id"),
    snippet: text("snippet"),
    marker: text("marker"),
    confidence: real("confidence"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.fromPaperId, t.toPaperId] }),
    fromIdx: index("citations_from_idx").on(t.fromPaperId),
    toIdx: index("citations_to_idx").on(t.toPaperId),
  }),
);

export const summaries = pgTable(
  "summaries",
  {
    paperId: text("paper_id").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    sourceContentHash: text("source_content_hash").notNull(),
    lang: text("lang").notNull(),
    payload: jsonb("payload").$type<SummaryPayload>().notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({
      columns: [
        t.paperId,
        t.provider,
        t.model,
        t.promptVersion,
        t.sourceContentHash,
      ],
    }),
    paperIdx: index("summaries_paper_idx").on(t.paperId),
  }),
);

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    lane: text("lane").notNull(),
    status: text("status").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    priority: integer("priority").notNull().default(0),
    runAt: timestamp("run_at", { withTimezone: true }).notNull(),
    claimedBy: text("claimed_by"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    idempotencyUnique: uniqueIndex("jobs_idempotency_unique").on(
      t.idempotencyKey,
    ),
    laneStatusIdx: index("jobs_lane_status_run_at_idx").on(
      t.lane,
      t.status,
      t.runAt,
    ),
    statusIdx: index("jobs_status_idx").on(t.status),
  }),
);

export const approvals = pgTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    actionType: text("action_type").notNull(),
    targetPaperId: text("target_paper_id"),
    targetUrl: text("target_url"),
    reason: text("reason").notNull(),
    contextSnippet: text("context_snippet"),
    destinationHost: text("destination_host"),
    estimatedSizeBytes: integer("estimated_size_bytes"),
    estimatedCostUsd: real("estimated_cost_usd"),
    createdBy: text("created_by").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: text("status").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: text("decided_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    statusIdx: index("approvals_status_idx").on(t.status),
  }),
);

export const toolAuditLogs = pgTable(
  "tool_audit_logs",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    runId: text("run_id"),
    actor: text("actor").notNull(),
    provider: text("provider"),
    model: text("model"),
    toolName: text("tool_name").notNull(),
    args: jsonb("args").$type<unknown>().notNull(),
    resultSummary: text("result_summary"),
    success: boolean("success").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    estimatedCostUsd: real("estimated_cost_usd"),
    approvalId: text("approval_id"),
    jobId: text("job_id"),
  },
  (t) => ({
    sessionIdx: index("tool_audit_session_idx").on(t.sessionId),
    startedIdx: index("tool_audit_started_idx").on(t.startedAt),
  }),
);

export const indexGenerations = pgTable(
  "index_generations",
  {
    id: text("id").primaryKey(),
    embeddingModel: text("embedding_model").notNull(),
    embeddingRevision: text("embedding_revision"),
    documentTemplateVersion: text("document_template_version").notNull(),
    chunkerVersion: text("chunker_version").notNull(),
    parserVersion: text("parser_version").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    targetCount: integer("target_count"),
    successCount: integer("success_count").notNull().default(0),
    failureCount: integer("failure_count").notNull().default(0),
    active: boolean("active").notNull().default(false),
  },
  (t) => ({
    activeIdx: index("index_generations_active_idx").on(t.active),
  }),
);

export const externalApiCache = pgTable(
  "external_api_cache",
  {
    cacheKey: text("cache_key").primaryKey(),
    provider: text("provider").notNull(),
    endpoint: text("endpoint").notNull(),
    responseJson: jsonb("response_json").notNull(),
    etag: text("etag"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => ({
    providerIdx: index("external_api_cache_provider_idx").on(t.provider),
  }),
);
