import { describe, expect, it, vi } from "vitest";
import type { DiagramFile } from "../../model/types";
import type { Evidence } from "../../checks/evidence";
import type { EvidenceProgress } from "../../checks/evidenceClient";
import { withEvidence, type WithEvidence } from "../../checks/evidenceMerge";
import type { CheckResult } from "../../checks/types";
import type { DiagramFlowEdge, FlowNode } from "../types";
import { basisOf, matchesBasis, SimulationRuns, type EvidenceView, type SimContent } from "./simulationRuns";
import { ChecksStore } from "./useChecks";

// Run simulations on the canvas: one run at a time, stopped by Stop, Esc and any edit a simulation would see (not
// by moving or selecting things), and counts that go stale with the diagram and come back with Undo.

const node = (id: string, data: object = { stencil: "service.node", label: id }) =>
  ({ id, type: "diagram", position: { x: 0, y: 0 }, data }) as unknown as FlowNode;
const edge = (id: string, source: string, target: string) =>
  ({ id, source, target, type: "flow", data: { kind: "async" } }) as unknown as DiagramFlowEdge;

const SIMS = [{ id: "s", title: "Payments goes down", traffic: [] }];
function content(): SimContent {
  return { nodes: [node("a"), node("b")], edges: [edge("e", "a", "b")], meta: { simulations: SIMS } };
}
const diagram: DiagramFile = {
  format: "diagrams/v1",
  title: "D",
  nodes: [],
  edges: [],
  simulations: SIMS,
};
const EVIDENCE: Evidence = {
  played: [{ id: "s", title: "Payments goes down", playedMs: 9000, capped: false }],
  unplayed: [],
  tooBig: [],
  losses: [{ simulation: "Payments goes down", node: "q", broker: true, what: "dropped", count: 312 }],
  dropped: [],
};
const COUNTS = [{ simulation: "Payments goes down", what: "dropped", count: 312 }];

/** A client whose run the test finishes, fails or watches being cancelled. */
function fakeClient() {
  const runs: {
    progress: (p: EvidenceProgress) => void;
    resolve: (e: Evidence) => void;
    reject: (e: Error) => void;
    cancel: ReturnType<typeof vi.fn>;
  }[] = [];
  const client = {
    withEvidence,
    playSimulations: (_d: DiagramFile, progress: (p: EvidenceProgress) => void) => {
      let resolve!: (e: Evidence) => void;
      let reject!: (e: Error) => void;
      const done = new Promise<Evidence>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const cancel = vi.fn(() => reject(Object.assign(new Error("Stopped"), { name: "EvidenceStopped" })));
      runs.push({ progress, resolve, reject, cancel });
      return { done, cancel };
    },
  };
  return { client, runs };
}

function setup() {
  const views: EvidenceView[] = [];
  const merges: (((r: CheckResult, d: DiagramFile | undefined) => WithEvidence) | undefined)[] = [];
  const { client, runs } = fakeClient();
  const sims = new SimulationRuns(
    {
      setEvidence: (v, merge) => {
        views.push(v);
        merges.push(merge);
      },
    },
    () => Promise.resolve(client as never),
  );
  sims.setRead(() => diagram);
  const c = content();
  sims.setContent(c);
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { sims, views, merges, runs, c, flush, last: () => views[views.length - 1] };
}

