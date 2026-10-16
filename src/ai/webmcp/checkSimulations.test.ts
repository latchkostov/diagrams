import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorApi } from "../../editor/types";
import type { DiagramFile } from "../../model/types";
import type { Evidence } from "../../checks/evidence";
import { toModelContextTool } from "./adapter";
import { buildTools, type WebMcpHost } from "./tools";
import { registerScenarioPlanner } from "../../lib/scenarioPlanner";

// check_diagram({ simulations: true }) waits seconds for the simulations to play. Before anything about the diagram
// goes back to the agent, everything checked at the start is checked again: the same diagram in the same editor,
// AI tools still allowed for it (not made Private or local-only), and the call not cancelled. If any changed, the
// reply says nothing about the diagram. Playback is a fake here, finished or cancelled by the test.

const play = vi.hoisted(() => ({
  runs: [] as { resolve: (e: Evidence) => void; cancel: ReturnType<typeof vi.fn> }[],
}));
vi.mock("../../checks/evidenceClient", async (actual) => {
  const real = await actual<typeof import("../../checks/evidenceClient")>();
  return {
    ...real,
    playSimulations: () => {
      let resolve!: (e: Evidence) => void;
      let reject!: (e: Error) => void;
      const done = new Promise<Evidence>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const cancel = vi.fn(() => reject(new real.EvidenceStopped()));
      play.runs.push({ resolve, cancel });
      return { done, cancel };
    },
  };
});

const SECRET = "Payroll ledger";
const diagram = (): DiagramFile => ({
  format: "diagrams/v1",
  title: "Payroll",
  nodes: [
    { id: "web", stencil: "client.browser", label: "Web", x: 0, y: 0 },
    { id: "q", stencil: "aws.sqs", label: SECRET, x: 300, y: 0 },
    { id: "w", stencil: "aws.lambda", label: "Worker", x: 600, y: 0, props: { failureRate: 0.5 } },
  ],
  edges: [
    { id: "e1", from: "web", to: "q", kind: "async" },
    { id: "e2", from: "q", to: "w", kind: "async" },
  ],
  simulations: [{ id: "s", title: "Bad batch", traffic: [] }],
});
const EVIDENCE: Evidence = {
  played: [{ id: "s", title: "Bad batch", playedMs: 5000, capped: false }],
  unplayed: [],
  tooBig: [],
  losses: [{ simulation: "Bad batch", node: "q", broker: true, what: "dropped", count: 7 }],
  dropped: [],
};

function setup() {
  const state = { allowed: true, doc: "doc-1" };
  const editor = { getDiagram: diagram } as unknown as EditorApi;
  let current: EditorApi = editor;
  const host: WebMcpHost = {
    getEditor: () => current,
    canUseAi: () => state.allowed,
    documentId: () => state.doc,
    onApplied: vi.fn(),
    newDiagram: vi.fn(async () => editor),
    shareLink: vi.fn(async () => ({ url: "", length: 0 })),
  };
  const tool = toModelContextTool(buildTools(host).find((t) => t.name === "check_diagram")!);
  const replaceEditor = () => (current = { getDiagram: diagram } as unknown as EditorApi);
  return { state, tool, replaceEditor };
}

type Reply = ReturnType<ReturnType<typeof setup>["tool"]["execute"]>;

/** Starts the call and waits until playback has begun (the reply is wrapped: awaiting it here would wait for it). */
async function started(tool: ReturnType<typeof setup>["tool"], signal?: AbortSignal): Promise<{ reply: Reply }> {
  const reply = tool.execute({ simulations: true }, signal ? { signal } : undefined);
  await vi.waitFor(() => expect(play.runs).toHaveLength(1));
  return { reply };
}

const text = async ({ reply }: { reply: Reply }) => (await reply).content[0].text;

