/* eslint-disable local/no-literal-ui-text -- Public diagram labels are authored tutorial fixture input. */
import { afterEach, expect, it, vi } from "vitest";
import { tutorials } from "./catalog";
import { chapters } from "./chapters";
import { earnedSeals, lessonProgress } from "./seals";
import { nextTutorial, recordSeals, withoutProgress } from "./progress";
import { lessonNumber } from "./handoff";
import { toFlow } from "../canvas/convert";
import type { CanvasSnapshot } from "../editor/useHistory";
import { HistoryController } from "../editor/historyController";
import { editorHarness } from "../test/editorHarness";
import { reviewAgentChanges } from "./catalog/reviewAgentChanges";
import { workTogether } from "./catalog/workTogether";
import { agentPractice, resetAgentPractice } from "./agentPractice";
import { createLocalPeerPractice, localPeerMachine } from "./localPeerPractice";
import { machinePaths } from "../lib/machine";
import { threads } from "../ai/ui/threadStore";
import { holds, resolveSubjects } from "./checks";
import { observationPorts } from "../lib/observations";
import { paletteHost } from "../palette/host";
import * as clients from "../collab/client";
import * as signing from "../collab/signing";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const complete = (list = tutorials.filter((t) => !t.optional)) => ({
  progress: Object.fromEntries(list.map((t) => [t.id, { version: t.version, completed: true, step: 0 }])),
});

it("earns chapter VII and the core syllabus offline with both extensions untouched", () => {
  const core = tutorials.filter((t) => !t.optional);
  expect(core).toHaveLength(60);
  expect(tutorials.filter((t) => t.optional).map((t) => t.id)).toEqual(["work-together", "review-agent-changes"]);
  expect(earnedSeals(complete(), tutorials)).toContain("whole-syllabus");
  expect(earnedSeals(complete(), tutorials)).toContain(chapters.sharing.seal);
  expect(tutorials.filter((t) => t.track === "sharing").map((t) => lessonNumber(t, tutorials))).toEqual([
    "7.1",
    "7.2",
    "7.3",
    "7.4",
  ]);
  const last = core.at(-1)!;
  const before = complete(core.slice(0, -1));
  expect(earnedSeals(before, tutorials)).not.toContain("whole-syllabus");
  expect(nextTutorial(last, tutorials, {})).toBe(core[0]);
});

it("preserves moved presentation completion and seal dates, and resets the new scope only", () => {
  const share = tutorials.find((t) => t.id === "share-present")!;
  const old = {
    progress: { [share.id]: { version: 1, completed: true, completedAt: 123, step: 2 } },
    marks: { "chapter-basics": 456 },
  };
  expect(lessonProgress(old, share)).toMatchObject({ completed: true, completedAt: 123 });
  expect(recordSeals(old, tutorials, 789).marks).toMatchObject({ "chapter-basics": 456 });
  expect(withoutProgress(old, { track: "basics" }).progress).toEqual(old.progress);
  expect(withoutProgress(old, { track: "sharing" }).progress).toEqual({});
  expect(
    lessonProgress({ progress: { [share.id]: { version: 1, completed: false, step: 1 } } }, share),
  ).toBeUndefined();
});

it("resetting optional practice leaves core seals and their dates intact", () => {
  const snapshot = recordSeals(complete(tutorials), tutorials, 123);
  expect(withoutProgress(snapshot, { lesson: "review-agent-changes" }).marks).toEqual(snapshot.marks);
  expect(withoutProgress(snapshot, { lesson: "work-together" }).marks).toEqual(snapshot.marks);
  expect(withoutProgress(snapshot, { track: "sharing" }).marks).not.toHaveProperty("whole-syllabus");
});

