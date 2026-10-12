import { describe, expect, it } from "vitest";
import { fromFlow, toFlow } from "../canvas/convert";
import type { DiagramFile, DiagramNode } from "../model/types";
import { commit, commitReplacement, createHistory, MERGE_WINDOW_MS, present } from "./history";
import {
  selectionOf,
  snapshotKey,
  stepChanges,
  stepWithSelection,
  withSelection,
  type CanvasHistory,
  type FlowSelection,
} from "./historySelection";
import type { CanvasSnapshot } from "./useHistory";

/** Payments (0, 0, 640 × 400) holds api, worker and ledger; cache sits outside; two edges. */
const SEED: DiagramFile = {
  format: "diagrams/v1",
  title: "Undo and the selection",
  groups: [{ id: "pay", label: "Payments", tone: "azure", x: 0, y: 0, width: 640, height: 400 }],
  nodes: [
    { id: "api", stencil: "service.node", label: "Orders API", x: 40, y: 80, group: "pay" },
    { id: "worker", stencil: "service.go", label: "Payment worker", x: 380, y: 80, group: "pay" },
    { id: "ledger", stencil: "postgres", label: "Ledger", x: 40, y: 260, group: "pay" },
    { id: "cache", stencil: "redis.cache", label: "Cache", x: 700, y: 560 },
  ],
  edges: [
    { id: "a-w", from: "api", to: "worker" },
    { id: "w-l", from: "worker", to: "ledger", kind: "sync" },
  ],
};

const sel = (nodes: string[] = [], edges: string[] = []): FlowSelection => ({ nodes, edges });
const file = (s: CanvasSnapshot) => fromFlow(s.meta, s.nodes, s.edges);
const selected = (s: CanvasSnapshot) => {
  const { nodes, edges } = selectionOf(s);
  return { nodes: [...nodes].sort(), edges: [...edges].sort() };
};

/**
 * The canvas as useHistory sees it: every state change goes through `set`, a settled change through `flush`
 * (the debounce), and Undo / Redo through the same step function the hook calls.
 */
class Canvas {
  state: CanvasSnapshot;
  history: CanvasHistory;
  private settled: FlowSelection;
  private clock = 1_000_000;
  constructor(d: DiagramFile, selection = sel()) {
    this.state = withSelection(toFlow(d), selection);
    this.history = createHistory(snapshotKey(this.state), this.state, 0);
    this.settled = selectionOf(this.state);
  }
  set(next: CanvasSnapshot) {
    this.state = next;
    if (snapshotKey(next) === present(this.history).key) this.settled = selectionOf(next);
  }
  /** Changes the document, keeping or setting the selection. */
  edit(change: (d: DiagramFile) => DiagramFile, selection?: FlowSelection) {
    const next = toFlow(change(file(this.state)));
    this.set(withSelection(next, selection ?? selectionOf(this.state)));
  }
  select(selection: FlowSelection) {
    this.set(withSelection(this.state, selection));
  }
  flush(mergeKey?: string, gap = MERGE_WINDOW_MS * 2) {
    this.clock += gap;
    const s = this.state;
    this.history = commit(this.history, {
      key: snapshotKey(s),
      value: s,
      mergeKey,
      at: this.clock,
      start: this.settled,
    });
    this.set(s);
  }
  /** An AI turn: one tagged replacement, as EditorApi.applyDiagram makes it. */
  replace(change: (d: DiagramFile) => DiagramFile, tag: string) {
    const current = this.state;
    const next = toFlow(change(file(current)));
    this.clock += MERGE_WINDOW_MS * 2;
    this.history = commitReplacement(
      this.history,
      { key: snapshotKey(current), value: current, at: this.clock, start: this.settled },
      { key: snapshotKey(next), value: next, mergeKey: tag, at: this.clock, start: selectionOf(current) },
    );
    this.set(next);
  }
  undo() {
    this.step("undo");
  }
  redo() {
    this.step("redo");
  }
  private step(direction: "undo" | "redo") {
    this.flush();
    const step = stepWithSelection(this.history, direction, selectionOf(this.state));
    if (!step) return;
    this.history = step.history;
    this.set(step.snapshot);
  }
}

const mapNodes = (ids: string[], f: (n: DiagramNode) => DiagramNode) => (d: DiagramFile) => ({
  ...d,
  nodes: d.nodes.map((n) => (ids.includes(n.id) ? f(n) : n)),
});
const nodeOf = (c: Canvas, id: string) => file(c.state).nodes.find((n) => n.id === id);

