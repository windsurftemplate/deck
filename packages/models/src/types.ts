/** heavy, cheap, vision, decide, or "heavy:<agent>" for an agent with its own model. */
export type Role = "heavy" | "cheap" | "vision" | "decide" | "escalate" | `heavy:${string}`;

export interface TextBlock {
  type: "text";
  text: string;
  /** Mark the end of a stable prefix so the provider can cache everything before it. */
  cache?: boolean;
}

/** The model asked to run a tool. `meta` carries provider data that must be sent back unchanged (for example Gemini thought signatures). */
export interface ToolCallBlock {
  type: "tool_call";
  id: string;
  name: string;
  input: Record<string, unknown>;
  meta?: unknown;
}

/** What the tool returned, sent back to the model. */
export interface ToolResultBlock {
  type: "tool_result";
  id: string;
  name: string;
  content: string;
  isError?: boolean;
}

/** A picture sent to the model (camera snapshot). Base64 without the data: prefix. */
export interface ImageBlock {
  type: "image";
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  data: string;
}

export type Block = TextBlock | ToolCallBlock | ToolResultBlock | ImageBlock;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string | Block[];
}

/** A tool the model may call. Schemas stay simple (type, properties, required, enum, description) so every provider accepts them. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export interface ChatRequest {
  system?: TextBlock[];
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  tools?: ToolSpec[];
  /** Built-in model reasoning before answering. Used for hard steps only; ignored by models that lack it. */
  reasoning?: "low" | "medium" | "high";
}

/** Thinking-token budgets per level, for providers that take a number. */
export const REASONING_BUDGET = { low: 1024, medium: 4096, high: 12000 } as const;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ChatResponse {
  text: string;
  /** Tools the model wants to run, in order. Empty when it answered directly. */
  toolCalls?: ToolCallBlock[];
  model: string;
  usage: Usage;
  stopReason: string | null;
  /** The model's reasoning, when the provider shares it (shown as a summary, never sent to tools). */
  thinking?: string;
}

/** One provider model behind the Gateway. */
export interface ChatModel {
  id: string;
  /** onText, when given, receives reply text as it is written (streaming). The full response is still returned. */
  chat(req: ChatRequest, signal?: AbortSignal, onText?: (delta: string) => void): Promise<ChatResponse>;
}

/** Prices in US dollars per million tokens, set in Settings > Models. */
export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export class ModelError extends Error {
  constructor(
    message: string,
    public status: number,
    /** True when another model in the fallback chain should be tried. */
    public retryable: boolean,
  ) {
    super(message);
    this.name = "ModelError";
  }
}

export type Fetch = typeof fetch;

/** All text in a message, ignoring tool blocks. */
export const textOf = (c: string | Block[]): string => (typeof c === "string" ? c : c.filter((b): b is TextBlock => b.type === "text").map((b) => b.text).join("\n\n"));
export const blocksOf = (c: string | Block[]): Block[] => (typeof c === "string" ? [{ type: "text", text: c }] : c);
