import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CACHED_THREADS, threads } from "./threadStore";
import type { ThreadTurn } from "./thread";

const turn = (summary: string): Omit<ThreadTurn, "id" | "at"> => ({
  kind: "change",
  request: "",
  summary,
  changed: [],
});

/** Node has no localStorage: a Map-backed stand-in. */
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

describe("thread store", () => {
  beforeEach(() => localStorage.clear());

  it("keeps a bounded number of unwatched threads in memory, reloading the rest from storage", () => {
    for (let i = 0; i < MAX_CACHED_THREADS + 6; i++) threads.append(`lru-${i}`, turn(`change ${i}`));
    expect(threads.cachedCount()).toBeLessThanOrEqual(MAX_CACHED_THREADS);
    // An evicted thread comes back from storage.
    expect(threads.get("lru-0").map((t) => t.summary)).toEqual(["change 0"]);
  });

  it("never drops a thread on screen, and forgets its listeners when it leaves", () => {
    const heard = vi.fn();
    const off = threads.subscribe("watched", heard);
    threads.append("watched", turn("kept"));
    const kept = threads.get("watched");
    // Storage loses it (full, say): memory still holds it while it's watched.
    localStorage.clear();
    for (let i = 0; i < MAX_CACHED_THREADS + 6; i++) threads.append(`other-${i}`, turn(`x${i}`));
    expect(threads.get("watched")).toBe(kept);
    expect(heard).toHaveBeenCalledTimes(1);
    off();
    for (let i = 0; i < MAX_CACHED_THREADS + 6; i++) threads.append(`more-${i}`, turn(`y${i}`));
    expect(threads.get("watched")).toEqual([]);
  });
});
