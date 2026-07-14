import type { AnswerCitation } from "./search.js";

export type LlmRole =
  | "summarize"
  | "extract_refs"
  | "rag_chat"
  | "agent"
  | "embed";

export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export type Schema<T> = {
  name: string;
  jsonSchema: unknown;
  parse: (raw: unknown) => T;
};

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type LlmResult<T> = {
  value: T;
  raw: string;
  usage: LlmUsage;
  provider: string;
  model: string;
};

export type LlmStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "citation"; citation: AnswerCitation }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "completed" }
  | { type: "error"; code: string; message: string };

export type BatchItem = {
  customId: string;
  messages: Message[];
  schemaName?: string;
};

export type BatchHandle = {
  role: LlmRole;
  providerBatchId: string;
  provider: string;
};

export type BatchResultItem<T = unknown> = {
  customId: string;
  ok: boolean;
  value?: T;
  error?: { code: string; message: string };
  usage?: LlmUsage;
};

export type BatchStatus = {
  handle: BatchHandle;
  state: "in_progress" | "completed" | "failed" | "expired";
  results?: BatchResultItem[];
};