it("applies deterministic public replies, Undo and Revert through real turns and history without storing practice", () => {
  if (typeof reviewAgentChanges.start !== "function") throw new Error("Inline fixture expected");
  const writes = vi.fn();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: writes, removeItem: writes });
  const h = editorHarness(reviewAgentChanges.start());
  const history = new HistoryController(toFlow(reviewAgentChanges.start()), 0);
  const apply = (snapshot: CanvasSnapshot) => {
    h.setNodes(snapshot.nodes);
    h.deps.setEdges(snapshot.edges);
    h.deps.meta = snapshot.meta;
    h.commit();
  };
  h.deps.history = {
    ...h.deps.history,
    top: () => history.top(),
    replace: (next, merge, before, reset) => {
      history.replace(before ?? toFlow(h.api.getDiagram()), undefined, next, merge, { nodes: [], edges: [] }, 0, reset);
      apply(next);
    },
    undo: () => {
      const snapshot = history.step("undo", { nodes: [], edges: [] });
      if (snapshot) apply(snapshot);
    },
  };
  h.deps.setMeta = (meta) => {
    h.deps.meta = typeof meta === "function" ? meta(h.deps.meta) : meta;
    h.commit();
  };
  const documentId = "example:tutorial";
  resetAgentPractice(documentId);
  agentPractice(h.api, documentId, "add");
  h.commit();
  expect(h.api.getDiagram().nodes).toHaveLength(2);
  expect(h.api.getDiagram().edges).toHaveLength(1);
  expect(threads.get(documentId)[0]).toMatchObject({ kind: "change", engine: "paste" });
  h.api.applyDiagram({ ...h.api.getDiagram(), description: "Learner note" });
  h.commit();
  agentPractice(h.api, documentId, "undo");
  h.commit();
  expect(h.api.getDiagram().nodes).toHaveLength(1);
  expect(h.api.getDiagram().edges).toHaveLength(0);
  expect(h.api.getDiagram().description).toBe("Learner note");
  agentPractice(h.api, documentId, "add");
  h.commit();
  agentPractice(h.api, documentId, "rename");
  h.commit();
  expect(h.api.getDiagram().nodes[1].label).toBe("Unreviewed worker");
  agentPractice(h.api, documentId, "revert");
  h.commit();
  expect(h.api.getDiagram().nodes[1].label).toBe("Status worker");
  expect(threads.get(documentId).at(-1)?.kind).toBe("revert");
  const before = h.api.getDiagram();
  const workerId = before.nodes.find((n) => n.stencil === "service.go")!.id;
  h.api.applyDiagram({
    ...before,
    nodes: [{ id: "background", stencil: "service.go", label: "Background task", x: -300, y: 200 }, ...before.nodes],
  });
  h.commit();
  agentPractice(h.api, documentId, "add");
  h.commit();
  expect(h.api.getDiagram().nodes.find((n) => n.id === "background")?.label).toBe("Background task");
  expect(h.api.getDiagram().nodes.find((n) => n.id === workerId)?.label).toBe("Status worker");
  expect(h.api.getDiagram().edges.some((e) => e.from === "api" && e.to === "background")).toBe(false);
  expect(writes).not.toHaveBeenCalled();
});

it("requires semantic local-peer evidence, never a real room join or a click", () => {
  if (typeof workTogether.start !== "function") throw new Error("Inline fixture expected");
  const diagram = workTogether.start();
  const source = { documentId: "practice", identity: {} };
  const view = {
    diagram,
    live: false,
    processed: () => 0,
    observations: { collaboration: { ...source, status: "joined" as const, role: "creator" as const } },
  };
  expect(holds({ kind: "localPeer", action: "join" }, view, {})).toBe(false);
  expect(
    holds(
      { kind: "localPeer", action: "edit" },
      {
        ...view,
        observations: {
          collaboration: { ...view.observations.collaboration, practice: { phase: "edit", converged: true } },
        },
      },
      {},
    ),
  ).toBe(false);
  expect(machinePaths(localPeerMachine, { maxDepth: 4 }).some((p) => p.state.value === "failed")).toBe(true);
});

