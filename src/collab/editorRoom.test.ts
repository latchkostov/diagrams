import { expect, it, onTestFinished, vi } from "vitest";
import type { ReactFlowInstance } from "@xyflow/react";
import { fromFlow, toFlow } from "../canvas/convert";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import { HistoryController } from "../editor/historyController";
import { retainRemoteSelection } from "../editor/remoteSnapshot";
import { createEditor, type EditorDeps } from "../editor/useEditor";
import type { CanvasSnapshot } from "../editor/useHistory";
import { makePayload } from "../editor/clipboard";
import { present } from "../editor/history";
import { withSelection } from "../editor/historySelection";
import { FakeClock } from "./clock";
import { CollaborativeEditorRoom } from "./editorRoom";
import { demoDiagram } from "./lab/demo";
import { CollabSession } from "./session";
import { roomFor } from "./transport/conformance";
import { MemoryNetwork } from "./transport/memory";
import { seededRandom } from "./random";
import type { CanvasPrivacyState } from "../lib/localOnly";
import type { DiagramFile } from "../model/types";

vi.mock("../lib/localOnly.dev", () => ({
  matchesLocalExample: (d: DiagramFile) => d.nodes.some((n) => n.label === "Restricted test draft"),
}));

/** Drives the exact controller used by useHistory, including pending renders and remote baselines. */
function editor(session: CollabSession, privacy: (next: CanvasSnapshot) => CanvasPrivacyState = () => ({})) {
  let state: CanvasSnapshot = toFlow(session.doc.project().diagram!);
  const room = new CollaborativeEditorRoom(session, () => ({}));
  const history = new HistoryController(state, 0, room);
  let merge: string | undefined;
  let time = 0;
  const render = () => ctl.updateDeps(rf, { ...deps, meta: state.meta });
  const flush = () => {
    if (state.nodes.some((n) => n.dragging || n.resizing)) return false;
    history.commit(state, merge, ++time);
    merge = undefined;
    return true;
  };
  const rf = {
    getNodes: () => state.nodes,
    getNode: (id: string) => state.nodes.find((n) => n.id === id),
    getEdges: () => state.edges,
  } as ReactFlowInstance<FlowNode, DiagramFlowEdge>;
  const deps = {
    slug: "room-test",
    meta: state.meta,
    newId: (base) => room.newId(base),
    setMeta: (v) => {
      state = { ...state, meta: typeof v === "function" ? v(state.meta) : v };
    },
    setNodes: (v) => {
      state = { ...state, nodes: typeof v === "function" ? v(state.nodes) : v };
    },
    setEdges: (v) => {
      state = { ...state, edges: typeof v === "function" ? v(state.edges) : v };
    },
    nodeSize: { width: 220, height: 72 },
    viewCenter: () => ({ x: 1000, y: 800 }),
    setEditing: () => {},
    rename: () => {},
    reveal: () => {},
    prefs: { snap: true, grid: true, minimap: false, inspector: true },
    setPref: () => {},
    openInspector: () => {},
    showShortcuts: () => {},
    fit: () => {},
    history: {
      hint: (key) => {
        if (merge !== key) flush();
        merge = key;
      },
      begin: (tag) => {
        flush();
        merge = tag;
        history.begin(tag);
      },
      end: (tag) => {
        flush();
        history.end(tag);
      },
      open: () => history.openTransaction,
      undo: () => {
        flush();
        history.step("undo", { nodes: [], edges: [] });
      },
      redo: () => {
        flush();
        history.step("redo", { nodes: [], edges: [] });
      },
      replace: (next, key, before) => {
        history.replace(before ?? state, merge, next, key, { nodes: [], edges: [] }, ++time);
        state = next;
        render();
      },
      top: () => history.top(),
      canUndo: false,
      canRedo: false,
    },
  } satisfies EditorDeps;
  const ctl = createEditor(rf, deps);
  const disconnect = room.connect({
    getPrivacy: privacy,
    getSnapshot: () => state,
    flushPending: flush,
    receive: (next, step) => {
      state = step ? withSelection(next, step.selection) : retainRemoteSelection(state, next);
      history.receive(state);
      render();
    },
  });
  onTestFinished(disconnect);
  return {
    api: ctl.api,
    flush: () => {
      render();
      flush();
    },
    render,
    history,
    room,
    disconnect,
    state: () => state,
    gesture: (id: string, x: number, dragging: boolean) => {
      state = {
        ...state,
        nodes: state.nodes.map((n) => (n.id === id ? { ...n, position: { ...n.position, x }, dragging } : n)),
      };
      render();
    },
    diagram: () => fromFlow(state.meta, state.nodes, state.edges),
  };
}

