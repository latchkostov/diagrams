import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import type { HttpMethod, RequestRoute, RouteMatch, RouteTable, TrafficMix } from "../model/requestRouting";
import type { NodeSimProps, NodeStatus } from "./types";
import { createEngine } from "./engine";
import { mulberry32 } from "./rng";
import { validateDiagram } from "../interop/native";
import { chooseAction, compileRoutes, compileTable, matchesRequest, compileFilter } from "./routeMatching";
import { acceptsType } from "./topology";

/**
 * Request routing R1's seeded invariant fuzzer (docs/QUALITY.md): random routes, mixes and ordered tables with
 * overlapping matches, no-match handling, filters that exclude a rule's targets, quotas, outages and edits mid-run.
 * After every action it checks that:
 * - every message a source sends carries one route, and the routes' counts add up to what the source sent;
 * - a router sends each request only where the first matching rule (or Default) allows, never falling through,
 *   and refuses with the right reason otherwise;
 * - a router's refusals add up the same by reason and by route, and never count as dropped, failed or blocked;
 * - the run is deterministic: the same seed and actions give the same result, also after a checkpoint replay;
 * - once traffic stops and everything is up, the system drains to empty (refusals release their work).
 * Replay one: R1_FUZZ_SEED=12 pnpm exec vitest run src/sim/routing.invariants.test.ts. A1_FUZZ_NIGHTLY=1 runs 5,000.
 */

type Action = { ms: number } & (
  | { do: "burst"; count: number; route?: string }
  | { do: "status"; node: string; status: NodeStatus }
  | { do: "props"; node: string; props: NodeSimProps }
  | { do: "traffic"; on: boolean }
);

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "DELETE"];
const PATHS = ["/orders", "/orders/42", "/orders/7/items", "/search", "/search/books", "/api", "/apian", "/"];
const HOSTS = ["api.example.com", "Shop.Example.com"];
const TARGETS = ["kong-a", "kong-b", "kong-c"];

