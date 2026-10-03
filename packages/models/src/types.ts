export type Role = "heavy" | "cheap" | "vision" | "decide";

export interface TextBlock {
  type: "text";
  text: string;
  /** Mark the end of a stable prefix so the provider can cache everything before it. */
  cache?: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string | TextBlock[];
}

export interface ChatRequest {
  system?: TextBlock[];
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ChatResponse {
  text: string;
  model: string;
  usage: Usage;
  stopReason: string | null;
}

/** One provider model behind the Gateway. */
export interface ChatModel {
  id: string;
  chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>;
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