async function setup(seed = 1) {
  const net = new MemoryNetwork({ seed, faults: { reorder: true, duplicate: 0.2 } });
  const clock = new FakeClock();
  const a = await CollabSession.open({
    room: roomFor(70),
    transport: net.connect(),
    privacy: {},
    initial: demoDiagram(),
    clock,
    clientId: 1,
  });
  const b = await CollabSession.open({ room: roomFor(70), transport: net.connect(), privacy: {}, clock, clientId: 2 });
  const settle = () =>
    net.settle(async () => {
      await a.idle();
      await b.idle();
    });
  await settle();
  const A = editor(a),
    B = editor(b);
  onTestFinished(async () => {
    await Promise.all([a.leave(), b.leave()]);
    a.doc.destroy();
    b.doc.destroy();
  });
  return { A, B, a, b, net, clock, settle };
}

it("commits real editor commands, preserves a pending property edit and selection, and scopes Undo", async () => {
  const { A, B, a, settle } = await setup();
  A.api.select({ nodeIds: ["api"] });
  A.render();
  const selected = A.state().nodes.find((n) => n.id === "api");
  A.api.updateNode("api", { label: "Draft API" }, { merge: "name" });
  A.render();
  B.api.updateNode("db", { label: "Peer database" });
  B.flush();
  await settle();
  expect(A.api.getSelection().nodeIds).toEqual(["api"]);
  expect(A.api.getNode("api")?.label).toBe("Draft API");
  expect(A.api.getNode("db")?.label).toBe("Peer database");
  expect(A.history.history.entries).toHaveLength(1);
  expect(A.state().nodes.find((n) => n.id === "api")).not.toBe(selected); // own rename changed it
  A.api.undo();
  await settle();
  expect(B.api.getNode("api")?.label).toBe("API");
  expect(B.api.getNode("db")?.label).toBe("Peer database");
  expect(a.doc.canUndo()).toBe(false);
  A.api.redo();
  await settle();
  expect(A.diagram()).toEqual(B.diagram());
  expect(B.api.getNode("api")?.label).toBe("Draft API");
});

it("does not resurrect a remotely deleted property-sheet target or echo remote steps", async () => {
  const { A, B, a, settle } = await setup();
  A.api.select({ nodeIds: ["api"] });
  A.render();
  A.api.updateNode("api", { label: "Uncommitted" });
  A.render();
  B.api.deleteElements({ nodeIds: ["api"] });
  B.flush();
  await settle();
  expect(A.api.getNode("api")).toBeUndefined();
  expect(A.api.getSelection().nodeIds).toEqual([]);
  A.api.updateNode("api", { label: "Late blur" });
  A.flush();
  await settle();
  expect(B.api.getNode("api")).toBeUndefined();
  expect(a.doc.canUndo()).toBe(false);
  expect(present(A.history.history).value).toEqual(A.state());
});

it("defers remote projection during a local drag and merges the final committed move", async () => {
  const { A, B, settle } = await setup();
  A.gesture("api", 900, true);
  B.api.updateNode("db", { label: "During gesture" });
  B.flush();
  await settle();
  expect(A.state().nodes.find((n) => n.id === "api")).toMatchObject({ dragging: true, position: { x: 900 } });
  A.gesture("api", 910, false);
  A.flush();
  await settle();
  expect(A.api.getNode("api")?.x).toBe(910);
  expect(A.api.getNode("db")?.label).toBe("During gesture");
  expect(A.diagram()).toEqual(B.diagram());
  A.api.undo();
  await settle();
  expect(A.api.getNode("api")?.x).toBe(260);
  expect(A.api.getNode("db")?.label).toBe("During gesture");
});