describe("check_diagram with simulations: true, while they play", () => {
  beforeEach(() => void (play.runs.length = 0));

  it("returns the counts when nothing changed", async () => {
    const { tool } = setup();
    const call = await started(tool);
    play.runs[0].resolve(EVIDENCE);
    const out = JSON.parse(await text(call));
    expect(out.findings[0]).toMatchObject({ id: "dead-letter:q", evidence: ["7 dropped in “Bad batch”"] });
  });

  it("says nothing about the diagram if it was made Private (or AI tools turned off) meanwhile", async () => {
    const { tool, state } = setup();
    const call = await started(tool);
    state.allowed = false;
    play.runs[0].resolve(EVIDENCE);
    const t = await text(call);
    expect(JSON.parse(t)).toMatchObject({ ok: false });
    expect(t).not.toContain(SECRET);
    expect(t).not.toContain("dead-letter");
    expect(t).not.toContain("Bad batch");
  });

  it("says nothing if another diagram was opened, in another editor or in the same one", async () => {
    for (const change of ["editor", "document"] as const) {
      play.runs.length = 0;
      const { tool, state, replaceEditor } = setup();
      const call = await started(tool);
      if (change === "editor") replaceEditor();
      else state.doc = "doc-2";
      play.runs[0].resolve(EVIDENCE);
      const t = await text(call);
      expect(JSON.parse(t), change).toMatchObject({ ok: false });
      expect(t, change).not.toContain(SECRET);
      expect(t, change).not.toContain("Bad batch");
    }
  });

  it("a cancelled call stops the playback and returns nothing about the diagram", async () => {
    const { tool } = setup();
    const controller = new AbortController();
    const call = await started(tool, controller.signal);
    controller.abort();
    expect(play.runs[0].cancel).toHaveBeenCalledOnce();
    const t = await text(call);
    expect(JSON.parse(t)).toMatchObject({ ok: false, error: "The call was cancelled." });
    expect(t).not.toContain(SECRET);
  });
});

describe("waiting for scenario sizing from the checks worker", () => {
  beforeEach(() => void (play.runs.length = 0));
  /** A worker planner the test answers (or never answers). */
  function pendingPlanner() {
    let answer!: () => void;
    const planner = vi.fn(() => new Promise<never[]>((resolve) => (answer = () => resolve([]))));
    registerScenarioPlanner(planner);
    return { planner, answer: () => answer() };
  }
  afterEach(() => registerScenarioPlanner(undefined));
  const tools = () => {
    const editor = { getDiagram: diagram } as unknown as EditorApi;
    const host: WebMcpHost = {
      getEditor: () => editor,
      canUseAi: () => true,
      documentId: () => "doc-1",
      onApplied: vi.fn(),
      newDiagram: vi.fn(async () => editor),
      shareLink: vi.fn(async () => ({ url: "", length: 0 })),
    };
    const all = buildTools(host);
    return (name: string) => toModelContextTool(all.find((t) => t.name === name)!);
  };

  it("a call cancelled while sizing is pending returns nothing about the diagram and plays nothing", async () => {
    for (const [name, input] of [
      ["describe_diagram", {}],
      ["check_diagram", {}],
      ["check_diagram", { simulations: true }],
    ] as const) {
      const { planner, answer } = pendingPlanner();
      const controller = new AbortController();
      const reply = tools()(name).execute(input, { signal: controller.signal });
      await vi.waitFor(() => expect(planner).toHaveBeenCalledOnce());
      controller.abort();
      answer();
      const t = (await reply).content[0].text;
      expect(JSON.parse(t), name).toMatchObject({ ok: false, error: "The call was cancelled." });
      expect(t, name).not.toContain(SECRET);
      expect(play.runs, name).toHaveLength(0);
    }
  });

  it("doesn't wait when the reply can't use sizing: checks without capacity", async () => {
    const { planner } = pendingPlanner();
    const out = JSON.parse((await tools()("check_diagram").execute({ rules: ["dead-letter"] })).content[0].text);
    expect(out.findings[0]).toMatchObject({ id: "dead-letter:q" });
    expect(planner).not.toHaveBeenCalled();
  });
});
