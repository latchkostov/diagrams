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