describe("the content a simulation sees", () => {
  it("ignores positions and the selection, and sees any edit to a node, a connection or the simulations", () => {
    const c = content();
    const basis = basisOf(c);
    const moved = {
      ...c,
      nodes: c.nodes.map((n) => ({ ...n, position: { x: 50, y: 9 }, selected: true }) as FlowNode),
    };
    expect(matchesBasis(basis, moved)).toBe(true);
    const renamed = { ...c, nodes: [node("a", { stencil: "service.node", label: "A2" }), c.nodes[1]] };
    expect(matchesBasis(basis, renamed)).toBe(false);
    expect(matchesBasis(basis, { ...c, edges: [] })).toBe(false);
    expect(matchesBasis(basis, { ...c, meta: { simulations: [{ ...SIMS[0], title: "Another" }] } })).toBe(false);
    expect(matchesBasis(basis, { ...c, nodes: [...c.nodes, node("z")] })).toBe(false);
  });

  it("sees membership and props, while ignoring attachment sides and equal replacement props", () => {
    const props = { failureRate: 0.1 };
    const c: SimContent = {
      nodes: [node("a", { stencil: "service.node", label: "A", props }), node("b")],
      edges: [edge("e", "a", "b")],
      meta: { simulations: SIMS },
    };
    const basis = basisOf(c);
    // Dragged into a boundary: its data object is replaced, with the same stencil, label and props.
    const grouped = {
      ...c,
      nodes: [node("a", { stencil: "service.node", label: "A", props, group: "g1" }), c.nodes[1]],
    };
    expect(matchesBasis(basis, grouped)).toBe(false);
    const sides = {
      ...c,
      edges: [{ ...c.edges[0], data: { ...c.edges[0].data!, sourceSide: "top" as const } } as DiagramFlowEdge],
    };
    expect(matchesBasis(basis, sides)).toBe(true);
    // The same props, made again (an applied fix rebuilds every node): still the same to a simulation.
    const remade = {
      ...c,
      nodes: [node("a", { stencil: "service.node", label: "A", props: { failureRate: 0.1 } }), c.nodes[1]],
    };
    expect(matchesBasis(basis, remade)).toBe(true);
    const changed = {
      ...c,
      nodes: [node("a", { stencil: "service.node", label: "A", props: { failureRate: 0.2 } }), c.nodes[1]],
    };
    expect(matchesBasis(basis, changed)).toBe(false);
    const async = {
      ...c,
      edges: [{ ...c.edges[0], data: { ...c.edges[0].data!, kind: "sync" as const } } as DiagramFlowEdge],
    };
    expect(matchesBasis(basis, async)).toBe(false);
  });
});