function generate(seed: number) {
  const random = mulberry32(seed);
  const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)];
  const routes: RequestRoute[] = Array.from({ length: 1 + Math.floor(random() * 5) }, (_, i) => ({
    id: `r${i}`,
    address: {
      method: pick(METHODS),
      path: pick(PATHS),
      ...(random() < 0.4 ? { host: pick(HOSTS) } : {}),
      ...(random() < 0.3 ? { headers: { "X-Tenant": pick(["blue", "green"]) } } : {}),
      ...(random() < 0.2 ? { query: { v: pick(["1", "2"]) } } : {}),
    },
  }));
  const match = (): RouteMatch => {
    const m: RouteMatch = {};
    if (random() < 0.5)
      m.methods = [pick(METHODS), ...(random() < 0.3 ? [pick(METHODS)] : [])].filter((v, i, a) => a.indexOf(v) === i);
    if (random() < 0.7) {
      const kind = pick(["exact", "prefix", "template"] as const);
      m.path = {
        kind,
        value: kind === "template" ? pick(["/orders/{id}", "/orders/{id}/items", "/{area}"]) : pick(PATHS),
      };
    }
    if (random() < 0.2) m.hosts = [pick(HOSTS).toLowerCase()];
    if (random() < 0.15) m.headers = { "x-tenant": pick(["blue", "green"]) };
    if (random() < 0.1) m.query = { v: pick(["1", "2"]) };
    if (!m.methods && !m.path && !m.hosts && !m.headers && !m.query) m.methods = [pick(METHODS)];
    return m;
  };
  const targets = () => {
    const chosen = TARGETS.filter(() => random() < 0.6);
    const list = (chosen.length ? chosen : [pick(TARGETS)]).map((edgeId) => ({
      edgeId,
      weight: pick([0, 1, 3, 9, 90]),
    }));
    if (!list.some((t) => t.weight > 0)) list[0].weight = 1;
    return list;
  };
  const quota = () =>
    random() < 0.25
      ? {
          quotas: [
            {
              id: "q",
              unit: "requests" as const,
              amount: pick([2, 10, 50]),
              windowMs: 1000,
              algorithm: "token-bucket" as const,
            },
          ],
        }
      : {};
  const table = (): RouteTable => ({
    rules: Array.from({ length: Math.floor(random() * 6) }, (_, i) => ({
      id: `rule${i}`,
      match: match(),
      targets: targets(),
      ...quota(),
    })),
    ...(random() < 0.5 ? { default: { targets: targets(), ...quota() } } : {}),
  });
  const mix = (): TrafficMix => {
    const ids = routes.map((r) => r.id).filter(() => random() < 0.8);
    const used = ids.length ? ids : [routes[0].id];
    if (random() < 0.5) {
      const parts = used.map(() => pick([0, 1, 2, 5]));
      if (!parts.some((p) => p > 0)) parts[0] = 1;
      const sum = parts.reduce((a, b) => a + b, 0);
      const shares = parts.map((p) => p / sum);
      // Exact sum: the last row takes the rounding.
      shares[shares.length - 1] = 1 - shares.slice(0, -1).reduce((a, b) => a + b, 0);
      return { mode: "shares", entries: used.map((routeId, i) => ({ routeId, share: shares[i] })) };
    }
    const rates = used.map(() => pick([0, 0.5, 3, 20]));
    if (!rates.some((r) => r > 0)) rates[0] = 1;
    return { mode: "rates", entries: used.map((routeId, i) => ({ routeId, ratePerSec: rates[i] })) };
  };
  const service = (id: string) => ({
    id,
    stencil: "generic.service",
    label: id,
    x: 400,
    y: 0,
    props: {
      latencyMs: pick([0, 10, 80]),
      concurrency: pick([1, 8]),
      jitter: pick([0, 0.2]),
      failureRate: pick([0, 0.2]),
    },
  });
  const d: DiagramFile = {
    format: "diagrams/v2",
    planning: { revision: "p3-a1", requestRoutes: routes },
    title: "Routing fuzz",
    nodes: [
      {
        id: "app",
        stencil: pick(["client.mobile", "generic.webhook"]),
        label: "App",
        x: 0,
        y: 0,
        props: { ratePerSec: pick([0, 5, 30]), trafficMix: mix() },
      },
      {
        id: "kong",
        stencil: pick(["kong", "nginx", "envoy"]),
        label: "Router",
        x: 200,
        y: 0,
        props: { latencyMs: pick([0, 10]), jitter: 0, routeTable: table() },
      },
      service("a"),
      service("b"),
      service("c"),
    ],
    edges: [
      { id: "app-kong", from: "app", to: "kong", kind: "sync", props: { travelMs: pick([10, 50]) } },
      ...TARGETS.map((id) => ({
        id,
        from: "kong",
        to: id.slice(5),
        kind: pick(["sync", "async"] as const),
        props: {
          travelMs: pick([10, 100]),
          ...(random() < 0.2 ? { filter: [pick(["Order*", "Nothing"])] } : {}),
          ...(random() < 0.15 ? { requestFilter: match() } : {}),
          ...(random() < 0.05 ? { deny: true } : {}),
        },
      })),
    ],
  };
  const actions: Action[] = [];
  for (let i = 0; i < 40; i++) {
    const ms = pick([10, 30, 100, 300]);
    switch (pick([0, 1, 2, 3, 4, 5, 6, 7])) {
      case 0:
      case 1:
        actions.push({
          do: "burst",
          count: pick([1, 3, 10]),
          ...(random() < 0.3 ? { route: pick(routes).id } : {}),
          ms,
        });
        break;
      case 2:
        actions.push({
          do: "status",
          node: pick(["a", "b", "c", "kong"]),
          status: pick(["up", "up", "paused", "down"] as const),
          ms,
        });
        break;
      case 3:
        actions.push({ do: "props", node: "kong", props: { routeTable: table() }, ms });
        break;
      case 4:
        actions.push({ do: "props", node: "app", props: { trafficMix: mix() }, ms });
        break;
      case 5:
        actions.push({ do: "props", node: "app", props: { ratePerSec: pick([0, 5, 30]) }, ms });
        break;
      default:
        actions.push({ do: "traffic", on: random() < 0.6, ms });
    }
  }
  return { d, actions };
}

interface Outcome {
  final: string;
  problems: string[];
}

