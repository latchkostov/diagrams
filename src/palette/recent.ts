import { safeStorage } from "../lib/storage";

/** Recently run palette commands, newest first. */
export const RECENT_COMMANDS_KEY = "diagrams.paletteRecent.v1";
export const RECENT_COMMANDS_MAX = 8;

export function getRecentCommands(storage: Pick<Storage, "getItem"> = safeStorage): string[] {
  try {
    const raw = JSON.parse(storage.getItem(RECENT_COMMANDS_KEY) ?? "[]");
    return Array.isArray(raw)
      ? raw.filter((v): v is string => typeof v === "string").slice(0, RECENT_COMMANDS_MAX)
      : [];
  } catch {
    return [];
  }
}

/** Pure list update: move `id` to the front, de-duplicate, cap the length. */
export function withRecentCommand(list: readonly string[], id: string, max = RECENT_COMMANDS_MAX): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}

export function pushRecentCommand(id: string, storage: Pick<Storage, "getItem" | "setItem"> = safeStorage) {
  storage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(withRecentCommand(getRecentCommands(storage), id)));
}

/**
 * Whether a run command is remembered: a private diagram's nodes and simulations never are. Their ids are the
 * diagram's own words, and this list outlives the diagram (it's one list for every diagram).
 */
export function rememberable(id: string, privateDiagram: boolean): boolean {
  return !(privateDiagram && (id.startsWith("node:") || id.startsWith("sim:")));
}
