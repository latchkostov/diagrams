import { initialEditorMode } from "../canvas/interaction/mode";
import { HistoryController } from "../editor/historyController";
import { toFlow, fromFlow } from "../canvas/convert";
import { apiGateway } from "./catalog/apiGateway";
import { kafkaTopic } from "./catalog/kafkaTopic";
import { cacheAside } from "./catalog/cacheAside";
import { outbox } from "./catalog/outbox";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { addressPractice, policyPractice, checksPractice } from "../lab/buildingBlockSeeds";
import { LiveController } from "../live/controller";
import { runChecks } from "../checks/run";
import type { DiagramFile } from "../model/types";
import type { Check, Tutorial } from "./types";
import { baselineKey, holds, resolveSubjects } from "./checks";
import { patchProps } from "./paths";
import { routeByAddress } from "./catalog/routeByAddress";
import { networkPolicy } from "./catalog/networkPolicy";
import { checksAndFixes } from "./catalog/checksAndFixes";
import { partitions } from "./catalog/partitions";
import { repairedRun } from "./repair";

function play(d: DiagramFile, id: string) {
  const c = new LiveController(d);
  c.selectSimulation(d.simulations!.find((run) => run.id === id)!);
  c.setPlaying(true);
  for (let tick = 0; tick < 1000; tick++) c.advance(10);
  c.publish();
  return c;
}
function check(t: Tutorial, id: string): Check {
  return t.steps.find((s) => s.id === id)!.check;
}
function met(t: Tutorial, id: string, d: DiagramFile, c?: LiveController) {
  return holds(
    check(t, id),
    {
      diagram: d,
      live: !!c,
      processed: (node) => c?.getState().snapshot.nodes[node]?.processed ?? 0,
      session: c?.getState(),
    },
    resolveSubjects(t, d),
  );
}
function repair(t: Tutorial, id: string, d: DiagramFile) {
  for (const demo of t.steps.find((s) => s.id === id)!.demo) {
    if (demo.kind !== "patch") continue;
    const node = d.nodes.find((n) => n.id === resolveSubjects(t, d)[demo.subject!])!;
    node.props = { ...node.props, ...patchProps(node.props, demo.patches) };
  }
}

describe("address routing practice", () => {
  it("rejects the wrong destination and a split near miss, then keeps the keyed rule through reordering", () => {
    const d = addressPractice();
    expect(met(routeByAddress, "route", d)).toBe(false);
    repair(routeByAddress, "route", d);
    expect(met(routeByAddress, "route", d)).toBe(true);
    const table = d.nodes[1].props!.routeTable as {
      rules: { id: string; targets: { edgeId: string; weight: number }[] }[];
    };
    table.rules.reverse();
    expect(met(routeByAddress, "route", d)).toBe(true);
    table.rules.find((r) => r.id === "parcels")!.targets.push({ edgeId: "to-pricing", weight: 1 });
    expect(met(routeByAddress, "route", d)).toBe(false);
  });
  it("uses first match before Default and refuses the supplied unknown route without Default", () => {
    const d = addressPractice();
    repair(routeByAddress, "route", d);
    const unknown = play(d, "unknown-address");
    expect(met(routeByAddress, "refuse", d, unknown)).toBe(true);
    expect(unknown.getState().snapshot.nodes.tracking.processed).toBe(0);
    repair(routeByAddress, "default", d);
    const forwarded = play(d, "unknown-address");
    expect(forwarded.getState().snapshot.nodes.tracking.processed).toBe(10);
    expect(met(routeByAddress, "refuse", d, forwarded)).toBe(false);
    const mixed = play(d, "address-mix");
    expect(mixed.getState().snapshot.nodes.pricing.processed).toBeGreaterThan(0);
    const table = d.nodes[1].props!.routeTable as {
      rules: { id: string; match: object; targets: { edgeId: string; weight: number }[] }[];
    };
    table.rules.unshift({ id: "catch-all", match: {}, targets: [{ edgeId: "to-pricing", weight: 1 }] });
    expect(play(d, "address-mix").getState().snapshot.nodes.tracking.processed).toBe(0);
  });
  it("does not mistake any trace or another route’s refusal for Orders evidence", () => {
    const d = addressPractice();
    const c = play(d, "unknown-address");
    expect(
      holds(
        { kind: "routeEvidence", subject: "gw", route: "track-parcel", rejected: true },
        { diagram: d, live: true, session: c.getState(), processed: () => 0 },
        resolveSubjects(routeByAddress, d),
      ),
    ).toBe(false);
    expect(met(routeByAddress, "watch", d, c)).toBe(false);
  });
});

