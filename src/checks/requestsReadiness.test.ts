import { afterEach, describe, expect, it, vi } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import type { DiagramFile } from "../model/types";
import type { Finding } from "./types";
import { onlyRules, runChecks, summarize } from "./run";
import { presentFinding } from "./presentation";
import busy from "../examples/scale-on-busy-threads.json";
import { agentReport } from "./report";
import * as timeout from "../live/affordableTimeout";
import { affordableTimeout, playbackResponseMs } from "../live/affordableTimeout";
import { timeoutKeepsReplies } from "../live/threadFixPlan";
import { createSimulationRun } from "../sim/simulation";
import { applyOps } from "../ai";
import { buildContext } from "./context";
import { requestFindings } from "./requestFindings";
import { registerRequestChecks, awaitRequestChecks, requestCheckResult } from "../lib/requestCheckCache";
import { registerScenarioPlanner } from "../lib/scenarioPlanner";
import { playSimulations } from "./evidenceClient";
import { collectEvidence } from "./evidence";
import { buildTools } from "../ai/webmcp/tools";
import { PRIVATE_MESSAGE } from "../ai/privacy";
import type { EditorApi } from "../editor/types";
import { validateDiagram } from "../interop/native";
import { plannerFixture } from "../lab/plannerFixture";
import * as simulation from "../sim/simulation";

