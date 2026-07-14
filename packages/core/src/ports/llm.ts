import type {
  BatchHandle,
  BatchItem,
  BatchStatus,
  LlmResult,
  LlmRole,
  LlmStreamEvent,
  Message,
  Schema,
} from "../domain/index.js";

export interface Llm {
  complete<T>(
    role: LlmRole,
    messages: Message[],
    schema?: Schema<T>,
  ): Promise<LlmResult<T>>;

  stream(
    role: LlmRole,
    messages: Message[],
  ): AsyncIterable<LlmStreamEvent>;

  submitBatch(role: LlmRole, items: BatchItem[]): Promise<BatchHandle>;
  pollBatch(handle: BatchHandle): Promise<BatchStatus>;
}

export interface Embedder {
  readonly modelKey: string;
  readonly dimensions: number;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}