describe("network policy practice", () => {
  it("conserves the two classes and counts denials separately from failed or dropped work", () => {
    const d = policyPractice();
    const c = play(d, "policy-traffic");
    const n = c.getState().snapshot.nodes;
    expect(n.app.processed).toBe(48);
    expect(n.admin.processed).toBe(0);
    expect(n.firewall.blocked).toBe(12);
    expect(n.firewall.failed).toBe(0);
    expect(n.firewall.dropped).toBe(0);
    const deny = d.edges.find((e) => e.id === "deny-admin")!;
    expect(met(networkPolicy, "allow", d)).toBe(false);
    deny.props!.deny = false;
    expect(met(networkPolicy, "allow", d)).toBe(true);
    delete deny.props!.deny;
    expect(met(networkPolicy, "allow", d)).toBe(true);
    expect(play(d, "policy-traffic").getState().snapshot.nodes.admin.processed).toBe(12);
    deny.props!.filter = ["WebRequest"];
    expect(met(networkPolicy, "allow", d)).toBe(false);
    d.edges = d.edges.filter((e) => e.id !== "deny-admin");
    expect(met(networkPolicy, "allow", d)).toBe(false);
  });
  it("requires the relevant readout and does not accept an old admin total as fresh work", () => {
    const d = policyPractice();
    const c = play(d, "policy-traffic");
    const subjects = resolveSubjects(networkPolicy, d);
    const v = {
      diagram: d,
      live: true,
      session: c.getState(),
      sessionId: 1,
      processed: (id: string) => c.getState().snapshot.nodes[id].processed,
    };
    expect(holds(check(networkPolicy, "observe"), v, subjects)).toBe(false);
    expect(holds(check(networkPolicy, "observe"), { ...v, readout: { kind: "node", id: "firewall" } }, subjects)).toBe(
      true,
    );
    expect(holds(check(networkPolicy, "replay"), v, subjects)).toBe(false);
    const allowed = structuredClone(d);
    delete allowed.edges.find((e) => e.id === "deny-admin")!.props!.deny;
    const replay = play(allowed, "policy-traffic");
    const count = replay.getState().snapshot.nodes.admin.processed;
    const key = baselineKey({ node: "admin", metric: "processed" });
    const reading = {
      diagram: allowed,
      live: true,
      processed: () => count,
      sessionId: 1,
      session: replay.getState(),
      mode: { ...initialEditorMode, selection: ["admin"] },
      observations: {
        dock: {
          documentId: "practice",
          identity: {},
          tab: "properties" as const,
          snap: "half" as const,
          live: true,
          presenting: false,
        },
      },
      baseline: { [key]: [count, replay.getState().generation, 1] as const },
    };
    expect(holds(check(networkPolicy, "replay"), reading, subjects)).toBe(false);
    reading.baseline[key] = [count - 5, replay.getState().generation, 1];
    expect(holds(check(networkPolicy, "replay"), reading, subjects)).toBe(true);
  });
});

it("Checks absence rejects ignored or disabled advice and completed static jobs cannot stand in for simulated evidence", () => {
  const d = checksPractice();
  const result = runChecks(d);
  const subjects = resolveSubjects(checksAndFixes, d);
  const base = { diagram: d, live: false, processed: () => 0 };
  const source = { documentId: "practice", identity: {} };
  const absent: Check = { kind: "checks", status: "done", rule: "no-reader", absent: true };
  const v = { ...base, observations: { checks: { ...source, status: "done" as const, result } } };
  expect(holds(absent, v, subjects)).toBe(false);
  const finding = result.findings.find((f) => f.rule === "no-reader")!;
  expect(
    holds(
      absent,
      {
        ...v,
        observations: { checks: { ...v.observations.checks, result: { ...result, findings: [], ignored: [finding] } } },
      },
      subjects,
    ),
  ).toBe(false);
  expect(
    holds(
      absent,
      { ...v, observations: { checks: { ...v.observations.checks, result: { ...result, findings: [], ran: [] } } } },
      subjects,
    ),
  ).toBe(false);
  expect(holds(check(checksAndFixes, "evidence"), v, subjects)).toBe(false);
  expect(
    holds(
      check(checksAndFixes, "evidence"),
      {
        ...v,
        observations: {
          checks: { ...v.observations.checks, simulations: [{ id: "small-burst", playedMs: 5000, capped: false }] },
        },
      },
      subjects,
    ),
  ).toBe(true);
  expect(
    holds(
      check(checksAndFixes, "evidence"),
      {
        ...v,
        observations: {
          checks: {
            ...v.observations.checks,
            status: "stale",
            simulations: [{ id: "small-burst", playedMs: 5000, capped: false }],
          },
        },
      },
      subjects,
    ),
  ).toBe(false);
});

it("the eight-partition comparison deliberately overrides six, while its effective check rejects a saved six", () => {
  const d = JSON.parse(readFileSync("src/examples/partitions-vs-subscriptions.json", "utf8")) as DiagramFile;
  d.nodes.find((n) => n.id === "log")!.props!.partitions = 6;
  const c = play(d, "more-partitions");
  expect(met(partitions, "rerun", d, c)).toBe(true);
  const run = d.simulations!.find((s) => s.id === "more-partitions")!;
  run.setup!.props!.log.partitions = 6;
  expect(met(partitions, "rerun", d, play(d, "more-partitions"))).toBe(false);
});

