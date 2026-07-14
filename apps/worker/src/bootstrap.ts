import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnvFile } from "dotenv";
import {
  defaultChunkerConfig,
  systemClock,
  uuidIdGen,
  type Deps,
} from "@minato/core";
import {
  createDb,
  makeApprovalRepository,
  makeAuditLogRepository,
  makeChunkRepository,
  makeCitationRepository,
  makeFileRepository,
  makeIndexGenerationRepository,
  makeJobQueue,
  makePaperRepository,
  makeSectionRepository,
  makeSummaryRepository,
} from "@minato/adapters/db";
import { MeilisearchAdapter } from "@minato/adapters/search";
import { OllamaEmbedder } from "@minato/adapters/llm";
import { OpenDataLoaderParser } from "@minato/adapters/parser";
import { LocalPdfStorage } from "@minato/adapters/storage";

const findWorkspaceRoot = (start: string): string => {
  let dir = resolve(start);
  while (dir !== "/" && dir.length > 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  return start;
};

const workspaceRoot = findWorkspaceRoot(
  dirname(fileURLToPath(import.meta.url)),
);
loadEnvFile({ path: join(workspaceRoot, ".env") });

export type BootstrapConfig = {
  databaseUrl: string;
  meiliUrl: string;
  meiliApiKey?: string;
  meiliIndex: string;
  ollamaUrl: string;
  ollamaEmbedModel: string;
  embeddingDimensions: number;
  storageRoot: string;
  workspaceRoot: string;
};

const readEnv = (key: string, fallback?: string): string => {
  const v = process.env[key];
  if (v && v.length > 0) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`missing env ${key}`);
};

export const loadConfig = (): BootstrapConfig => ({
  databaseUrl: readEnv(
    "DATABASE_URL",
    "postgres://minato:minato@localhost:5432/minato",
  ),
  meiliUrl: readEnv("MEILI_URL", "http://localhost:7700"),
  meiliApiKey: process.env["MEILI_MASTER_KEY"],
  meiliIndex: readEnv("MEILI_INDEX", "chunks"),
  ollamaUrl: readEnv("OLLAMA_URL", "http://localhost:11434"),
  ollamaEmbedModel: readEnv("OLLAMA_EMBED_MODEL", "bge-m3"),
  embeddingDimensions: Number(readEnv("EMBEDDING_DIMENSIONS", "1024")),
  storageRoot: readEnv("STORAGE_ROOT", "./data/pdf"),
  workspaceRoot,
});

export type Runtime = {
  config: BootstrapConfig;
  deps: Deps;
  approvals: ReturnType<typeof makeApprovalRepository>;
  auditLogs: ReturnType<typeof makeAuditLogRepository>;
  citations: ReturnType<typeof makeCitationRepository>;
  summaries: ReturnType<typeof makeSummaryRepository>;
  close: () => Promise<void>;
};

export const bootstrap = async (): Promise<Runtime> => {
  const config = loadConfig();
  const { db, pool } = createDb({ connectionString: config.databaseUrl });

  const embedder = new OllamaEmbedder({
    baseUrl: config.ollamaUrl,
    model: config.ollamaEmbedModel,
    dimensions: config.embeddingDimensions,
  });

  const parser = new OpenDataLoaderParser();
  const storage = new LocalPdfStorage({
    root: config.storageRoot,
    workspaceRoot: config.workspaceRoot,
  });
  const searchAdapter = new MeilisearchAdapter({
    host: config.meiliUrl,
    ...(config.meiliApiKey ? { apiKey: config.meiliApiKey } : {}),
    indexUid: config.meiliIndex,
    embedderName: "primary",
    embeddingDimensions: config.embeddingDimensions,
    embedder,
  });

  const deps: Deps = {
    papers: makePaperRepository(db),
    files: makeFileRepository(db),
    sections: makeSectionRepository(db),
    chunks: makeChunkRepository(db),
    jobs: makeJobQueue(db),
    storage,
    parser,
    searchIndex: searchAdapter,
    indexAdmin: searchAdapter,
    indexGens: makeIndexGenerationRepository(db),
    embedder,
    clock: systemClock,
    idGen: uuidIdGen,
    chunker: defaultChunkerConfig(parser.parserVersion),
  };

  return {
    config,
    deps,
    approvals: makeApprovalRepository(db),
    auditLogs: makeAuditLogRepository(db),
    citations: makeCitationRepository(db),
    summaries: makeSummaryRepository(db),
    close: async () => {
      await pool.end();
    },
  };
};