it("does not turn canvas round-trip defaults or a remote-only edit into a local history step", async () => {
  const { A, B, a, settle } = await setup();
  A.flush();
  expect(a.doc.canUndo()).toBe(false);
  A.api.updateNode("web", { label: "Name only" });
  A.flush();
  expect(a.doc.project().diagram?.edges.find((e) => e.id === "orders-db")?.kind).toBeUndefined();
  A.api.undo();
  await settle();
  expect(a.doc.canUndo()).toBe(false);
  const unchanged = A.state().nodes.find((n) => n.id === "api");
  B.api.updateNode("db", { label: "Peer only" });
  B.flush();
  await settle();
  expect(a.doc.canUndo()).toBe(false);
  expect(A.state().nodes.find((n) => n.id === "api")).toBe(unchanged);
});

it("isolates real document replacements and retains their Undo target tags", async () => {
  const { A, B, settle } = await setup();
  A.api.applyDiagram({ ...A.api.getDiagram(), title: "First replacement" }, { merge: "ai:1" });
  expect(A.api.undoTarget()).toBe("ai:1");
  A.api.applyDiagram({ ...A.api.getDiagram(), title: "Second replacement" }, { merge: "ai:1" });
  B.api.updateNode("db", { label: "Unrelated peer" });
  B.flush();
  await settle();
  A.api.undo();
  await settle();
  expect(B.diagram().title).toBe("First replacement");
  expect(B.api.getNode("db")?.label).toBe("Unrelated peer");
  A.api.undo();
  await settle();
  expect(B.diagram().title).toBe("Orders pipeline");
});

it("restores room Undo target tags after Undo and Redo", async () => {
  const { A, settle } = await setup();
  A.api.applyDiagram({ ...A.api.getDiagram(), title: "First" }, { merge: "ai:first" });
  A.api.applyDiagram({ ...A.api.getDiagram(), title: "Second" }, { merge: "ai:second" });
  expect(A.api.undoTarget()).toBe("ai:second");
  A.api.undo();
  await settle();
  expect(A.api.undoTarget()).toBe("ai:first");
  A.api.redo();
  await settle();
  expect(A.api.undoTarget()).toBe("ai:second");
});

it("scoped Undo restores deleted selections and selects what a rename changed", async () => {
  const { A, B, settle } = await setup();
  A.api.select({ nodeIds: ["api"] });
  A.render();
  A.api.deleteElements({ nodeIds: ["api"] });
  A.flush();
  A.api.undo();
  await settle();
  expect(A.api.getSelection().nodeIds).toContain("api");
  A.api.updateNode("api", { label: "Own rename" });
  A.flush();
  B.api.updateNode("db", { label: "Peer rename" });
  B.flush();
  await settle();
  A.api.select({ nodeIds: ["db"] });
  A.render();
  A.api.undo();
  await settle();
  expect(A.api.getSelection().nodeIds).toEqual(["api"]);
  expect(A.api.getNode("db")?.label).toBe("Peer rename");
  A.api.redo();
  await settle();
  expect(A.api.getSelection().nodeIds).toEqual(["api"]);
});

it("bounds repeated duplicate and long imported ID allocation", async () => {
  const { A } = await setup();
  let id = "x".repeat(255);
  const ids = new Set<string>();
  for (let i = 0; i < 20; i++) {
    id = A.room.newId(id);
    expect(id.length).toBeLessThan(256);
    ids.add(id);
  }
  expect(ids.size).toBe(20);
});

it("keeps creation, connection and names in one scoped step across a remote update", async () => {
  const { A, B, settle } = await setup();
  const made = A.api.createConnected({ from: "api", stencil: "service.go" })!;
  A.flush();
  B.api.updateNode("db", { label: "Peer database" });
  B.flush();
  await settle();
  A.api.updateNode(made.id, { label: "Fulfilment" }, { merge: made.merge });
  A.flush();
  A.api.updateEdge(made.edge!, { label: "dispatch" }, { merge: made.merge });
  A.flush();
  A.api.doneNaming(made.merge);
  A.api.undo();
  await settle();
  expect(B.api.getNode(made.id)).toBeUndefined();
  expect(B.api.getEdge(made.edge!)).toBeUndefined();
  expect(B.api.getNode("db")?.label).toBe("Peer database");
});