afterEach(() => {
  registerRequestChecks(undefined);
  registerScenarioPlanner(undefined);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The waiting caller at 100 req/s (four threads held 260 ms: about 15.4 req/s, 650%). */
function exhausted(): DiagramFile {
  const d = waitingFixture();
  d.nodes[0].props!.ratePerSec = 100;
  return d;
}

/** An unrelated worker at 200% beside the exhausted caller. */
function twoBottlenecks(): DiagramFile {
  const d = exhausted();
  d.nodes.push(
    { id: "jobs", stencil: "client.user", label: "Jobs", x: 0, y: 600, props: { ratePerSec: 20 } },
    {
      id: "worker",
      stencil: "generic.service",
      label: "Report worker",
      x: 330,
      y: 600,
      props: { replicas: 1, concurrency: 1, latencyMs: 100, jitter: 0 },
    },
  );
  d.edges.push({ id: "jobs-in", from: "jobs", to: "worker" });
  return d;
}

const ids = (findings: readonly Finding[]) => findings.map((f) => f.id);

function toolFor(d: () => DiagramFile, host: { canUseAi?: () => boolean; documentId?: () => string } = {}) {
  const editor = { getDiagram: d } as unknown as EditorApi;
  return buildTools({
    getEditor: () => editor,
    onApplied: vi.fn(),
    newDiagram: vi.fn(),
    shareLink: vi.fn(),
    ...host,
  }).find((t) => t.name === "check_diagram")!;
}

/** A provider that answers only when told to. */
function heldProvider(findings: () => Finding[]) {
  let answer!: () => void;
  let started!: () => void;
  const began = new Promise<void>((resolve) => (started = resolve));
  const provider = vi.fn(
    () =>
      new Promise<Finding[]>((resolve) => {
        answer = () => resolve(findings());
        started();
      }),
  );
  registerRequestChecks(provider);
  return { provider, began, answer: () => answer() };
}

describe("capacity and request findings", () => {
  it("a diagnosed caller doesn't hide another service's capacity warning", () => {
    const d = twoBottlenecks();
    const found = ids(runChecks(d).findings);
    expect(found).toContain("blocked-threads:caller");
    expect(found).toContain("capacity:worker");
    expect(found).not.toContain("capacity:caller");
    // Freeing the caller changes nothing about the worker's warning.
    d.edges.find((e) => e.id === "call")!.props = { caller: { wait: "non-blocking" } };
    expect(ids(runChecks(d).findings)).toContain("capacity:worker");
  });

  it("a broker that is down keeps its outage warning beside a diagnosed caller", () => {
    const d = exhausted();
    d.nodes.push({ id: "topic", stencil: "kafka.topic", label: "Topic", x: 160, y: 180, props: { partitions: 12 } });
    d.edges = d.edges.filter((e) => e.id !== "input");
    d.edges.push(
      { id: "publish", from: "source", to: "topic" },
      { id: "consume", from: "topic", to: "caller", props: { group: "decisions" } },
    );
    // Healthy, the topic's backlog is the caller's: only the caller's finding.
    const healthy = ids(runChecks(d).findings);
    expect(healthy).toContain("blocked-threads:caller");
    expect(healthy).not.toContain("capacity:topic");
    // Down, it's an outage of its own: fixing the caller can't bring it back.
    d.nodes.find((n) => n.id === "topic")!.props!.status = "down";
    const down = runChecks(d).findings.find((f) => f.id === "capacity:topic");
    expect(down?.title).toBe("Topic is down");
  });

  it("capacity keeps its warning when the waiting checks don't run", () => {
    const d = exhausted();
    expect(ids(runChecks(d, { rules: ["capacity"] }).findings)).toEqual(["capacity:caller"]);
    d.checks = { off: ["blocked-threads", "scaling-blind"] };
    expect(ids(runChecks(d).findings)).toContain("capacity:caller");
    d.checks = undefined;
    expect(ids(runChecks(d, { rules: ["capacity", "blocked-threads"] }).findings)).toEqual(["blocked-threads:caller"]);
  });

  it("capacity-only checks never wait for request checks", () => {
    const d = exhausted();
    registerRequestChecks(() => new Promise(() => {}));
    expect(ids(runChecks(d, { rules: ["capacity"] }).findings)).toEqual(["capacity:caller"]);
    expect(requestCheckResult(d)).toBeUndefined();
  });

  it("inactive calls are neither the blocking cause nor timeout findings", () => {
    const d = exhausted();
    d.nodes[0].props!.ratePerSec = 20;
    const before = runChecks(d).findings.find((f) => f.id === "blocked-threads:caller")!;
    expect(before.requestFinding?.callee).toBe("Partner scoring API");
    d.nodes.push({
      id: "unused",
      stencil: "generic.external-api",
      label: "Unused API",
      x: 660,
      y: 0,
      props: { latencyMs: 5000, api: { latencyMs: 5000 }, jitter: 0 },
    });
    d.edges.push({ id: "idle", from: "caller", to: "unused", kind: "sync", props: { share: 0 } });
    const result = runChecks(d).findings;
    const after = result.find((f) => f.id === "blocked-threads:caller")!;
    expect(after.requestFinding?.callee).toBe("Partner scoring API");
    expect(after.elements).toEqual(before.elements);
    expect(after.fix).toEqual(before.fix);
    expect(ids(result)).not.toContain("call-timeout:idle");
    // A deny rule's call is blocked at its source too.
    d.edges.find((e) => e.id === "idle")!.props = { deny: true };
    expect(ids(runChecks(d).findings)).not.toContain("call-timeout:idle");
  });
});

describe("request checks and Run simulations", () => {
  function withSimulation(): DiagramFile {
    const d = exhausted();
    d.nodes[0].props!.ratePerSec = 0;
    d.simulations = [
      {
        id: "burst",
        title: "Burst",
        seed: 1,
        durationMs: 2000,
        traffic: [{ id: "b", node: "source", shape: { kind: "burst", count: 20 } }],
      },
    ];
    return d;
  }

  it("the main-thread fallback plays when request checks failed", async () => {
    const d = withSimulation();
    registerRequestChecks(async () => {
      throw new Error("worker gone");
    });
    await expect(awaitRequestChecks(d)).rejects.toThrow("worker gone");
    expect(requestCheckResult(d)?.status).toBe("failed");
    const run = playSimulations(d, () => {}, { worker: false });
    expect(await run.done).toEqual(collectEvidence(d));
  });

  it.each(["missing", "pending"])("the main-thread fallback plays with request checks %s", async (state) => {
    const d = withSimulation();
    const held = heldProvider(() => []);
    if (state === "pending") void awaitRequestChecks(d);
    const run = playSimulations(d, () => {}, { worker: false });
    expect(await run.done).toEqual(collectEvidence(d));
    if (state === "pending") {
      expect(requestCheckResult(d)?.status).toBe("pending");
      held.answer();
      await expect(awaitRequestChecks(d)).resolves.toEqual([]);
    } else expect(held.provider).not.toHaveBeenCalled();
  });
});

describe("pending request checks respect cancellation and document access", () => {
  it("an abort settles at once, and the shared work still completes", async () => {
    const d = exhausted();
    const expected = requestFindings(buildContext(d));
    registerRequestChecks(undefined);
    const held = heldProvider(() => expected);
    const abort = new AbortController();
    const reply = Promise.resolve(toolFor(() => d).run({ rules: ["blocked-threads"] }, abort.signal));
    await held.began;
    abort.abort();
    await expect(reply).rejects.toThrow("cancelled");
    held.answer();
    await expect(awaitRequestChecks(d)).resolves.toEqual(expected);
  });

  it("revoking AI access while checks are pending returns no findings", async () => {
    const d = exhausted();
    const expected = requestFindings(buildContext(d));
    registerRequestChecks(undefined);
    const held = heldProvider(() => expected);
    let allowed = true;
    const reply = Promise.resolve(toolFor(() => d, { canUseAi: () => allowed }).run({ rules: ["blocked-threads"] }));
    await held.began;
    allowed = false;
    held.answer();
    const error = await reply.then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(error?.message).toBe(PRIVATE_MESSAGE);
    expect(JSON.stringify(error)).not.toContain("Decision service");
  });

  it("switching documents while checks are pending returns no findings from the first", async () => {
    const d = exhausted();
    const expected = requestFindings(buildContext(d));
    registerRequestChecks(undefined);
    const held = heldProvider(() => expected);
    let doc = "a";
    let open = d;
    const reply = Promise.resolve(toolFor(() => open, { documentId: () => doc }).run({ rules: ["blocked-threads"] }));
    await held.began;
    doc = "b";
    open = waitingFixture();
    held.answer();
    const error = await reply.then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).not.toContain("Decision service");
    expect(error!.message).not.toContain("blocked-threads");
  });

  it("a failed check that becomes private reports privacy, not the failure", async () => {
    const d = exhausted();
    let allowed = true;
    let fail!: () => void;
    let started!: () => void;
    const began = new Promise<void>((resolve) => (started = resolve));
    registerRequestChecks(
      () =>
        new Promise((_, reject) => {
          fail = () => reject(new Error("Decision service exploded"));
          started();
        }),
    );
    const reply = Promise.resolve(toolFor(() => d, { canUseAi: () => allowed }).run({ rules: ["call-timeout"] }));
    await began;
    allowed = false;
    fail();
    await expect(reply).rejects.toThrow(PRIVATE_MESSAGE);
  });

  it("a background recheck of the same content doesn't make an awaited read pending", async () => {
    const d = exhausted();
    const expected = requestFindings(buildContext(d));
    registerRequestChecks(async () => expected);
    expect(await awaitRequestChecks(d)).toEqual(expected);
    const { trackRequestChecks } = await import("../lib/requestCheckCache");
    let finish!: () => void;
    const gate = new Promise<Finding[]>((resolve) => (finish = () => resolve(expected)));
    const again = trackRequestChecks(d, () => gate);
    expect(requestCheckResult(d)?.status).toBe("ready");
    expect(ids(runChecks(d, { rules: ["blocked-threads"] }).findings)).toEqual(["blocked-threads:caller"]);
    finish();
    await again;
  });
});

describe("bounded request findings", () => {
  it("timeout fixes read the context's edge index, never a scan of the connections per fix", () => {
    const d = waitingFixture();
    d.nodes[0].props!.ratePerSec = 5;
    // Every offered timeout is replayed first (within one work budget), so as many calls as that budget verifies.
    d.edges = [
      d.edges[0],
      ...Array.from({ length: 12 }, (_, i) => ({
        id: `c${i}`,
        from: "caller",
        to: "partner",
        kind: "sync" as const,
      })),
    ];
    const scans = vi.spyOn(d.edges, "find");
    const findings = requestFindings(buildContext(d));
    expect(findings.filter((f) => f.rule === "call-timeout" && f.fix)).toHaveLength(12);
    expect(scans).not.toHaveBeenCalled();
  });

  it("a long imported label is bounded in per-edge findings and kept in the diagram", () => {
    const d = waitingFixture();
    d.nodes[0].props!.ratePerSec = 1;
    d.nodes = d.nodes.filter((n) => n.id === "caller" || n.id === "partner");
    const label = "P".repeat(20_000);
    d.nodes[1].label = label;
    d.edges = Array.from({ length: 200 }, (_, i) => ({
      id: `c${i}`,
      from: "caller",
      to: "partner",
      kind: "sync" as const,
    }));
    expect(validateDiagram(d).ok).toBe(true);
    const result = runChecks(d);
    const timeouts = result.findings.filter((f) => f.rule === "call-timeout");
    expect(timeouts).toHaveLength(200);
    expect(JSON.stringify(result).length).toBeLessThan(200 * 1_500);
    for (const f of timeouts) {
      expect(f.title.length).toBeLessThanOrEqual(240);
      expect(f.requestFinding!.callee.length).toBeLessThanOrEqual(200);
      expect(f.requestFinding!.callee.endsWith("…")).toBe(true);
    }
    expect(d.nodes[1].label).toBe(label);
  });

  it("a name is never cut inside a surrogate pair", () => {
    const d = waitingFixture();
    d.nodes[0].props!.ratePerSec = 1;
    d.nodes[2].label = "😀".repeat(300);
    const callee = runChecks(d, { rules: ["call-timeout"] }).findings[0].requestFinding!.callee;
    expect(callee.endsWith("…")).toBe(true);
    expect(callee).toBe(`${"😀".repeat(199)}…`);
  });

  it("the request findings fit a total budget however many calls there are", () => {
    const d = manyCalls(3_000);
    const findings = requestFindings(buildContext(d));
    expect(findings.length).toBeGreaterThan(100);
    expect(findings.length).toBeLessThan(3_000);
    // The budget bounds the findings; the count of what didn't fit rides beside them.
    expect(JSON.stringify(findings.filter((f) => !f.omitted)).length).toBeLessThanOrEqual(1_000_000);
    // Deterministic: the first calls in diagram order are the ones reported, worked out again from cold.
    expect(findings[0].target).toBe(d.edges[0].id);
    registerRequestChecks(undefined);
    expect(requestFindings(buildContext(structuredClone(d)))).toEqual(findings);
  });

  it("a bounded result says how many it left out, and is never clean", () => {
    const d = manyCalls(3_000);
    const result = runChecks(d, { rules: ["call-timeout"] });
    const listed = result.findings.length;
    expect(result.omitted).toEqual([{ rule: "call-timeout", count: 3_000 - listed }]);
    expect(result.findings.every((f) => f.requestFinding)).toBe(true);
    expect(summarize(result)).toContain(`${3_000 - listed} more call-timeout findings not listed`);
    // Ignoring every listed one still doesn't read as all clear.
    d.checks = { ignore: result.findings.map((f) => ({ rule: f.rule, target: f.target })) };
    const ignored = runChecks(d, { rules: ["call-timeout"] });
    expect(ignored.findings).toEqual([]);
    expect(summarize(ignored)).not.toContain("Nothing to check");
    expect(agentReport(ignored).summary).toContain("not listed");
    // A diagram that fits says nothing of the kind.
    expect(runChecks(manyCalls(10), { rules: ["call-timeout"] }).omitted).toBeUndefined();
  });

  it("timeout construction stops at the findings budget", () => {
    const built = (count: number) => {
      registerRequestChecks(undefined);
      const timeouts = vi.spyOn(timeout, "affordableTimeout");
      const findings = requestFindings(buildContext(manyCalls(count)));
      const calls = timeouts.mock.calls.length;
      timeouts.mockRestore();
      return { calls, listed: findings.filter((f) => !f.omitted).length };
    };
    const some = built(3_000);
    const more = built(6_000);
    expect(more.listed).toBe(some.listed);
    // Only the listed prefix (and the one that overflowed) is built, however many calls follow.
    expect(some.calls).toBeLessThanOrEqual(some.listed + 2);
    expect(more.calls).toBe(some.calls);
  });
});

/** A caller with `count` deadline-free calls to one API, long ids and names: past the findings budget. */
function manyCalls(count: number): DiagramFile {
  const d = waitingFixture();
  d.nodes[0].props!.ratePerSec = 1;
  d.nodes = d.nodes.filter((n) => n.id === "caller" || n.id === "partner");
  d.nodes[0].label = "C".repeat(200);
  d.nodes[1].label = "P".repeat(200);
  d.edges = Array.from({ length: count }, (_, i) => ({
    id: `call-${String(i).padStart(5, "0")}-${"x".repeat(150)}`,
    from: "caller",
    to: "partner",
    kind: "sync" as const,
  }));
  return d;
}

describe("scenario sizing without a worker", () => {
  it.each([
    ["capacity off", { off: ["capacity" as const] }, 0],
    ["capacity on", undefined, 1],
  ])("the fallback plans only when a check reads the plans (%s)", async (_, checks, expected) => {
    vi.stubGlobal("Worker", undefined);
    registerScenarioPlanner(async () => []);
    registerRequestChecks(async () => []);
    const d = plannerFixture();
    d.planning = { ...d.planning, revision: "p3-w1" };
    d.title = `Fallback ${expected}`;
    d.nodes[1].label = `Worker ${expected}`;
    d.checks = checks;
    const planner = await import("../sim/scalingPlanner");
    const plans = vi.spyOn(planner, "planScaling");
    const played = vi.spyOn(simulation, "createSimulationRun");
    const { runChecksOffThread } = await import("../canvas/checks/runner");
    await runChecksOffThread(d);
    expect(plans).toHaveBeenCalledTimes(expected);
    if (!expected) expect(played).not.toHaveBeenCalled();
    else expect(played).toHaveBeenCalled();
  });
});

describe("overlapping request-check attempts", () => {
  it("an older successful attempt cannot replace a newer result", async () => {
    const d = exhausted();
    const older = [{ ...requestFindings(buildContext(d))[0], title: "older" }];
    registerRequestChecks(undefined);
    const newer = [{ ...older[0], title: "newer" }];
    const { trackRequestChecks } = await import("../lib/requestCheckCache");
    let finishOlder!: () => void;
    let finishNewer!: () => void;
    const first = trackRequestChecks(d, () => new Promise((resolve) => (finishOlder = () => resolve(older))));
    const second = trackRequestChecks(d, () => new Promise((resolve) => (finishNewer = () => resolve(newer))));
    await Promise.resolve();
    await Promise.resolve();
    finishNewer();
    expect(await second).toBe(newer);
    finishOlder();
    expect(await first).toBe(older);
    expect(requestCheckResult(d)).toEqual({ status: "ready", findings: newer });
  });

  it("an older failure cannot replace a newer result, and its callers still hear it", async () => {
    const d = exhausted();
    const newer = requestFindings(buildContext(d));
    registerRequestChecks(undefined);
    const { trackRequestChecks } = await import("../lib/requestCheckCache");
    let failOlder!: () => void;
    const first = trackRequestChecks(d, () => new Promise((_, reject) => (failOlder = () => reject(new Error("old")))));
    const second = trackRequestChecks(d, async () => newer);
    expect(await second).toBe(newer);
    await Promise.resolve();
    failOlder();
    await expect(first).rejects.toThrow("old");
    expect(requestCheckResult(d)).toEqual({ status: "ready", findings: newer });
  });
});

describe("timeouts against playback's ticks", () => {
  /** The caller at 150 req/s with `threads`, an API answering in `latencyMs` over `networkDelayMs` each way. */
  function timed(latencyMs: number, networkDelayMs: number, threads: number): DiagramFile {
    const d = waitingFixture();
    d.nodes[0].props!.ratePerSec = 150;
    d.nodes[1].props = { replicas: 1, concurrency: threads, latencyMs: 0, jitter: 0 };
    d.nodes[2].props = { latencyMs, api: { latencyMs }, jitter: 0 };
    d.edges[1].props = { networkDelayMs };
    return d;
  }
  const play = (d: DiagramFile) => {
    const run = createSimulationRun(d, {
      id: "steady",
      title: "Steady",
      seed: 1,
      durationMs: 2000,
      traffic: [{ id: "t", node: "source", shape: { kind: "constant", ratePerSec: 150, durationMs: 2000 } }],
    });
    for (let i = 0; i < 200; i++) run.step(10);
    return run.engine.measure({ node: "caller", field: "timedOut" });
  };

  it("offered timeouts preserve healthy replies with default jitter", () => {
    let offered = 0;
    for (const jitter of [undefined, 0.2, 0.5])
      for (const threads of [4, 8, 40])
        for (const latency of [5, 9, 11, 19, 33]) {
          const d = timed(latency, 0, threads);
          // Default jitter (0.2) unless set.
          d.nodes[2].props = {
            latencyMs: latency,
            api: { latencyMs: latency },
            ...(jitter === undefined ? {} : { jitter }),
          };
          const finding = runChecks(d, { rules: ["call-timeout"] }).findings[0];
          if (!finding.fix?.ops) continue;
          offered++;
          const fixed = applyOps(d, finding.fix.ops);
          if (!fixed.ok) throw new Error("The fix didn't apply");
          expect({ jitter, threads, latency, timedOut: play(fixed.diagram) }).toEqual({
            jitter,
            threads,
            latency,
            timedOut: 0,
          });
        }
    expect(offered).toBeGreaterThan(10);
  }, 120_000); // About 45 replays and runs.

  it("offered timeouts preserve nested model-API replies, and the callout agrees", () => {
    // A model API that does 1 ms of work and calls an 11 ms service: its reply lands after both stages' ticks.
    let offered = 0;
    const agreed: [DiagramFile, number][] = [];
    for (const threads of [8, 16, 40])
      for (const inner of [11, 1, 19]) {
        const d = timed(1, 0, threads);
        d.nodes[2] = { ...d.nodes[2], stencil: "generic.llm", props: { latencyMs: 1, jitter: 0 } };
        d.nodes.push({
          id: "inner",
          stencil: "generic.service",
          label: "Retrieval",
          x: 900,
          y: 180,
          props: { replicas: 1, concurrency: 400, latencyMs: inner, jitter: 0 },
        });
        d.edges.push({ id: "retrieve", from: "partner", to: "inner", kind: "sync" });
        const finding = runChecks(d, { rules: ["call-timeout"] }).findings.find((f) => f.target === "call");
        const deadline = finding?.requestFinding?.deadline;
        // The callout's Add a timeout replays the same free play with the same deadline: the same answer.
        const proposal = finding?.fix ? deadline : undefined;
        if (!finding?.fix?.ops || proposal === undefined) continue;
        offered++;
        const fixed = applyOps(d, finding.fix.ops);
        if (!fixed.ok) throw new Error("The fix didn't apply");
        expect({ threads, inner, timedOut: play(fixed.diagram) }).toEqual({ threads, inner, timedOut: 0 });
        agreed.push([d, proposal]);
      }
    expect(offered).toBeGreaterThan(2);
    for (const [d, proposal] of agreed) expect(timeoutKeepsReplies(d, "call", proposal, { work: Infinity })).toBe(true);
    // The review's case: 8 threads, 150 req/s, 1 ms model work calling 11 ms: 40 ms would time out every reply.
    const d = timed(1, 0, 8);
    d.nodes[2] = { ...d.nodes[2], stencil: "generic.llm", props: { latencyMs: 1, jitter: 0 } };
    d.nodes.push({
      id: "inner",
      stencil: "generic.service",
      label: "Retrieval",
      x: 900,
      y: 180,
      props: { replicas: 1, concurrency: 400, latencyMs: 11, jitter: 0 },
    });
    d.edges.push({ id: "retrieve", from: "partner", to: "inner", kind: "sync" });
    expect(timeoutKeepsReplies(d, "call", 40, { work: Infinity })).toBe(false);
    expect(runChecks(d, { rules: ["call-timeout"] }).findings[0].requestFinding?.deadline).not.toBe(40);
  }, 120_000);

  it("an offered timeout never times out a normal reply, tick-aligned or not", () => {
    // The review's case: 11 ms behind four threads afforded 20 ms, and every reply landed on the deadline.
    expect(runChecks(timed(11, 0, 4), { rules: ["call-timeout"] }).findings[0].fix).toBeUndefined();
    let offered = 0;
    for (const threads of [4, 40])
      for (const net of [0, 1, 3, 10, 12])
        for (const latency of [1, 5, 9, 10, 11, 15, 19, 21, 29, 33]) {
          const d = timed(latency, net, threads);
          const finding = runChecks(d, { rules: ["call-timeout"] }).findings[0];
          if (!finding.fix?.ops) continue;
          offered++;
          const fixed = applyOps(d, finding.fix.ops);
          if (!fixed.ok) throw new Error("The fix didn't apply");
          expect({ threads, net, latency, timedOut: play(fixed.diagram) }).toEqual({
            threads,
            net,
            latency,
            timedOut: 0,
          });
        }
    expect(offered).toBeGreaterThan(20);
  }, 60_000); // About 50 two-second runs.

  it("the callout's Add a timeout uses the same playback completion", () => {
    expect(playbackResponseMs(11)).toBe(20);
    expect(playbackResponseMs(13, 3)).toBe(23);
    expect(playbackResponseMs(30, 12)).toBe(42);
    expect(affordableTimeout(11, 4, 150)).toBeUndefined();
    expect(affordableTimeout(9, 4, 150)).toBe(20);
    expect(affordableTimeout(9, 4, 150, 1)).toBeUndefined();
  });
});

describe("review round 4", () => {
  it.each([
    ["a zero share", { share: 0 }],
    ["a deny rule", { deny: true }],
  ])("a blocking loop through %s can't deadlock", (_, props) => {
    const d = waitingFixture();
    d.edges.push({ id: "self", from: "caller", to: "caller", kind: "sync", props: { ...props } });
    const finding = () => runChecks(d, { rules: ["sync-cycle"] }).findings.find((f) => f.target === "caller");
    expect(finding()).toBeDefined();
    expect(finding()?.threadDeadlock).toBeUndefined();
    d.edges.find((e) => e.id === "self")!.props = {};
    expect(finding()?.threadDeadlock).toBe(true);
  });

  it("request fixes only name elements edit ops can reference", () => {
    const d = waitingFixture();
    d.nodes[0].props!.ratePerSec = 1;
    const long = `c${"x".repeat(200)}`;
    d.edges[1].id = long;
    expect(validateDiagram(d).ok).toBe(true);
    const finding = runChecks(d, { rules: ["call-timeout"] }).findings[0];
    expect(finding.id).toBe(`call-timeout:${long}`);
    expect(finding.fix).toBeUndefined();
    // A blocked caller with a long id keeps its finding; no fix or option targets it.
    const blocked = exhausted();
    const caller = `s${"y".repeat(200)}`;
    blocked.nodes[1].id = caller;
    for (const e of blocked.edges) {
      if (e.from === "caller") e.from = caller;
      if (e.to === "caller") e.to = caller;
    }
    const found = runChecks(blocked, { rules: ["blocked-threads"] }).findings[0];
    expect(found.id).toBe(`blocked-threads:${caller}`);
    const targets = [found.fix, ...(found.fix?.options ?? [])].flatMap((f) =>
      (f?.ops ?? []).map((o) => ("target" in o ? String(o.target) : "")),
    );
    expect(targets.every((t) => t.length <= 200)).toBe(true);
    expect(targets).not.toContain(caller);
  });

  it("check_diagram with simulations keeps only the requested rules' omitted counts", async () => {
    const d = manyCalls(1_500);
    d.simulations = [{ id: "s", title: "S", seed: 1, durationMs: 1000, traffic: [] }];
    const tool = toolFor(() => d);
    const reply = JSON.stringify(await tool.run({ rules: ["no-reader"], simulations: true }));
    expect(reply).not.toContain("not listed");
    const all = JSON.stringify(await tool.run({ simulations: true }));
    expect(all).toContain("more call-timeout findings not listed");
    const result = runChecks(d);
    expect(onlyRules(result, ["no-reader"])).toEqual({ findings: [], ignored: [], off: [], ran: ["no-reader"] });
    expect(onlyRules(result, ["call-timeout"]).omitted).toEqual(result.omitted);
  });

  it("request checks run no other rule and plan nothing they don't read", async () => {
    vi.stubGlobal("Worker", undefined);
    registerScenarioPlanner(async () => []);
    const d = plannerFixture();
    d.planning = { ...d.planning, revision: "p3-w1" };
    d.nodes[1].label = "Request-only worker";
    const run = await import("./run");
    const planner = await import("../sim/scalingPlanner");
    const checks = vi.spyOn(run, "runChecks");
    const plans = vi.spyOn(planner, "planScaling");
    const { requestChecksOffThread } = await import("../canvas/checks/runner");
    expect(await requestChecksOffThread(d)).toEqual(requestFindings(buildContext(d)));
    expect(checks).not.toHaveBeenCalled();
    expect(plans).not.toHaveBeenCalled();
  });

  it("a replica alternative that adds partitions says so", () => {
    const d = structuredClone(busy) as DiagramFile;
    Object.assign(
      d.nodes.find((n) => n.id === "applications")!,
      { stencil: "kafka.topic", props: { partitions: 4 } },
    );
    const finding = runChecks(d, { rules: ["blocked-threads"] }).findings[0];
    const option = finding.fix?.options?.find((o) => o.requestLabel?.kind === "replicas");
    expect(option?.brokerChanges?.[0]?.name).toBe("Applications");
    expect(option?.short).toBe(option?.label);
    const shown = presentFinding(finding).fix!.options!.find((o) => o.requestLabel?.kind === "replicas")!;
    expect(shown.label).toContain("Applications");
    expect(shown.short).toBe(shown.label);
  });
});

describe("review round 5", () => {
  it("check_diagram with simulations keeps capacity-only findings", async () => {
    const d = exhausted();
    d.simulations = [{ id: "s", title: "S", seed: 1, durationMs: 1000, traffic: [] }];
    const tool = toolFor(() => d);
    const plain = JSON.stringify(await tool.run({ rules: ["capacity"] }));
    const played = JSON.stringify(await tool.run({ rules: ["capacity"], simulations: true }));
    expect(plain).toContain("capacity:caller");
    expect(played).toContain("capacity:caller");
    expect(played).not.toContain("Nothing to check");
    // Asked together, capacity still defers to the waiting check.
    const both = JSON.stringify(await tool.run({ rules: ["capacity", "blocked-threads"], simulations: true }));
    expect(both).toContain("blocked-threads:caller");
    expect(both).not.toContain("capacity:caller");
  });

  it("request findings are worked out only when an enabled rule reads them", async () => {
    const d = exhausted();
    d.checks = { off: ["capacity", "blocked-threads", "scaling-blind", "call-timeout"] };
    const headless = await import("../sim/headless");
    const replays = vi.spyOn(headless, "createHeadlessRun");
    const { executeChecks } = await import("./execute");
    const run = executeChecks(d);
    expect(run.requests).toBeUndefined();
    expect(replays).not.toHaveBeenCalled();
    // Without a worker: nothing goes in the shared store, so turning a rule on later works them out then.
    vi.stubGlobal("Worker", undefined);
    registerRequestChecks(async () => {
      throw new Error("not this way");
    });
    const { runChecksOffThread } = await import("../canvas/checks/runner");
    await runChecksOffThread(d);
    expect(requestCheckResult(d)).toBeUndefined();
    expect(replays).not.toHaveBeenCalled();
    d.checks = { off: ["capacity", "scaling-blind", "call-timeout"] };
    expect(executeChecks(d).requests?.map((f) => f.id)).toContain("blocked-threads:caller");
    expect(replays).toHaveBeenCalled();
  });
});