function play(d: DiagramFile, actions: Action[], seed: number, checkpointAt?: number): Outcome {
  const problems: string[] = [];
  const e = createEngine({ seed, traceHistory: 1000, maxParticles: 100_000 });
  e.load(d);
  const routes = compileRoutes(d.planning)!;
  const kong = d.nodes.find((n) => n.id === "kong")!;
  const edges = new Map(d.edges.map((x) => [x.id, x]));
  // The table in force at each moment: a decision at time t uses the latest patch made before t.
  const tables: { at: number; table: ReturnType<typeof compileTable> }[] = [
    { at: -1, table: compileTable(kong.props!.routeTable) },
  ];
  const checked = new Set<number>();
  const check = () => {
    const snap = e.snapshot();
    const node = snap.nodes.kong;
    const byReason = Object.values(node.rejectionReasons ?? {}).reduce((a, b) => a + b, 0);
    const byRoute = Object.values(node.routeRejections ?? {}).reduce((a, b) => a + b, 0);
    if ((node.rejected ?? 0) !== byReason || (node.rejected ?? 0) !== byRoute)
      problems.push(`t=${snap.time}: rejected ${node.rejected} != by reason ${byReason} / by route ${byRoute}`);
    const counts = snap.routes ?? {};
    const sent = Object.values(counts).reduce((a, c) => a + c.sent, 0);
    const app = snap.nodes.app;
    if (sent !== app.processed + app.backlog)
      problems.push(`t=${snap.time}: routes sent ${sent} != the source's ${app.processed} + ${app.backlog} waiting`);
    for (const [id, c] of Object.entries(counts))
      if (c.completed + c.rejected > c.sent) problems.push(`t=${snap.time}: route ${id} finished more than it sent`);
    if (snap.inSystem < 0) problems.push(`t=${snap.time}: inSystem ${snap.inSystem}`);
    for (const summary of e.tracer.recent()) {
      if (checked.has(summary.rootId) || !summary.done) continue;
      checked.add(summary.rootId);
      const trace = e.tracer.get(summary.rootId)!;
      // A router decides on arrival (a paused router forwards later what it decided then).
      const arrivedAt = new Map<number, number>();
      for (const step of trace.steps) {
        if (step.kind === "arrive" && step.node === "kong") arrivedAt.set(step.id, step.t);
        if (
          step.node !== "kong" ||
          !(step.kind === "reject" || (step.kind === "send" && step.via === "message") || step.kind === "block")
        )
          continue;
        const decided = arrivedAt.get(step.id) ?? step.t;
        const table = [...tables].reverse().find((x) => x.at < decided)!.table;
        if (!table) continue;
        const route = step.route === undefined ? undefined : routes.get(step.route);
        const choice = chooseAction(table, route, true);
        if (step.kind === "reject") {
          if (step.reason === "route-not-found" && !("reject" in choice))
            problems.push(`t=${step.t}: ${step.route} refused as not found, but ${JSON.stringify(choice)}`);
          if (step.reason === "route-no-eligible-target" && (!("action" in choice) || choice.rule !== step.rule))
            problems.push(
              `t=${step.t}: ${step.route} refused for rule ${step.rule}, expected ${JSON.stringify(choice)}`,
            );
          // A no-eligible-target refusal is justified only when every positive-weight target fails its filters.
          if (step.reason === "route-no-eligible-target" && "action" in choice) {
            const eligible = choice.action.targets.filter((target) => {
              const edge = edges.get(target.edgeId);
              const filter = compileFilter(edge?.props?.requestFilter);
              return (
                target.weight > 0 &&
                acceptsType(edge?.props?.filter, step.type) &&
                (filter === undefined || matchesRequest(filter, route))
              );
            });
            if (eligible.length)
              problems.push(
                `t=${step.t}: ${step.route} refused with eligible targets ${eligible.map((x) => x.edgeId)}`,
              );
          }
          continue;
        }
        if (!("action" in choice)) {
          if (!("legacy" in choice)) problems.push(`t=${step.t}: ${step.route} sent although nothing matches`);
          continue;
        }
        if (step.rule !== choice.rule)
          problems.push(`t=${step.t}: ${step.route} used rule ${step.rule}, not ${choice.rule}`);
        const target = choice.action.targets.find((x) => x.edgeId === step.edge);
        const edge = edges.get(step.edge!);
        const filter = compileFilter(edge?.props?.requestFilter);
        if (
          !target ||
          !(target.weight > 0) ||
          !acceptsType(edge?.props?.filter, step.type) ||
          (filter !== undefined && !matchesRequest(filter, route))
        )
          problems.push(
            `t=${step.t}: ${step.route} sent on ${step.edge}, not an eligible target of ${choice.rule || "Default"}`,
          );
      }
    }
  };
  let cp: ReturnType<typeof e.checkpoint> | undefined;
  actions.forEach((action, i) => {
    if (i === checkpointAt) cp = e.checkpoint();
    if (action.do === "burst") e.inject("app", action.count, action.route ? { routeId: action.route } : {});
    else if (action.do === "status") e.setNodeStatus(action.node, action.status);
    else if (action.do === "traffic") e.setTraffic(action.on);
    else {
      e.setNodeProps(action.node, action.props);
      if (action.node === "kong" && action.props.routeTable)
        tables.push({ at: e.metrics().time, table: compileTable(action.props.routeTable) });
    }
    for (let t = 0; t < action.ms; t += 10) e.step(10);
    check();
  });
  // Drain: traffic off, everything up; refused and finished work releases its lineage.
  e.setTraffic(false);
  for (const id of ["app", "kong", "a", "b", "c"]) e.setNodeStatus(id, "up");
  for (let t = 0; t < 20_000 && e.metrics().inSystem > 0; t += 100) e.step(100);
  check();
  if (e.metrics().inSystem !== 0) problems.push(`drained run still holds ${e.metrics().inSystem} messages`);
  void routes;
  const snap = e.snapshot();
  return { final: JSON.stringify([snap.routes, snap.nodes, snap.edges]), problems: cp ? [...problems] : problems };
}