describe("SimulationRuns", () => {
  it("offers to run when there are saved simulations, and says which one it's playing", async () => {
    const { sims, runs, flush, last } = setup();
    expect(last()).toEqual({ status: "ready", simulations: 1 });
    sims.start();
    expect(last()).toEqual({ status: "running", index: 1, total: 1, title: "Payments goes down" });
    await flush();
    runs[0].progress({ index: 1, total: 1, title: "Payments goes down" });
    expect(last().status).toBe("running");
    runs[0].resolve(EVIDENCE);
    await flush();
    expect(last()).toEqual({
      status: "done",
      played: EVIDENCE.played,
      unplayed: [],
      tooBig: [],
      // What they mean is worked out against each check result as it's shown (the store does).
      planned: [],
      counted: 0,
      stale: false,
    });
  });

  it("puts the counts on the findings once played", async () => {
    const { sims, runs, merges, flush } = setup();
    sims.start();
    await flush();
    runs[0].resolve(EVIDENCE);
    await flush();
    const merge = merges[merges.length - 1]!;
    const finding = { id: "dead-letter:q", rule: "dead-letter", severity: "warning", target: "q", elements: ["q"] };
    const result = { findings: [finding], ignored: [], off: [], ran: [] } as unknown as CheckResult;
    expect(merge(result, diagram).result.findings[0].evidence).toEqual(COUNTS);
  });

  it("stops at once on an edit a simulation would see, not on a move or a selection", async () => {
    const { sims, runs, c, flush, last } = setup();
    sims.start();
    await flush();
    sims.setContent({ ...c, nodes: c.nodes.map((n) => ({ ...n, selected: true }) as FlowNode) });
    expect(runs[0].cancel).not.toHaveBeenCalled();
    expect(sims.isRunning()).toBe(true);
    sims.setContent({ ...c, nodes: [node("a", { stencil: "service.go", label: "a" }), c.nodes[1]] });
    expect(runs[0].cancel).toHaveBeenCalledOnce();
    expect(last()).toEqual({ status: "ready", simulations: 1, stopped: "edit" });
    // What the stopped run would have said never lands.
    runs[0].resolve(EVIDENCE);
    await flush();
    expect(last().status).toBe("ready");
  });

  it("Stop (and Esc) stops a run in flight, and says so; with none, it does nothing", async () => {
    const { sims, runs, flush, last } = setup();
    expect(sims.stop()).toBe(false);
    sims.start();
    await flush();
    expect(sims.stop()).toBe(true);
    expect(runs[0].cancel).toHaveBeenCalledOnce();
    expect(last()).toEqual({ status: "ready", simulations: 1, stopped: "stop" });
    expect(sims.stop()).toBe(false);
  });

  it("stopped before the engine loads, nothing starts", async () => {
    const { sims, runs, flush, last } = setup();
    sims.start();
    sims.stop();
    await flush();
    expect(runs).toHaveLength(0);
    expect(last().status).toBe("ready");
  });

  it("counts go stale with an edit (hidden, never merged) and come back when Undo brings the diagram back", async () => {
    const { sims, runs, merges, c, flush, last } = setup();
    sims.start();
    await flush();
    runs[0].resolve(EVIDENCE);
    await flush();
    expect(last()).toMatchObject({ status: "done", stale: false });
    const edited = { ...c, edges: [] };
    sims.setContent(edited);
    expect(last()).toMatchObject({ status: "done", stale: true });
    expect(merges[merges.length - 1]).toBeUndefined();
    // Undo: the very same state as before.
    sims.setContent(c);
    expect(last()).toMatchObject({ status: "done", stale: false });
    expect(merges[merges.length - 1]).toBeDefined();
  });

  it("says nothing for changes that change nothing shown (a drag publishes no new state)", async () => {
    const { sims, views, c } = setup();
    const before = views.length;
    for (let i = 0; i < 20; i++)
      sims.setContent({ ...c, nodes: c.nodes.map((n) => ({ ...n, position: { x: i, y: i } }) as FlowNode) });
    expect(views).toHaveLength(before);
  });

  it("a failed run says so and can run again", async () => {
    const { sims, runs, flush, last } = setup();
    sims.start();
    await flush();
    runs[0].reject(new Error("boom"));
    await flush();
    expect(last()).toEqual({ status: "ready", simulations: 1, stopped: "failed" });
    sims.start();
    await flush();
    expect(runs).toHaveLength(2);
  });

  it("no saved simulations: nothing to run", () => {
    const { sims, c, last } = setup();
    sims.setContent({ ...c, meta: {} });
    expect(last()).toEqual({ status: "none" });
  });
});

describe("ChecksStore with evidence", () => {
  it("shows the merged result, and the plain one while the counts are stale", () => {
    const store = new ChecksStore();
    const finding = { id: "dead-letter:q", rule: "dead-letter", severity: "warning", target: "q", elements: ["q"] };
    store.set({ findings: [finding], ignored: [], off: [], ran: ["dead-letter"] } as unknown as CheckResult, diagram);
    const view: EvidenceView = {
      status: "done",
      played: [],
      unplayed: [],
      tooBig: [],
      planned: [],
      counted: 0,
      stale: false,
    };
    store.setEvidence(view, (r, d) => withEvidence(r, EVIDENCE, d?.checks));
    expect(store.get().result?.findings[0].evidence?.[0].count).toBe(312);
    // The line's numbers come from the same classification as the rows.
    expect(store.get().evidence).toEqual({ ...view, counted: 1 });
    store.setEvidence({ ...view, stale: true });
    expect(store.get().result?.findings[0].evidence).toBeUndefined();
    expect(store.get().warnings).toBe(1);
  });
});
