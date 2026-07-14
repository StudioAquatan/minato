import { Meilisearch, type Index } from "meilisearch";
import type {
  Chunk,
  ChunkId,
  Embedder,
  IndexAdmin,
  IndexState,
  Paper,
  PaperId,
  SearchFilters,
  SearchHit,
  SearchIndex,
  SearchOptions,
} from "@minato/core";

export type MeilisearchAdapterOptions = {
  host: string;
  apiKey?: string;
  indexUid: string;
  embedderName: string;
  embeddingDimensions: number;
};

type ChunkDoc = {
  chunkId: string;
  paperId: string;
  title: string;
  titleJa: string | null;
  authors: string[];
  year: number | null;
  venue: string | null;
  lang: string;
  status: string;
  sectionTitle: string | null;
  text: string;
  pageFrom: number;
  pageTo: number;
  embeddingModel: string;
  contentHash: string;
  _vectors?: Record<string, number[]>;
};

const filtersToArray = (filters?: SearchFilters): string[] => {
  if (!filters) return [];
  const parts: string[] = [];
  if (filters.lang?.length) {
    parts.push(
      `lang IN [${filters.lang
        .map((s) => JSON.stringify(s))
        .join(",")}]`,
    );
  }
  if (filters.status?.length) {
    parts.push(
      `status IN [${filters.status
        .map((s) => JSON.stringify(s))
        .join(",")}]`,
    );
  } else {
    parts.push('status = "ready"');
  }
  if (filters.paperIds?.length) {
    parts.push(
      `paperId IN [${filters.paperIds
        .map((s) => JSON.stringify(s))
        .join(",")}]`,
    );
  }
  if (typeof filters.yearFrom === "number") {
    parts.push(`year >= ${filters.yearFrom}`);
  }
  if (typeof filters.yearTo === "number") {
    parts.push(`year <= ${filters.yearTo}`);
  }
  return parts;
};

const truncate = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;

export class MeilisearchAdapter implements SearchIndex, IndexAdmin {
  private readonly client: Meilisearch;
  private readonly indexUid: string;
  readonly embedderName: string;
  private readonly embedder: Embedder;
  private readonly embeddingDimensions: number;
  private initialized = false;

  constructor(
    opts: MeilisearchAdapterOptions & { embedder: Embedder },
  ) {
    this.client = new Meilisearch({
      host: opts.host,
      apiKey: opts.apiKey,
    });
    this.indexUid = opts.indexUid;
    this.embedderName = opts.embedderName;
    this.embedder = opts.embedder;
    this.embeddingDimensions = opts.embeddingDimensions;
  }

  private async index(): Promise<Index<ChunkDoc>> {
    await this.ensureInitialized();
    return this.client.index<ChunkDoc>(this.indexUid);
  }

  private async ensureInitialized() {
    if (this.initialized) return;
    const existing = await this.client
      .getIndex(this.indexUid)
      .catch(() => null);
    if (!existing) {
      const task = await this.client.createIndex(this.indexUid, {
        primaryKey: "chunkId",
      });
      await this.client.tasks.waitForTask(task.taskUid);
    }
    const idx = this.client.index<ChunkDoc>(this.indexUid);
    const settingsTask = await idx.updateSettings({
      searchableAttributes: ["title", "titleJa", "sectionTitle", "text"],
      filterableAttributes: ["paperId", "lang", "year", "status"],
      sortableAttributes: ["year"],
      displayedAttributes: [
        "chunkId",
        "paperId",
        "title",
        "titleJa",
        "authors",
        "year",
        "venue",
        "lang",
        "status",
        "sectionTitle",
        "text",
        "pageFrom",
        "pageTo",
        "embeddingModel",
        "contentHash",
      ],
      localizedAttributes: [
        { attributePatterns: ["title", "titleJa", "text", "sectionTitle"], locales: ["jpn", "eng"] },
      ],
      embedders: {
        [this.embedderName]: {
          source: "userProvided",
          dimensions: this.embeddingDimensions,
        },
      },
    });
    await this.client.tasks.waitForTask(settingsTask.taskUid);
    this.initialized = true;
  }

