import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagramFile } from "../../model/types";
import {
  capThread,
  validTurn,
  loadThread,
  MAX_SNAPSHOTS,
  MAX_TURNS,
  sameContent,
  saveThread,
  type ThreadTurn,
} from "./thread";

const diagram = (labels: string[]): DiagramFile => ({
  format: "diagrams/v1",
  title: "T",
  nodes: labels.map((label, i) => ({ id: `n${i}`, stencil: "generic.service", label, x: i * 200, y: 0 })),
  edges: [],
});

const turn = (i: number, after?: DiagramFile, extra: Partial<ThreadTurn> = {}): ThreadTurn => ({
  id: `t${i}`,
  at: i,
  request: `request ${i}`,
  kind: "change",
  changed: [],
  ...(after ? { after } : {}),
  ...extra,
});

/** Node has no localStorage: a Map-backed stand-in. */
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  get length() {
    return store.size;
  },
});

describe("thread", () => {
  beforeEach(() => store.clear());

  it("keeps the newest turns, and snapshots only on the newest few", () => {
    const turns = Array.from({ length: MAX_TURNS + 5 }, (_, i) => turn(i, diagram([`n${i}`])));
    const capped = capThread(turns);
    expect(capped).toHaveLength(MAX_TURNS);
    expect(capped[0].id).toBe("t5");
    expect(capped.filter((t) => t.after)).toHaveLength(MAX_SNAPSHOTS);
    expect(capped.at(-1)?.after).toBeDefined();
    expect(capped[0].after).toBeUndefined();
  });

  it("truncates long replies", () => {
    const [t] = capThread([turn(0, undefined, { reply: "x".repeat(10_000) })]);
    expect(t.reply!.length).toBeLessThan(4100);
  });

  it("compares content, not positions", () => {
    const a = diagram(["api", "db"]);
    const moved = { ...a, nodes: a.nodes.map((n) => ({ ...n, x: n.x + 50 })) };
    expect(sameContent(a, moved)).toBe(true);
    expect(sameContent(a, diagram(["api", "cache"]))).toBe(false);
  });

  it("drops malformed stored turns and snapshots instead of crashing, and caps on load", () => {
    const good = turn(1, diagram(["api"]));
    store.set(
      "diagrams.ai-thread.v1:doc-x",
      JSON.stringify({
        turns: [
          null,
          "nope",
          { id: 3, request: "x", kind: "change" },
          { id: "t2", request: "bad snapshot", kind: "change", changed: "x", after: { nodes: "oops" } },
          { id: "t9", request: "bad kind", kind: "delete" },
          good,
        ],
      }),
    );
    const loaded = loadThread("doc-x");
    expect(loaded.map((t) => t.id)).toEqual(["t2", "t1"]);
    expect(loaded[0].after).toBeUndefined();
    expect(loaded[0].changed).toEqual([]);
    expect(loaded[1].after?.nodes).toHaveLength(1);
    store.set("diagrams.ai-thread.v1:doc-y", "{not json");
    expect(loadThread("doc-y")).toEqual([]);
    expect(
      validTurn({ id: "a", request: "", kind: "explain", scope: [{ id: 1 }, { id: "n", label: "N" }] })?.scope,
    ).toEqual([{ id: "n", label: "N" }]);
    const many = Array.from({ length: MAX_TURNS + 3 }, (_, i) => turn(i));
    store.set("diagrams.ai-thread.v1:doc-z", JSON.stringify({ turns: many }));
    expect(loadThread("doc-z")).toHaveLength(MAX_TURNS);
  });

  it("round-trips through storage per diagram, and an empty thread removes its key", () => {
    saveThread("doc-a", [turn(0, diagram(["api"]))]);
    expect(loadThread("doc-a")).toHaveLength(1);
    expect(loadThread("doc-b")).toEqual([]);
    saveThread("doc-a", []);
    expect(localStorage.length).toBe(0);
  });

  it("validates and persists neutral revert metadata while retaining legacy requests", () => {
    const revert = turn(1, undefined, { kind: "revert", request: "", revertLabel: "My original request" });
    saveThread("revert", [revert]);
    expect(loadThread("revert")[0]).toEqual(revert);
    expect(validTurn({ ...revert, revertLabel: 42 })?.revertLabel).toBeUndefined();
    expect(validTurn({ ...revert, kind: "change" })?.revertLabel).toBeUndefined();
    const legacy = turn(2, undefined, { kind: "revert", request: "Reverted to an older change" });
    expect(validTurn(legacy)?.request).toBe(legacy.request);
    expect(validTurn({ ...revert, revertLabel: "" })?.revertLabel).toBe("");
  });
});
