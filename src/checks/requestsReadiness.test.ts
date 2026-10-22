import { afterEach, describe, expect, it, vi } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import type { DiagramFile } from "../model/types";
import type { Finding } from "./types";
import { runChecks, summarize } from "./run";
import { agentReport } from "./report";
import * as timeout from "../live/affordableTimeout";
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
    d.nodes[0].props!.ratePerSec = 1;
    d.edges = Array.from({ length: 300 }, (_, i) => ({
      id: `c${i}`,
      from: "caller",
      to: "partner",
      kind: "sync" as const,
    }));
    const scans = vi.spyOn(d.edges, "find");
    const findings = requestFindings(buildContext(d));
    expect(findings.filter((f) => f.fix)).toHaveLength(300);
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