it("repairs only the route setting overridden by a saved run, preserving the traffic experiment", () => {
  const d = addressPractice();
  const run = d.simulations![0];
  run.setup = { props: { gateway: { routeTable: { rules: [] }, latencyMs: 17 } } };
  const fixed = repairedRun(d, run, { node: "gateway" }, [{ op: "set", path: ["routeTable"], value: { rules: [] } }]);
  expect(fixed.traffic).toEqual(run.traffic);
  expect(fixed.setup!.props!.gateway.latencyMs).toBe(17);
});

it("one Undo restores both the unread topic and its finding after a named consumer fix", () => {
  const before = checksPractice();
  const history = new HistoryController(toFlow(before), 0);
  const after = structuredClone(before);
  after.nodes.push({ id: "worker", stencil: "generic.service", label: checksAndFixes.title(), x: 560, y: 0 });
  after.edges.push({ id: "reader", from: "topic", to: "worker", kind: "async" });
  history.begin("new:worker");
  history.commit(toFlow(after), "new:worker", 1);
  history.end("new:worker");
  expect(runChecks(after).findings.some((f) => f.rule === "no-reader")).toBe(false);
  const restored = history.step("undo", { nodes: [], edges: [] })!;
  const d = fromFlow(restored.meta, restored.nodes, restored.edges);
  expect(d.nodes).toEqual(before.nodes);
  expect(d.edges).toEqual(before.edges);
  expect(runChecks(d).findings.some((f) => f.rule === "no-reader")).toBe(true);
});
it("revised checks reject wrong wiring, a shared group, swapped cache shares and an early compensation run", () => {
  const gateway = typeof apiGateway.start === "function" ? apiGateway.start() : checksPractice();
  expect(met(apiGateway, "watch", gateway)).toBe(false);
  const kafka = typeof kafkaTopic.start === "function" ? kafkaTopic.start() : checksPractice();
  kafka.nodes.push(
    { id: "t", stencil: "kafka.topic", label: "", x: 0, y: 0 },
    { id: "billing", stencil: "generic.service", label: "", x: 0, y: 0 },
    { id: "email", stencil: "generic.service", label: "", x: 0, y: 0 },
  );
  kafka.edges.push(
    { id: "b", from: "t", to: "billing", kind: "async", props: { group: "billing" } },
    { id: "e", from: "t", to: "email", kind: "async", props: { group: "billing" } },
  );
  expect(met(kafkaTopic, "group-email", kafka)).toBe(false);
  const cache = typeof cacheAside.start === "function" ? cacheAside.start() : checksPractice();
  cache.nodes.push({ id: "redis", stencil: "redis.cache", label: "", x: 0, y: 0 });
  cache.edges.push({ id: "cache", from: "api", to: "redis", kind: "sync", props: { share: 0.2 } });
  expect(met(cacheAside, "cache-share", cache)).toBe(false);
  expect(met(cacheAside, "database-share", cache)).toBe(false);
  const checkout = JSON.parse(readFileSync("src/examples/outbox-saga-checkout.json", "utf8")) as DiagramFile;
  const c = new LiveController(checkout);
  c.selectSimulation(checkout.simulations!.find((s) => s.id === "declines")!);
  expect(met(outbox, "watch-compensation", checkout, c)).toBe(false);
});

it("Orders evidence comes from an actual matched trace and rejects a different matched rule", () => {
  const d = addressPractice();
  repair(routeByAddress, "route", d);
  const c = new LiveController(d);
  c.selectSimulation(d.simulations![0]);
  c.traceNext("tracking");
  c.setPlaying(true);
  for (let frame = 0; frame < 1000; frame++) c.advance(10);
  c.publish();
  expect(met(routeByAddress, "watch", d, c)).toBe(true);
  const view = {
    diagram: d,
    live: true,
    processed: (id: string) => c.getState().snapshot.nodes[id]?.processed ?? 0,
    session: c.getState(),
  };
  const trace = view.session.trace!.current!;
  const sends = trace.steps.filter((step) => step.kind === "send" && step.node === "gateway");
  expect(sends.length).toBeGreaterThan(0);
  for (const sent of sends) sent.rule = "quotes";
  expect(holds(check(routeByAddress, "watch"), view, resolveSubjects(routeByAddress, d))).toBe(false);
});

it("an effective Allow check cannot accept a missing Live configuration", () => {
  const d = policyPractice();
  delete d.edges.find((e) => e.id === "deny-admin")!.props!.deny;
  const subjects = resolveSubjects(networkPolicy, d);
  const check: Check = { kind: "prop", edge: ["fw", "admin"], prop: "deny", op: "falsy", effective: true };
  expect(holds(check, { diagram: d, live: true, processed: () => 0 }, subjects)).toBe(false);
});