it("gives concurrent creates, boundaries, annotations and pasted references session-unique ids", async () => {
  const { A, B, settle } = await setup();
  const madeA = A.api.addNode("service.go"),
    madeB = B.api.addNode("service.go");
  expect(madeA).not.toBe(madeB);
  const remounted = new CollaborativeEditorRoom(A.room.session, () => ({}));
  expect(remounted.newId("service")).not.toBe(A.room.newId("service"));
  A.flush();
  B.flush();
  await settle();
  const payload = makePayload(demoDiagram(), ["api", "db"])!;
  A.api.pastePayload(payload);
  B.api.pastePayload(payload);
  A.flush();
  B.flush();
  await settle();
  A.api.addAnnotation("note");
  B.api.addAnnotation("note");
  A.flush();
  B.flush();
  await settle();
  A.api.groupNodes([madeA]);
  B.api.groupNodes([madeB]);
  A.flush();
  B.flush();
  await settle();
  expect(A.diagram()).toEqual(B.diagram());
  const d = A.diagram();
  const ids = [...d.nodes, ...d.edges, ...(d.groups ?? []), ...(d.annotations ?? [])].map((x) => x.id);
  expect(new Set(ids).size).toBe(ids.length);
});

it("converges real command paths under seeded concurrent property edits, moves, creates and scoped undo", async () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { A, B, settle, a, b } = await setup(seed);
    const random = seededRandom(seed);
    for (let step = 0; step < 16; step++) {
      for (const client of [A, B]) {
        const id = random() < 0.5 ? "api" : "db";
        const action = Math.floor(random() * 4);
        if (action === 0) client.api.updateNode(id, { label: `s${seed}-${step}` });
        if (action === 1) client.api.setNodeProps(id, { description: `p${step}` });
        if (action === 2) client.api.addNode("service.go");
        if (action === 3) client.api.undo();
        client.flush();
      }
      await settle();
      expect(A.diagram(), `seed=${seed}, step=${step}`).toEqual(B.diagram());
      expect(A.history.history.entries).toHaveLength(1);
    }
    await Promise.all([a.leave(), b.leave()]);
  }
});

it.each(["new", "existing"])("concurrent %s-node splits on different edges retain both connections", async (mode) => {
  const { A, B, settle } = await setup();
  let ids: string[];
  if (mode === "new") {
    ids = [A.api.insertNode("web-api", "service.go")!.id, B.api.insertNode("orders-db", "service.go")!.id];
  } else {
    ids = [A.api.addNode("service.go"), B.api.addNode("service.go")];
    A.flush();
    B.flush();
    await settle();
    expect(A.api.insertIntoEdge("web-api", ids[0])).toBe(true);
    expect(B.api.insertIntoEdge("orders-db", ids[1])).toBe(true);
  }
  A.flush();
  B.flush();
  await settle();
  const d = A.diagram();
  expect(d).toEqual(B.diagram());
  expect(d.edges).toHaveLength(5);
  for (const [id, from, to] of [
    [ids[0], "web", "api"],
    [ids[1], "orders", "db"],
  ]) {
    expect(d.edges.filter((e) => e.to === id).map((e) => e.from)).toEqual([from]);
    expect(d.edges.filter((e) => e.from === id).map((e) => e.to)).toEqual([to]);
  }
});

it("scopes capture identities across detach and remount on the same session", async () => {
  const { A, a, settle } = await setup();
  A.api.updateNode("api", { label: "First mounted editor" });
  A.flush();
  A.disconnect();
  const mounted = editor(a);
  mounted.api.updateNode("db", { label: "Remounted editor" });
  mounted.flush();
  expect(a.doc.undoManager.undoStack).toHaveLength(2);
  mounted.api.undo();
  await settle();
  expect(mounted.api.getNode("api")?.label).toBe("First mounted editor");
  expect(mounted.api.getNode("db")?.label).toBe("Orders DB");
});

