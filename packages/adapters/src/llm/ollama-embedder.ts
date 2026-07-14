import type { Embedder } from "@minato/core";

export type OllamaEmbedderOptions = {
  baseUrl: string;
  model: string;
  dimensions: number;
  batchSize?: number;
  requestTimeoutMs?: number;
};

type OllamaEmbedResponse = {
  embedding?: number[];
  embeddings?: number[][];
};

export class OllamaEmbedder implements Embedder {
  readonly modelKey: string;
  readonly dimensions: number;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly batchSize: number;
  private readonly timeoutMs: number;

  constructor(opts: OllamaEmbedderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.model = opts.model;
    this.modelKey = `ollama:${opts.model}`;
    this.dimensions = opts.dimensions;
    this.batchSize = opts.batchSize ?? 16;
    this.timeoutMs = opts.requestTimeoutMs ?? 60_000;
  }

  private async postJson(path: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `ollama ${path} failed: ${res.status} ${res.statusText} ${text}`,
        );
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  private async callEmbed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = (await this.postJson("/api/embed", {
      model: this.model,
      input: texts,
    })) as OllamaEmbedResponse;
    if (Array.isArray(res.embeddings)) return res.embeddings;
    if (Array.isArray(res.embedding))
      return texts.map(() => res.embedding as number[]);
    throw new Error("ollama /api/embed returned no embeddings");
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const embeddings = await this.callEmbed(batch);
      out.push(...embeddings);
    }
    return out;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [only] = await this.callEmbed([text]);
    if (!only) throw new Error("empty embedding");
    return only;
  }
}
