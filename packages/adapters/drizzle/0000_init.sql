CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"action_type" text NOT NULL,
	"target_paper_id" text,
	"target_url" text,
	"reason" text NOT NULL,
	"context_snippet" text,
	"destination_host" text,
	"estimated_size_bytes" integer,
	"estimated_cost_usd" real,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone,
	"status" text NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"paper_id" text NOT NULL,
	"section_id" text,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"page_from" integer NOT NULL,
	"page_to" integer NOT NULL,
	"bbox_json" jsonb,
	"token_count" integer,
	"content_hash" text NOT NULL,
	"parser_version" text NOT NULL,
	"chunker_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "citations" (
	"from_paper_id" text NOT NULL,
	"to_paper_id" text NOT NULL,
	"context_chunk_id" text,
	"snippet" text,
	"marker" text,
	"confidence" real,
	CONSTRAINT "citations_from_paper_id_to_paper_id_pk" PRIMARY KEY("from_paper_id","to_paper_id")
);
--> statement-breakpoint
CREATE TABLE "external_api_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"endpoint" text NOT NULL,
	"response_json" jsonb NOT NULL,
	"etag" text,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "index_generations" (
	"id" text PRIMARY KEY NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding_revision" text,
	"document_template_version" text NOT NULL,
	"chunker_version" text NOT NULL,
	"parser_version" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"target_count" integer,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"lane" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_files" (
	"id" text PRIMARY KEY NOT NULL,
	"paper_id" text,
	"relative_path" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"source" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "papers" (
	"id" text PRIMARY KEY NOT NULL,
	"doi" text,
	"openalex_id" text,
	"title" text NOT NULL,
	"title_ja" text,
	"authors_json" jsonb NOT NULL,
	"year" integer,
	"venue" text,
	"lang" text NOT NULL,
	"status" text NOT NULL,
	"current_file_id" text,
	"source" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "references" (
	"id" text PRIMARY KEY NOT NULL,
	"paper_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"raw" text NOT NULL,
	"doi" text,
	"title" text,
	"authors_hint" text,
	"year" integer,
	"resolved_paper_id" text,
	"resolve_state" text NOT NULL,
	"resolve_score" real,
	"resolver_version" text
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" text PRIMARY KEY NOT NULL,
	"paper_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"level" integer,
	"title" text,
	"page_from" integer NOT NULL,
	"page_to" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "summaries" (
	"paper_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"source_content_hash" text NOT NULL,
	"lang" text NOT NULL,
	"payload" jsonb NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "summaries_paper_id_provider_model_prompt_version_source_content_hash_pk" PRIMARY KEY("paper_id","provider","model","prompt_version","source_content_hash")
);
--> statement-breakpoint
CREATE TABLE "tool_audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"run_id" text,
	"actor" text NOT NULL,
	"provider" text,
	"model" text,
	"tool_name" text NOT NULL,
	"args" jsonb NOT NULL,
	"result_summary" text,
	"success" boolean NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost_usd" real,
	"approval_id" text,
	"job_id" text
);
--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "chunks_paper_idx" ON "chunks" USING btree ("paper_id","ordinal");--> statement-breakpoint
CREATE INDEX "chunks_hash_idx" ON "chunks" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "citations_from_idx" ON "citations" USING btree ("from_paper_id");--> statement-breakpoint
CREATE INDEX "citations_to_idx" ON "citations" USING btree ("to_paper_id");--> statement-breakpoint
CREATE INDEX "external_api_cache_provider_idx" ON "external_api_cache" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "index_generations_active_idx" ON "index_generations" USING btree ("active");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_unique" ON "jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_lane_status_run_at_idx" ON "jobs" USING btree ("lane","status","run_at");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "paper_files_sha256_unique" ON "paper_files" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "paper_files_paper_idx" ON "paper_files" USING btree ("paper_id");--> statement-breakpoint
CREATE UNIQUE INDEX "papers_doi_unique" ON "papers" USING btree ("doi") WHERE "papers"."doi" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "papers_openalex_unique" ON "papers" USING btree ("openalex_id") WHERE "papers"."openalex_id" is not null;--> statement-breakpoint
CREATE INDEX "papers_status_idx" ON "papers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "papers_year_idx" ON "papers" USING btree ("year");--> statement-breakpoint
CREATE INDEX "references_paper_idx" ON "references" USING btree ("paper_id","ordinal");--> statement-breakpoint
CREATE INDEX "references_resolved_idx" ON "references" USING btree ("resolved_paper_id");--> statement-breakpoint
CREATE INDEX "sections_paper_idx" ON "sections" USING btree ("paper_id","ordinal");--> statement-breakpoint
CREATE INDEX "summaries_paper_idx" ON "summaries" USING btree ("paper_id");--> statement-breakpoint
CREATE INDEX "tool_audit_session_idx" ON "tool_audit_logs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "tool_audit_started_idx" ON "tool_audit_logs" USING btree ("started_at");