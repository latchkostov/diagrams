// The connected model: provider, model and the user's key, in this browser's storage only. Never part of
// a diagram, an export, a share link or the conversation. Small and dependency-free: the panel reads it on
// open; the adapters load only when a request is sent.

import { useSyncExternalStore } from "react";
import type { ProviderId } from "./types";

const KEY = "diagrams.ai-model.v1";

export interface Connection {
  provider: ProviderId;
  model: string;
  key: string;
}

export const PROVIDERS: readonly { id: ProviderId; label: string; vendor: string; models: readonly string[] }[] = [
  { id: "anthropic", label: "Claude", vendor: "Anthropic", models: ["claude-haiku-5-5", "claude-sonnet-5-5"] },
  { id: "openai", label: "OpenAI", vendor: "OpenAI", models: ["gpt-5-mini", "gpt-5"] },
  { id: "gemini", label: "Gemini", vendor: "Google", models: ["gemini-2.5-flash", "gemini-2.5-pro"] },
];

export const providerInfo = (id: ProviderId) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];

/** "Claude Haiku 5.5" from "claude-haiku-5-5"; other ids as they are. */
export function modelLabel(model: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(model);
  return m ? `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : model;
}

const valid = (c: Partial<Connection> | null): c is Connection =>
  !!c &&
  PROVIDERS.some((p) => p.id === c.provider) &&
  typeof c.model === "string" &&
  !!c.model.trim() &&
  typeof c.key === "string" &&
  !!c.key.trim();

function read(): Connection | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Connection> | null;
    return valid(raw) ? raw : null;
  } catch {
    return null;
  }
}

let state: Connection | null | undefined;
const listeners = new Set<() => void>();
const current = () => (state === undefined ? (state = read()) : state);

export const connection = {
  get: current,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  /** Saves (or, with null, forgets) the connection. False when the browser refused to store it. */
  set(next: Connection | null): boolean {
    let stored = true;
    try {
      if (next) localStorage.setItem(KEY, JSON.stringify({ ...next, key: next.key.trim(), model: next.model.trim() }));
      else localStorage.removeItem(KEY);
    } catch {
      stored = false;
    }
    state = next ? { ...next, key: next.key.trim(), model: next.model.trim() } : null;
    for (const l of listeners) l();
    return stored;
  },
};

export function useConnection(): Connection | null {
  return useSyncExternalStore(connection.subscribe, connection.get, connection.get);
}
