import { safeStorage } from "./storage";
import { useEffect, useState } from "react";

/** Recently used stencils (newest first), pinned at the top of the canvas palette. */
export const RECENT_KEY = "diagrams.recentStencils.v1";
export const RECENT_MAX = 6;
const EVENT = "diagrams:recent-stencils";

export function getRecentStencils(): string[] {
  try {
    const raw = JSON.parse(safeStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Pure list update: move `id` to the front, de-duplicate, cap the length. */
export function withRecent(list: readonly string[], id: string, max = RECENT_MAX): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}

export function pushRecentStencil(id: string) {
  try {
    safeStorage.setItem(RECENT_KEY, JSON.stringify(withRecent(getRecentStencils(), id)));
  } catch {
    // Storage full or blocked: recents are a nicety.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useRecentStencils(): string[] {
  const [list, setList] = useState(getRecentStencils);
  useEffect(() => {
    const sync = () => setList(getRecentStencils());
    const onStorage = (e: StorageEvent) => e.key === RECENT_KEY && sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return list;
}
