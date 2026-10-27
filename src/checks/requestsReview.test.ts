import { afterEach, expect, it, vi } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { runChecks } from "./run";
import { requestFindings } from "./requestFindings";
import { buildContext } from "./context";
import { registerRequestChecks, awaitRequestChecks, requestCheckResult } from "../lib/requestCheckCache";
import { registerScenarioPlanner } from "../lib/scenarioPlanner";
import { buildTools } from "../ai/webmcp/tools";
import type { EditorApi } from "../editor/types";
import * as inputs from "../live/playbackInputs";
import * as verification from "../live/threadFixPlan";
import { TroubleWatcher, type WatchedFrame } from "../live/observedTrouble";
import { resolveNodeProps } from "../sim/defaults";
import { requestResponseMs } from "../sim/timing";

afterEach(() => {
  registerRequestChecks(undefined);
  registerScenarioPlanner(undefined);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("an agent call during pending checks awaits findings, and later reads hit the same result", async () => {
  const d = waitingFixture();
  d.nodes[0].props!.ratePerSec = 100;
  const findings = requestFindings(buildContext(d));
  let answer!: () => void;
  let started!: () => void;
  const began = new Promise<void>((resolve) => (started = resolve));
  const provider = vi.fn(
    () =>
      new Promise<typeof findings>((resolve) => {
        answer = () => resolve(findings);
        started();
      }),
  );
  registerRequestChecks(provider);
  registerScenarioPlanner(async () => []);
  const editor = { getDiagram: () => d } as unknown as EditorApi;
  const tool = buildTools({
    getEditor: () => editor,
    onApplied: vi.fn(),
    newDiagram: vi.fn(),
    shareLink: vi.fn(),
  }).find((t) => t.name === "check_diagram")!;
  let finished = false;
  const reply = Promise.resolve(tool.run({ rules: ["blocked-threads", "call-timeout"] })).then((value) => {
    finished = true;
    return value;
  });
  await began;
  expect(requestCheckResult(d)?.status).toBe("pending");
  expect(finished).toBe(false);
  expect(() => runChecks(d)).toThrow("pending");
  answer();
  expect(JSON.stringify(await reply)).toContain("blocked-threads:caller");
  expect(JSON.stringify(await reply)).toContain("call-timeout:call");
  expect(await awaitRequestChecks(d)).toEqual(findings);
  expect(provider).toHaveBeenCalledOnce();
});

it("failed checks remain failed rather than reporting a clean cache miss", async () => {
  const d = waitingFixture();
  registerRequestChecks(async () => {
    throw new Error("checks unavailable");
  });
  await expect(awaitRequestChecks(d)).rejects.toThrow("checks unavailable");
  expect(requestCheckResult(d)?.status).toBe("failed");
  expect(() => runChecks(d)).toThrow("checks unavailable");
});

it.each(["generic.external-api", "generic.llm"])(
  "%s endpoint timing agrees in Checks and live timeout advice",
  (stencil) => {
    const d = waitingFixture();
    d.nodes[0].props!.ratePerSec = 1;
    d.nodes[1].props!.concurrency = 10;
    d.nodes[2].stencil = stencil;
    d.nodes[2].props = {
      latencyMs: 200,
      api: { latencyMs: 250 },
      endpoints: [{ id: "slow", method: "GET", path: "/slow", behaviour: { latencyMs: 2000 } }],
    };
    d.edges[1].props = { endpointId: "slow", networkDelayMs: 25 };
    const finding = runChecks(d, { rules: ["call-timeout"] }).findings[0];
    const deadline = finding.requestFinding!.deadline!;
    expect(deadline).toBeGreaterThan(2050);
    const observe = (rate: number) => {
      const watcher = new TroubleWatcher();
      let action;
      for (let seconds = 0; seconds <= 10; seconds++) {
        const frame: WatchedFrame = {
          time: seconds * 1000,
          faults: [{ kind: "slow", node: "partner", factor: 10 }],
          nodes: {
            caller: {
              status: "up",
              dropped: 0,
              lag: {},
              processed: 0,
              backlog: seconds * rate,
              threads: { slots: 10, working: 0, waiting: 10, queued: seconds, waitingOn: [["call", 10]] },
            },
            partner: { status: "up", dropped: 0, lag: {} },
          },
        };
        action = watcher.observe(frame, d).find((t) => t.node === "caller")?.action;
      }
      return action;
    };
    expect(observe(1)).toEqual({ kind: "add-timeout", edge: "call", deadlineMs: deadline });
    d.nodes[0].props!.ratePerSec = 10;
    expect(runChecks(d, { rules: ["call-timeout"] }).findings[0].fix).toBeUndefined();
    expect(observe(10)).toEqual({ kind: "free-thread", edge: "call" });
  },
);

it("endpoint timing preserves downstream residence and API/model default work", () => {
  const d = waitingFixture();
  const p = resolveNodeProps(d, d.nodes[2]);
  expect(requestResponseMs(p, { workMs: 250, memoryResidenceMs: 750 }, undefined, 25)).toBe(800);
  expect(requestResponseMs(p, undefined, undefined, 25)).toBe(300);
  p.admission!.endpoints = [{ id: "slow", method: "GET", path: "/slow", behaviour: { latencyMs: 2000 } }];
  expect(requestResponseMs(p, { workMs: 250, memoryResidenceMs: 750 }, "slow", 25)).toBe(2550);
});

it("an unrelated freed cycle does not hide a blocking deadlock", () => {
  const d = waitingFixture();
  // Services on both loops: an API (a sink) or a store never calls back in playback, so no thread could wait there.
  for (const n of d.nodes) if (n.id === "partner" || n.id === "result") n.stencil = "generic.service";
  d.edges = [
    { id: "ab", from: "caller", to: "partner", kind: "sync" },
    { id: "ba", from: "partner", to: "caller", kind: "sync", props: { caller: { wait: "blocking" } } },
    { id: "ac", from: "caller", to: "result", kind: "sync", props: { caller: { wait: "non-blocking" } } },
    { id: "ca", from: "result", to: "caller", kind: "sync", props: { caller: { wait: "non-blocking" } } },
  ];
  const deadlock = () => runChecks(d, { rules: ["sync-cycle"] }).findings[0].threadDeadlock;
  expect(deadlock()).toBe(true);
  d.edges[0].props = { caller: { deadlineMs: 600 } };
  expect(deadlock()).toBeUndefined();
});

it.each([2, 8])("free-play inputs are built once within budget and never outside it (%i callers)", (count) => {
  const d = waitingFixture();
  const base = structuredClone(d);
  d.nodes = [];
  d.edges = [];
  for (let i = 0; i < count; i++) {
    d.nodes.push(
      ...base.nodes.map((n) => ({
        ...n,
        id: `${n.id}-${i}`,
        props: { ...n.props, ...(n.id === "source" ? { ratePerSec: 100 } : {}) },
      })),
    );
    d.edges.push(...base.edges.map((e) => ({ ...e, id: `${e.id}-${i}`, from: `${e.from}-${i}`, to: `${e.to}-${i}` })));
  }
  const scale = vi.spyOn(inputs, "freePlayScale");
  const props = vi.spyOn(inputs, "freePlayProps");
  const replay = vi.spyOn(verification, "confirmedThreadFix").mockReturnValue(undefined);
  requestFindings(buildContext(d));
  expect(scale).toHaveBeenCalledTimes(count === 2 ? 1 : 0);
  expect(props).toHaveBeenCalledTimes(count === 2 ? 1 : 0);
  expect(replay).toHaveBeenCalledTimes(count === 2 ? 2 : 0);
});