it("uses two isolated signed peers, refuses the viewer, follows a saved run and leaves with a memory copy", async () => {
  if (typeof workTogether.start !== "function") throw new Error("Inline fixture expected");
  vi.stubGlobal(
    "WebSocket",
    vi.fn(() => {
      throw new Error("No sockets in practice");
    }),
  );
  vi.stubGlobal(
    "RTCPeerConnection",
    vi.fn(() => {
      throw new Error("No network peers in practice");
    }),
  );
  const h = editorHarness(workTogether.start());
  const practice = createLocalPeerPractice();
  const received: unknown[] = [];
  const off = observationPorts.collaboration.subscribe((e) => received.push(e));
  const host = vi
    .spyOn(paletteHost, "get")
    .mockReturnValue({ canvas: { documentId: "practice", editor: h.api } } as unknown as ReturnType<
      typeof paletteHost.get
    >);
  try {
    for (const action of ["join", "edit", "watch", "leave"] as const) {
      await practice.run(action, h.api);
      h.commit();
      expect(practice.getSnapshot()).toMatchObject({ value: "ready", phase: action });
      expect(
        holds(
          { kind: "localPeer", action },
          {
            diagram: h.api.getDiagram(),
            live: false,
            processed: () => 0,
            observations: { collaboration: observationPorts.collaboration.get()! },
          },
          resolveSubjects(workTogether, h.api.getDiagram()),
        ),
      ).toBe(true);
    }
    expect(received).toHaveLength(4);
    expect(practice.getSnapshot().copy?.nodes.find((n) => n.id === "worker")?.label).toBe("Reviewed status worker");
  } finally {
    practice.dispose();
    off();
    host.mockRestore();
  }
});

it("reset during pending join suppresses late completion and closes the late client", async () => {
  if (typeof workTogether.start !== "function") throw new Error("Inline fixture expected");
  const h = editorHarness(workTogether.start());
  const before = h.api.getDiagram();
  const practice = createLocalPeerPractice();
  vi.spyOn(paletteHost, "get").mockReturnValue({
    canvas: { documentId: "pending-peer", editor: h.api, live: false, focusNode: vi.fn(), addStencil: vi.fn() },
    live: null,
    session: null,
    pendingRun: null,
  });
  const events = vi.fn();
  const off = observationPorts.collaboration.subscribe(events);
  const original = clients.openRoomClient;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let opened: clients.RoomClient | undefined;
  let close: ReturnType<typeof vi.spyOn> | undefined;
  let destroy: ReturnType<typeof vi.spyOn> | undefined;
  vi.spyOn(clients, "openRoomClient").mockImplementationOnce(async (...args) => {
    opened = await original(...args);
    close = vi.spyOn(opened.binding, "close");
    destroy = vi.spyOn(opened.session.doc, "destroy");
    await held;
    return opened;
  });
  try {
    const pending = practice.run("join", h.api);
    await vi.waitFor(() => expect(opened).toBeDefined());
    practice.reset();
    release();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(close).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(events).not.toHaveBeenCalled();
    expect(h.api.getDiagram()).toEqual(before);
    expect(practice.getSnapshot().value).toBe("idle");
    await practice.run("join", h.api);
    expect(practice.getSnapshot()).toMatchObject({ value: "ready", phase: "join" });
    expect(events).toHaveBeenCalledOnce();
  } finally {
    release();
    practice.dispose();
    off();
  }
});

it("failed peer action can retry", async () => {
  if (typeof workTogether.start !== "function") throw new Error("Inline fixture expected");
  const h = editorHarness(workTogether.start());
  const practice = createLocalPeerPractice();
  vi.spyOn(signing, "newIdentity").mockRejectedValueOnce(new Error("Signing failed"));
  try {
    await expect(practice.run("join", h.api)).rejects.toThrow("Signing failed");
    expect(practice.getSnapshot().value).toBe("failed");
    await practice.run("join", h.api);
    expect(practice.getSnapshot()).toMatchObject({ value: "ready", phase: "join" });
  } finally {
    practice.dispose();
  }
});