describe("undo and the selection", () => {
  it("selection changes alone never make a step", () => {
    const c = new Canvas(SEED);
    const before = c.history;
    c.select(sel(["api", "worker"], ["a-w"]));
    c.flush();
    c.select(sel(["group:pay"]));
    c.flush();
    expect(c.history).toBe(before);
    expect(snapshotKey(c.state)).toBe(present(before).key);
  });

  it("undoing a bulk edit keeps the edited nodes selected, as they were; redo selects them as edited", () => {
    const c = new Canvas(SEED);
    const three = ["api", "cache", "worker"];
    c.select(sel(three));
    c.edit(mapNodes(three, (n) => ({ ...n, stencil: "postgres" })));
    c.flush();
    // Even after clicking elsewhere, Undo goes back to what the edit changed.
    c.select(sel(["ledger"]));
    c.undo();
    expect(selected(c.state)).toEqual(sel(three));
    expect(three.map((id) => nodeOf(c, id)?.stencil)).toEqual(["service.node", "redis.cache", "service.go"]);
    c.select(sel());
    c.redo();
    expect(selected(c.state)).toEqual(sel(three));
    expect(three.map((id) => nodeOf(c, id)?.stencil)).toEqual(["postgres", "postgres", "postgres"]);
  });

  it("Select similar, then an edit: undo keeps the similar ones selected", () => {
    const c = new Canvas(SEED);
    c.select(sel(["worker"]));
    c.select(sel(["api", "worker"])); // Select similar is a selection change: no step.
    c.flush();
    expect(c.history.entries).toHaveLength(1);
    c.edit(mapNodes(["api", "worker"], (n) => ({ ...n, props: { replicas: 3 } })));
    c.flush();
    c.undo();
    expect(selected(c.state)).toEqual(sel(["api", "worker"]));
  });

  it("undoing Tidy up keeps the tidied nodes selected (one stayed put), not the boundary that grew", () => {
    const c = new Canvas(SEED);
    const tidied = ["api", "ledger", "worker"];
    c.select(sel(tidied));
    // Its top-left kept: Orders API doesn't move.
    c.edit((d) => ({
      ...mapNodes(["worker", "ledger"], (n) => ({ ...n, y: 80, x: n.id === "worker" ? 380 : 720 }))(d),
      groups: [{ ...d.groups![0], width: 980 }],
    }));
    c.flush();
    c.undo();
    expect(selected(c.state)).toEqual(sel(tidied));
    expect(file(c.state).groups![0].width).toBe(640);
    c.redo();
    expect(selected(c.state)).toEqual(sel(tidied));
  });

  it("undoing an align gives back the whole selection it aligned; a boundary drag, the boundary alone", () => {
    const c = new Canvas(SEED);
    // Align left: Orders API is the leftmost, so only Cache moves.
    c.select(sel(["api", "cache"]));
    c.edit(mapNodes(["cache"], (n) => ({ ...n, x: 40 })));
    c.flush();
    c.select(sel());
    c.undo();
    expect(selected(c.state)).toEqual(sel(["api", "cache"]));
    c.select(sel(["worker"]));
    c.redo();
    expect(selected(c.state)).toEqual(sel(["api", "cache"]));
    c.undo();

    // A nudge, then a click elsewhere: Undo goes back to the nudged node.
    c.select(sel(["cache"]));
    c.edit(mapNodes(["cache"], (n) => ({ ...n, x: 900 })));
    c.flush();
    c.select(sel(["ledger"]));
    c.undo();
    expect(selected(c.state)).toEqual(sel(["cache"]));

    c.select(sel(["group:pay"]));
    c.edit((d) => ({
      ...mapNodes(["api", "worker", "ledger"], (n) => ({ ...n, x: n.x + 100, y: n.y + 50 }))(d),
      groups: [{ ...d.groups![0], x: 100, y: 50 }],
    }));
    c.flush();
    c.select(sel());
    c.undo();
    expect(selected(c.state)).toEqual(sel(["group:pay"]));
  });

  it("undoing a delete selects the restored elements; redoing it keeps what's left of the selection", () => {
    const c = new Canvas(SEED);
    c.select(sel(["ledger"]));
    c.edit(
      (d) => ({ ...d, nodes: d.nodes.filter((n) => n.id !== "ledger"), edges: d.edges.filter((e) => e.id !== "w-l") }),
      sel(),
    );
    c.flush();
    c.select(sel(["cache"]));
    c.undo();
    expect(nodeOf(c, "ledger")).toBeDefined();
    expect(selected(c.state)).toEqual(sel(["ledger"], ["w-l"]));
    c.redo();
    expect(nodeOf(c, "ledger")).toBeUndefined();
    expect(selected(c.state)).toEqual(sel());
  });

  it("undoing an add selects nothing new: the current selection where it exists, else the one before the add", () => {
    const add = (d: DiagramFile): DiagramFile => ({
      ...d,
      nodes: [...d.nodes, { id: "billing", stencil: "service.go", label: "Billing", x: 1000, y: 560 }],
      edges: [...d.edges, { id: "c-b", from: "cache", to: "billing" }],
    });
    // Quick-add after Cache: the new node is selected; undo goes back to Cache.
    let c = new Canvas(SEED, sel(["cache"]));
    c.edit(add, sel(["billing"]));
    c.flush();
    c.undo();
    expect(nodeOf(c, "billing")).toBeUndefined();
    expect(selected(c.state)).toEqual(sel(["cache"]));
    // Redo selects what it added.
    c.redo();
    expect(selected(c.state)).toEqual(sel(["billing"], ["c-b"]));

    // Something else picked since: it stays.
    c = new Canvas(SEED, sel(["cache"]));
    c.edit(add, sel(["billing"]));
    c.flush();
    c.select(sel(["api", "billing"]));
    c.undo();
    expect(selected(c.state)).toEqual(sel(["api"]));
  });

  it("undoing an add inside a boundary that grew for it doesn't select the boundary", () => {
    const c = new Canvas(SEED, sel(["ledger"]));
    c.edit(
      (d) => ({
        ...d,
        groups: [{ ...d.groups![0], height: 520 }],
        nodes: [...d.nodes, { id: "audit", stencil: "postgres", label: "Audit", x: 40, y: 420, group: "pay" }],
        edges: [...d.edges, { id: "l-a", from: "ledger", to: "audit" }],
      }),
      sel(["audit"]),
    );
    c.flush();
    c.undo();
    expect(selected(c.state)).toEqual(sel(["ledger"]));
  });

  it("a node made and named in one step (#44) undoes in one, back to the selection before it", () => {
    const c = new Canvas(SEED, sel(["cache"]));
    c.edit(
      (d) => ({ ...d, nodes: [...d.nodes, { id: "n1", stencil: "service.go", label: "", x: 1000, y: 560 }] }),
      sel(["n1"]),
    );
    c.flush("add:n1");
    c.edit(mapNodes(["n1"], (n) => ({ ...n, label: "Billing" })));
    c.flush("add:n1", 200);
    expect(c.history.entries).toHaveLength(2);
    expect(present(c.history).mergeKey).toBe("add:n1");
    c.undo();
    expect(nodeOf(c, "n1")).toBeUndefined();
    expect(selected(c.state)).toEqual(sel(["cache"]));
  });

  it("an AI turn keeps its tag through undo and redo, and undo selects what it changed", () => {
    const c = new Canvas(SEED, sel(["cache"]));
    c.replace((d) => {
      const renamed = mapNodes(["api"], (n) => ({ ...n, label: "Orders" }))(d);
      return {
        ...renamed,
        nodes: [...renamed.nodes, { id: "queue", stencil: "kafka.topic", label: "orders", x: 700, y: 80 }],
      };
    }, "ai:turn-1");
    expect(present(c.history).mergeKey).toBe("ai:turn-1");
    c.undo();
    expect(nodeOf(c, "api")?.label).toBe("Orders API");
    expect(selected(c.state)).toEqual(sel(["api"]));
    c.redo();
    expect(present(c.history).mergeKey).toBe("ai:turn-1");
    expect(selected(c.state)).toEqual(sel(["api", "queue"]));
  });

  it("undoing a change to the title alone keeps the selection", () => {
    const c = new Canvas(SEED);
    c.edit((d) => ({ ...d, title: "Renamed" }));
    c.flush();
    c.select(sel(["worker"], ["a-w"]));
    c.undo();
    expect(file(c.state).title).toBe("Undo and the selection");
    expect(selected(c.state)).toEqual(sel(["worker"], ["a-w"]));
  });

  it("membership of a boundary that came or went doesn't count as a change to its members", () => {
    const d = file(new Canvas(SEED).state);
    const ungrouped: DiagramFile = { ...d, groups: [], nodes: d.nodes.map((n) => ({ ...n, group: undefined })) };
    expect(stepChanges(d, ungrouped)).toEqual({ before: sel(["group:pay"]), after: sel() });
    expect(stepChanges(ungrouped, d)).toEqual({ before: sel(), after: sel(["group:pay"]) });
  });

  it("a bulk edit that changed only some of the selection gives back all of it", () => {
    const c = new Canvas(SEED);
    // Ledger is already PostgreSQL: only two of the three change.
    c.select(sel(["api", "worker", "ledger"]));
    c.edit(mapNodes(["api", "worker", "ledger"], (n) => ({ ...n, stencil: "postgres" })));
    c.flush();
    c.select(sel());
    c.undo();
    expect(selected(c.state)).toEqual(sel(["api", "ledger", "worker"]));
  });

  it("a change beyond the selection it was made with selects just what changed", () => {
    const c = new Canvas(SEED);
    c.select(sel(["api", "cache"]));
    c.edit(mapNodes(["worker"], (n) => ({ ...n, label: "Worker" })));
    c.flush();
    c.undo();
    expect(selected(c.state)).toEqual(sel(["worker"]));
  });

  it("there's nothing to step to at either end", () => {
    const c = new Canvas(SEED);
    expect(stepWithSelection(c.history, "undo", sel())).toBeNull();
    expect(stepWithSelection(c.history, "redo", sel())).toBeNull();
  });
});
