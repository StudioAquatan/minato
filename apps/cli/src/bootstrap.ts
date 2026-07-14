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
  makeChunkRepository,
  makeCitationRepository,
  makeFileRepository,
  makeIndexGenerationRepository,
  makeJobQueue,
  makePaperRepository,
  makeSectionRepository,
} from "@minato/adapters/db";
import { MeilisearchAdapter } from "@minato/adapters/search";
import { OllamaEmbedder } from "@minato/adapters/llm";
import {
  CombinedPdfParser,
  GrobidClient,
  OpenDataLoaderParser,
} from "@minato/adapters/parser";
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

export type CliRuntime = {
  deps: Deps;
  workspaceRoot: string;
  close: () => Promise<void>;
};

const env = (k: string, fallback?: string): string => {
  const v = process.env[k];
  if (v && v.length > 0) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`missing env ${k}`);
};

export const bootstrapCli = async (): Promise<CliRuntime> => {
  const { db, pool } = createDb({
    connectionString: env(
      "DATABASE_URL",
      "postgres://minato:minato@localhost:5432/minato",
    ),
  });
  const embedder = new OllamaEmbedder({
    baseUrl: env("OLLAMA_URL", "http://localhost:11434"),
    model: env("OLLAMA_EMBED_MODEL", "bge-m3"),
    dimensions: Number(env("EMBEDDING_DIMENSIONS", "1024")),
  });
  const odl = new OpenDataLoaderParser();
  const grobid = new GrobidClient({
    baseUrl: env("GROBID_URL", "http://localhost:8070"),
    concurrency: Number(env("GROBID_CONCURRENCY", "4")),
    requestTimeoutMs: Number(env("GROBID_REQUEST_TIMEOUT_MS", "300000")),
    maxRetries: Number(env("GROBID_MAX_RETRIES", "3")),
  });
  const parser = new CombinedPdfParser({ odl, grobid });
  const storage = new LocalPdfStorage({
    root: env("STORAGE_ROOT", "./data/pdf"),
    workspaceRoot,
  });
  const meiliKey = process.env["MEILI_MASTER_KEY"];
  const searchAdapter = new MeilisearchAdapter({
    host: env("MEILI_URL", "http://localhost:7700"),
    ...(meiliKey ? { apiKey: meiliKey } : {}),
    indexUid: env("MEILI_INDEX", "chunks"),
    embedderName: "primary",
    embeddingDimensions: Number(env("EMBEDDING_DIMENSIONS", "1024")),
    embedder,
  });
  const deps: Deps = {
    papers: makePaperRepository(db),
    files: makeFileRepository(db),
    sections: makeSectionRepository(db),
    chunks: makeChunkRepository(db),
    citations: makeCitationRepository(db),
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
    deps,
    workspaceRoot,
    close: async () => {
      await pool.end();
    },
  };
};