it("concurrent room pastes preserve internal references", async () => {
  const { A, B, settle } = await setup();
  const original = demoDiagram();
  const connected = {
    ...original,
    groups: [{ id: "cluster", label: "Cluster", x: 200, y: 20, width: 600, height: 240 }],
    nodes: original.nodes.filter((n) => ["api", "orders"].includes(n.id)).map((n) => ({ ...n, group: "cluster" })),
    edges: original.edges.filter((e) => e.id === "api-orders"),
    annotations: [
      {
        id: "caption",
        kind: "note" as const,
        text: "Dispatch",
        x: 200,
        y: 180,
        width: 100,
        height: 60,
        group: "cluster",
      },
    ],
  };
  const payload = makePayload(connected, [], ["cluster"])!;
  expect(payload.edges).toHaveLength(1);
  expect(payload.annotations).toHaveLength(1);
  A.api.pastePayload(payload);
  B.api.pastePayload(payload);
  A.flush();
  B.flush();
  await settle();
  const d = A.diagram();
  expect(d).toEqual(B.diagram());
  expect(d.nodes).toHaveLength(8);
  expect(d.edges).toHaveLength(5);
  expect(d.groups).toHaveLength(2);
  expect(d.annotations).toHaveLength(2);
  const endpoints = new Set<string>();
  for (const group of d.groups!) {
    const members = d.nodes.filter((n) => n.group === group.id);
    expect(members).toHaveLength(2);
    expect(d.annotations!.filter((n) => n.group === group.id)).toHaveLength(1);
    const ids = new Set(members.map((n) => n.id));
    const edges = d.edges.filter((e) => ids.has(e.from) || ids.has(e.to));
    expect(edges).toHaveLength(1);
    expect(ids.has(edges[0].from) && ids.has(edges[0].to)).toBe(true);
    for (const id of ids) {
      expect(endpoints.has(id)).toBe(false);
      expect(["api", "orders"]).not.toContain(id);
      endpoints.add(id);
    }
  }
});

it("exposes typed refusals, rolls back the edit, and notifies the editor accessibly", async () => {
  const { A } = await setup();
  A.disconnect();
  let state = A.state();
  const refused = vi.fn();
  const detach = A.room.connect({
    getSnapshot: () => state,
    flushPending: () => true,
    receive: (next) => {
      state = next;
    },
    refused,
  });
  onTestFinished(detach);
  const before = state;
  const next = {
    ...state,
    nodes: state.nodes.map((n) =>
      n.id === "api" ? { ...n, data: { ...n.data, props: { ["k".repeat(256)]: "value" } } } : n,
    ),
  } as CanvasSnapshot;
  expect(A.room.commit(next)).toEqual({ status: "refused", reason: "key-too-long" });
  expect(refused).toHaveBeenCalledWith("key-too-long");
  expect(fromFlow(state.meta, state.nodes, state.edges)).toEqual(fromFlow(before.meta, before.nodes, before.edges));
  expect(A.room.commit(state)).toEqual({ status: "unchanged" });
  expect(A.room.commit({ ...state, meta: { ...state.meta, title: "Accepted" } })).toEqual({ status: "applied" });
});

it.each(["private", "localOnly"] as const)(
  "stops sharing when effective %s changes without a document edit",
  async (flag) => {
    const { A, a, B, settle } = await setup();
    A.disconnect();
    let restricted = false;
    const mounted = editor(a, () => ({ [flag]: restricted }));
    restricted = true;
    expect(mounted.room.checkPrivacy()).toBe(false);
    mounted.api.updateNode("api", { label: "Keep on this device" });
    mounted.flush();
    await a.leave();
    await settle();
    expect(a.status).toBe("left");
    expect(B.api.getNode("api")?.label).toBe("API");
    expect(a.doc.project().diagram?.nodes.find((n) => n.id === "api")?.label).toBe("API");
  },
);

it("checks the candidate diagram's effective privacy before publishing or checkpointing a label edit", async () => {
  const { A, a, B, settle } = await setup();
  A.disconnect();
  const mounted = editor(a, (next) => ({ diagram: fromFlow(next.meta, next.nodes, next.edges) }));
  mounted.api.updateNode("api", { label: "Restricted test draft" });
  mounted.flush();
  await a.leave();
  await settle();
  expect(a.status).toBe("left");
  expect(mounted.api.getNode("api")?.label).toBe("Restricted test draft");
  expect(B.api.getNode("api")?.label).toBe("API");
  expect(a.doc.project().diagram?.nodes.find((n) => n.id === "api")?.label).toBe("API");
});
