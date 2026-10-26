import { upgradeWaits } from "../planning/migration";
import { waitingFixture } from "../lab/waitingFixture";
import { describe, expect, it } from "vitest";
import { fromFlow, toFlow } from "../canvas/convert";
import type { DiagramFile, DiagramNode } from "../model/types";
import { MERGE_WINDOW_MS, present } from "./history";
import { HistoryController } from "./historyController";
import type { CanvasSnapshot } from "./useHistory";

// Creation transactions: a node made by quick-add (or Alt+arrow, the "+", a dropped connection, Insert node) and
// the name typed in its editor are one undo step however long the naming takes, unless another edit comes between.

const SEED: DiagramFile = {
  format: "diagrams/v1",
  title: "Creation",
  nodes: [{ id: "api", stencil: "service.node", label: "Orders API", x: 0, y: 0 }],
  edges: [],
};
const TAG = "new:db";
const DB: DiagramNode = { id: "db", stencil: "postgres", label: "PostgreSQL", x: 300, y: 0 };

const snap = (d: DiagramFile): CanvasSnapshot => toFlow(d);
const withNodes = (...nodes: DiagramNode[]): DiagramFile => ({ ...SEED, nodes: [...SEED.nodes, ...nodes] });
const added = snap(withNodes(DB));
const named = snap(withNodes({ ...DB, label: "Ledger" }));
const labelsOf = (s: CanvasSnapshot | null) => (s ? fromFlow(s.meta, s.nodes, s.edges).nodes.map((n) => n.label) : []);

describe("creation transactions", () => {
  it("merge the name into the node's step however long the naming took", () => {
    const ctl = new HistoryController(snap(SEED), 0);
    ctl.begin(TAG);
    ctl.commit(added, TAG, 1_000);
    // Named ten merge windows later.
    ctl.commit(named, TAG, 1_000 + 10 * MERGE_WINDOW_MS);
    ctl.end(TAG);
    expect(ctl.history.entries).toHaveLength(2);
    expect(labelsOf(present(ctl.history).value)).toEqual(["Orders API", "Ledger"]);
    // One undo takes the node and its name.
    expect(labelsOf(ctl.step("undo", { nodes: [], edges: [] }))).toEqual(["Orders API"]);
  });

  it("without a transaction, a late name is a step of its own (the window still applies elsewhere)", () => {
    const ctl = new HistoryController(snap(SEED), 0);
    ctl.commit(added, TAG, 1_000);
    ctl.commit(named, TAG, 1_000 + 10 * MERGE_WINDOW_MS);
    expect(ctl.history.entries).toHaveLength(3);
  });

  it("close when another edit comes between: the name is then its own step", () => {
    const ctl = new HistoryController(snap(SEED), 0);
    ctl.begin(TAG);
    ctl.commit(added, TAG, 1_000);
    const moved = snap(withNodes({ ...DB, x: 400 }));
    ctl.commit(moved, undefined, 1_200);
    expect(ctl.openTransaction).toBeUndefined();
    ctl.commit(snap(withNodes({ ...DB, x: 400, label: "Ledger" })), TAG, 1_000 + 10 * MERGE_WINDOW_MS);
    expect(ctl.history.entries).toHaveLength(4);
  });

  it("close on Undo and on end()", () => {
    const ctl = new HistoryController(snap(SEED), 0);
    ctl.begin(TAG);
    ctl.commit(added, TAG, 1_000);
    ctl.step("undo", { nodes: [], edges: [] });
    expect(ctl.openTransaction).toBeUndefined();

    const other = new HistoryController(snap(SEED), 0);
    other.begin(TAG);
    other.commit(added, TAG, 1_000);
    other.end(TAG);
    other.commit(named, TAG, 1_000 + 10 * MERGE_WINDOW_MS);
    expect(other.history.entries).toHaveLength(3);
  });

  it("ignore end() for another tag, and a commit that changes nothing doesn't close them", () => {
    const ctl = new HistoryController(snap(SEED), 0);
    ctl.begin(TAG);
    ctl.commit(added, TAG, 1_000);
    ctl.end("new:other");
    ctl.commit(added, undefined, 1_500);
    expect(ctl.openTransaction).toBe(TAG);
    ctl.commit(named, TAG, 9_000);
    expect(ctl.history.entries).toHaveLength(2);
  });
});

it("a generated copy name preserves tagged steps, undo, redo and redo branches", () => {
  const ctl = new HistoryController(snap(SEED), 0);
  ctl.replace(snap(SEED), undefined, added, "ai:turn:1", { nodes: [], edges: [] }, 10);
  const before = ctl.history.entries.length;
  ctl.renameTitle("Creation", "Creation (copy)");
  expect(ctl.history.entries).toHaveLength(before);
  expect(present(ctl.history).mergeKey).toBe("ai:turn:1");
  const undone = ctl.step("undo", { nodes: [], edges: [] });
  expect(labelsOf(undone)).toEqual(["Orders API"]);
  expect(undone?.meta.title).toBe("Creation (copy)");
  ctl.renameTitle("Creation (copy)", "Creation (copy 2)");
  const redone = ctl.step("redo", { nodes: [], edges: [] });
  expect(labelsOf(redone)).toEqual(["Orders API", "PostgreSQL"]);
  expect(redone?.meta.title).toBe("Creation (copy 2)");
  // Observing or saving this rewritten snapshot must not create another step.
  if (redone) expect(ctl.commit(redone, undefined, 20)).toBe(false);
});

it("restores the entire previous model and saved runs in one request-model undo step", () => {
  const d = waitingFixture();
  d.planning = { revision: "p3-a1" };
  d.simulations = [{ id: "saved", title: "Saved", traffic: [] }];
  const before = snap(d),
    next = snap(upgradeWaits(d));
  const ctl = new HistoryController(before, 0);
  ctl.replace(before, undefined, next, undefined, { nodes: [], edges: [] }, 10);
  expect(ctl.history.entries).toHaveLength(2);
  expect(present(ctl.history).value.meta.planning?.revision).toBe("p3-w1");
  const undone = ctl.step("undo", { nodes: [], edges: [] })!;
  expect(fromFlow(undone.meta, undone.nodes, undone.edges)).toEqual(fromFlow(before.meta, before.nodes, before.edges));
  expect(ctl.step("redo", { nodes: [], edges: [] })?.meta.planning?.revision).toBe("p3-w1");
});

describe("undo entry identity", () => {
  it("survives an edit merged into the same step, and changes with a new step", () => {
    const ctl = new HistoryController(snap(SEED), 0);
    ctl.commit(added, TAG, 1_000);
    const step = ctl.undoEntryId();
    // Same tag inside the merge window: the same step, so an Undo bound to it still names it.
    ctl.commit(named, TAG, 1_000 + MERGE_WINDOW_MS / 2);
    expect(ctl.history.entries).toHaveLength(2);
    expect(ctl.undoEntryId()).toBe(step);
    // Another tag: a step of its own.
    ctl.commit(snap(withNodes({ ...DB, label: "Ledger", x: 600 })), "move", 1_000 + MERGE_WINDOW_MS);
    expect(ctl.undoEntryId()).not.toBe(step);
  });
});