const nightly = !!(process.env.A1_FUZZ_NIGHTLY || process.env.R1_FUZZ_NIGHTLY);
const only = process.env.R1_FUZZ_SEED;
const SEEDS = only ? [Number(only)] : Array.from({ length: nightly ? 5000 : 200 }, (_, i) => i + 1);

describe("request routing invariants (seeded)", () => {
  it(`hold across ${SEEDS.length} generated runs`, { timeout: nightly ? 3_600_000 : 120_000 }, () => {
    for (const seed of SEEDS) {
      const { d, actions } = generate(seed);
      const valid = validateDiagram(d);
      if (!valid.ok) throw new Error(`seed ${seed}: generated an invalid diagram: ${valid.error}`);
      const first = play(d, actions, seed);
      if (first.problems.length)
        throw new Error(
          `seed ${seed}: ${first.problems.slice(0, 5).join("; ")}\n${JSON.stringify({ diagram: d, actions })}`,
        );
      // Same seed, same actions: the same run.
      const again = play(d, actions, seed);
      expect(again.final, `seed ${seed}: not deterministic`).toBe(first.final);
    }
  });

  it("replays identically from a checkpoint taken mid-run", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const { d, actions } = generate(seed);
      const e = createEngine({ seed, traceHistory: 0 });
      e.load(d);
      const half = Math.floor(actions.length / 2);
      let cp: ReturnType<typeof e.checkpoint> | undefined;
      const apply = (from: number) =>
        actions.slice(from).forEach((action, j) => {
          if (from + j === half) cp ??= e.checkpoint();
          if (action.do === "burst") e.inject("app", action.count, action.route ? { routeId: action.route } : {});
          else if (action.do === "status") e.setNodeStatus(action.node, action.status);
          else if (action.do === "traffic") e.setTraffic(action.on);
          else e.setNodeProps(action.node, action.props);
          e.step(action.ms);
        });
      apply(0);
      const end = JSON.stringify([e.frame().routes, e.snapshot().nodes]);
      e.restore(cp!);
      apply(half);
      expect(JSON.stringify([e.frame().routes, e.snapshot().nodes]), `seed ${seed}`).toBe(end);
    }
  });
});
