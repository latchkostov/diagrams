// A model the user connects with their own key, called straight from the browser (there is no backend).
// Each provider adapter speaks its own wire format; the agent loop (agent.ts) only sees these shapes.

export type ProviderId = "anthropic" | "openai" | "gemini";

/** A tool the model may call: the WebMCP tool definitions, unchanged. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  /** The provider's call id (Gemini's may be synthesised). */
  id: string;
  name: string;
  input: unknown;
  /** The arguments didn't parse as JSON: returned to the model as an error, never run. */
  invalid?: string;
}

export interface ToolOutcome {
  call: ToolCall;
  /** JSON text for the model. */
  output: string;
  isError: boolean;
}

export interface StepRequest {
  key: string;
  model: string;
  system: string;
  tools: readonly ToolSpec[];
  /** The provider's native messages so far. */
  messages: readonly unknown[];
  signal?: AbortSignal;
  /** Streamed text as it arrives. */
  onText(delta: string): void;
  /** Test seam; defaults to the global fetch. */
  fetch?: typeof fetch;
}

export interface StepResult {
  text: string;
  calls: ToolCall[];
  /** "tools": run the calls and step again; "end": done; "length" / "refused": stopped early. */
  stop: "end" | "tools" | "length" | "refused";
  /** The assistant message in the provider's native format, appended before the tool results. */
  assistant: unknown;
}

export interface ProviderAdapter {
  id: ProviderId;
  /** "Claude", "OpenAI", "Gemini". */
  label: string;
  /** Native messages for a conversation: earlier turns as plain text, then the new request. */
  start(history: readonly { role: "user" | "assistant"; text: string }[], request: string): unknown[];
  step(req: StepRequest): Promise<StepResult>;
  /** Native messages carrying the tool results back. */
  results(outcomes: readonly ToolOutcome[]): unknown[];
}

/** A failed call, with any secret already removed from the message. */
export class ProviderError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}
