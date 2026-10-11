import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagramFile } from "../../model/types";
import {
  capThread,
  latestTurn,
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

  it("offers Undo only for the last change, while the diagram is still as it left it", () => {
    const one = diagram(["api"]);
    const two = diagram(["api", "db"]);
    const turns = [turn(0, one), turn(1, two), turn(2, undefined, { kind: "explain" })];
    expect(latestTurn(turns, two)?.id).toBe("t1");
    expect(latestTurn(turns, one)).toBeUndefined();
    expect(latestTurn([turn(0, one), turn(1, two, { undone: true })], two)).toBeUndefined();
  });

  it("round-trips through storage per diagram, and an empty thread removes its key", () => {
    saveThread("doc-a", [turn(0, diagram(["api"]))]);
    expect(loadThread("doc-a")).toHaveLength(1);
    expect(loadThread("doc-b")).toEqual([]);
    saveThread("doc-a", []);
    expect(localStorage.length).toBe(0);
  });
});
