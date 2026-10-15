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

it.each([false, true])("shares the example snapshot budget with threads (storage fails: %s)", async (fails) => {
  const { readConversation, retainConversation, cachedConversationCount } =
    await import("../../lib/exampleConversations");
  const { saveThread } = await import("./thread");
  const set = vi.spyOn(localStorage, "setItem");
  if (fails)
    set.mockImplementation(() => {
      throw new Error("full");
    });
  const identity = `example:pinned-${fails}`;
  const release = retainConversation(identity);
  const turns: ThreadTurn[] = [{ ...turn("Kept"), id: "kept", at: 1 }];
  try {
    saveThread(identity, turns);
    const raw = readConversation(identity);
    for (let i = 0; i < MAX_CACHED_THREADS + 6; i++) {
      const id = `example:budget-${fails}-${i}`;
      threads.set(id, [{ ...turn(`change ${i}`), id: "turn", at: 1 }]);
      expect(cachedConversationCount()).toBeLessThanOrEqual(MAX_CACHED_THREADS);
    }
    expect(readConversation(identity)).toBe(raw);
    const evicted = readConversation(`example:budget-${fails}-0`);
    expect(evicted === null).toBe(fails);
    if (!fails) expect(JSON.parse(evicted!).turns[0].summary).toBe("change 0");
    release();
    for (let i = 0; i < MAX_CACHED_THREADS + 1; i++) threads.append(`release-${i}`, turn("other"));
    // An inactive session reloads durable storage; a refused write is no longer retained.
    if (fails) expect(readConversation(identity)).toBeNull();
  } finally {
    release();
    set.mockRestore();
  }
});
