// The AI panel briefly let people store a model provider and their own API key in this browser. That's gone:
// AI here works through the browser's own agents. This removes anything it left behind, once per load.

/** Storage keys the removed "Connect a model" setting used. */
export const LEGACY_AI_KEYS = ["diagrams.ai-model.v1"] as const;

/** Removes them; `storage` defaults to localStorage (read inside the guard: blocked storage throws on access). */
export function forgetLegacyAiKeys(storage?: Pick<Storage, "removeItem"> | null): void {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    for (const key of LEGACY_AI_KEYS) target?.removeItem(key);
  } catch {
    // Storage blocked: there's nothing stored to remove either.
  }
}