  private toDoc(
    paper: Paper,
    chunk: Chunk,
    embedding: number[] | null,
    sectionTitle: string | null,
  ): ChunkDoc {
    const doc: ChunkDoc = {
      chunkId: chunk.id,
      paperId: paper.id,
      title: paper.title,
      titleJa: paper.titleJa,
      authors: paper.authors.map((a) => a.fullName),
      year: paper.year,
      venue: paper.venue,
      lang: paper.lang,
      status: paper.status,
      sectionTitle,
      text: chunk.text,
      pageFrom: chunk.pageFrom,
      pageTo: chunk.pageTo,
      embeddingModel: this.embedder.modelKey,
      contentHash: chunk.contentHash,
    };
    if (embedding) {
      doc._vectors = { [this.embedderName]: embedding };
    }
    return doc;
  }

  async upsertPaper(paper: Paper, chunks: Chunk[]) {
    const idx = await this.index();
    if (chunks.length === 0) {
      await idx.deleteDocuments({ filter: `paperId = "${paper.id}"` });
      return;
    }
    const embeddings = await this.embedder.embedDocuments(
      chunks.map((c) => c.text),
    );
    const docs = chunks.map((c, i) =>
      this.toDoc(paper, c, embeddings[i] ?? null, null),
    );
    const task = await idx.updateDocuments(docs);
    await this.client.tasks.waitForTask(task.taskUid);
  }

  async deletePaper(paperId: PaperId) {
    const idx = await this.index();
    const task = await idx.deleteDocuments({
      filter: `paperId = "${paperId}"`,
    });
    await this.client.tasks.waitForTask(task.taskUid);
  }

  async clear() {
    const idx = await this.index();
    const task = await idx.deleteAllDocuments();
    await this.client.tasks.waitForTask(task.taskUid);
  }

  async getState(): Promise<IndexState> {
    const idx = await this.index();
    const stats = await idx.getStats();
    return {
      activeGenerationId: null,
      documentCount: stats.numberOfDocuments,
      embeddingModel: this.embedder.modelKey,
      updatedAt: new Date(),
    };
  }

  async hybridSearch(
    query: string,
    options: SearchOptions,
  ): Promise<SearchHit[]> {
    const idx = await this.index();
    const filter = filtersToArray(options.filters);
    const searchArgs: Parameters<Index<ChunkDoc>["search"]>[1] = {
      limit: options.limit,
      offset: options.offset ?? 0,
      attributesToRetrieve: [
        "chunkId",
        "paperId",
        "title",
        "titleJa",
        "authors",
        "year",
        "lang",
        "sectionTitle",
        "text",
        "pageFrom",
        "pageTo",
      ],
      attributesToCrop: ["text"],
      cropLength: 60,
      showRankingScore: true,
      ...(filter.length ? { filter } : {}),
      hybrid: {
        embedder: this.embedderName,
        semanticRatio: options.semanticRatio ?? 0.5,
      },
    };
    if (options.embedding) {
      searchArgs.vector = options.embedding;
    }
    const res = await idx.search(query, searchArgs);
    return res.hits.map((raw) => {
      const h = raw as ChunkDoc & {
        _formatted?: { text?: string };
        _rankingScore?: number;
      };
      const snippet = h._formatted?.text ?? truncate(h.text ?? "", 300);
      return {
        chunkId: h.chunkId as ChunkId,
        paperId: h.paperId as PaperId,
        title: h.title,
        authors: h.authors,
        year: h.year,
        lang: h.lang,
        sectionTitle: h.sectionTitle,
        pageFrom: h.pageFrom,
        pageTo: h.pageTo,
        snippet,
        score: h._rankingScore ?? 0,
      } satisfies SearchHit;
    });
  }

  async facetByYear(
    query: string,
    filters: SearchFilters,
  ): Promise<Record<number, number>> {
    const idx = await this.index();
    const filter = filtersToArray(filters);
    const res = await idx.search(query, {
      limit: 0,
      facets: ["year"],
      ...(filter.length ? { filter } : {}),
    });
    const dist = res.facetDistribution?.year ?? {};
    const out: Record<number, number> = {};
    for (const [k, v] of Object.entries(dist)) {
      const year = Number(k);
      if (!Number.isNaN(year)) out[year] = v;
    }
    return out;
  }
}
