// Loaded on the first request to a connected model (a chunk of its own): the adapters and the agent loop.

import { anthropic } from "./anthropic";
import { gemini } from "./gemini";
import { openai } from "./openai";
import type { ProviderAdapter, ProviderId } from "./types";

export const adapters: Record<ProviderId, ProviderAdapter> = { anthropic, openai, gemini };
export { runAgentTurn, type AgentTurnResult } from "./agent";
export { ProviderError } from "./types";
export { redact } from "./http";
