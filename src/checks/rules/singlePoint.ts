import { redundancyFix } from "../../sim/capacityPlanning";
import { listNames, type CheckContext } from "../context";
import { dominators } from "../graph";
import { isDevice, isSelfHostedGateway, isSelfHostedService } from "../kinds";
import type { CheckRule, Finding } from "../types";

// 8. single-point: a service or gateway you run with one replica that every request from an entry point goes
// through: when it stops, that entry gets nothing. "Every request goes through" is graph dominance over requests
// (sync flows) from the entry: the node dominates every end of the entry's request paths (Cooper-Harvey-Kennedy
// dominators per entry, near-linear). Managed gateways, serverless and PaaS compute, and async consumers (a
// broker buffers for them) don't fire.
//
// Evidence, as the precision gate asked: an unset replica count isn't one (most diagrams don't model replicas,
// and the default is 1). A Suggestion when the diagram says one replica (`replicas: 1`); a Warning when capacity
// also puts the node at 80% or more at the diagram's own rates, whatever its replicas say.

/** Utilization from which a single replica on the only path is a Warning. */
export const SINGLE_POINT_BUSY = 0.8;
/** Work bound for the per-entry searches (nodes and edges visited): a diagram past it checks the entries so far. */
const MAX_WORK = 250_000;

/** For each node, the entries whose every request path it dominates (the entry itself aside). */
export function onlyWayThrough(ctx: CheckContext): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const targets = new Map<string, string[]>();
  const next = (id: string) => {
    let list = targets.get(id);
    if (!list) targets.set(id, (list = [...new Set(ctx.requests(id).map((e) => e.to))]));
    return list;
  };
  // Entries with the same first hops have the same answer: work it out once.
  const done = new Map<string, string[]>();
  let work = 0;
  for (const entry of ctx.diagram.nodes) {
    if (ctx.role(entry.id) !== "source") continue;
    const first = next(entry.id).filter((id) => id !== entry.id);
    if (!first.length) continue;
    const key = [...first].sort().join("\u0000");
    let through = done.get(key);
    if (!through) {
      if (work > MAX_WORK) break;
      through = [];
      const { order, idom, targets: reached } = dominators(entry.id, next);
      for (const id of order) work += 1 + reached.get(id)!.length;
      // The ends (nodes with no request onward) under each node of the dominator tree, counted children first
      // (reverse postorder lists a node's dominators before it). A node over all of them is the only way through.
      const count = (isEnd: (id: string) => boolean) => {
        const ends = new Map<string, number>();
        let total = 0;
        for (let i = order.length - 1; i > 0; i--) {
          const id = order[i];
          const own = isEnd(id) ? 1 : 0;
          total += own;
          const sum = (ends.get(id) ?? 0) + own;
          ends.set(id, sum);
          const parent = idom.get(id)!;
          ends.set(parent, (ends.get(parent) ?? 0) + sum);
        }
        return { ends, total };
      };
      let tally = count((id) => reached.get(id)!.every((to) => to === id));
      // No end (requests that only go round): every node reached counts as one.
      if (!tally.total) tally = count(() => true);
      for (const id of order.slice(1)) if (tally.ends.get(id) === tally.total) through.push(id);
      done.set(key, through);
    }
    for (const id of through) {
      const list = out.get(id);
      if (list) list.push(entry.id);
      else out.set(id, [entry.id]);
    }
  }
  return out;
}

export const singlePoint: CheckRule = {
  id: "single-point",
  name: "Every request goes through one replica",
  about:
    "A service or gateway with one replica that an entry point's every request goes through stops that entry when it stops. " +
    `Fires when the diagram says it runs one replica, and as a warning when it's also ${Math.round(SINGLE_POINT_BUSY * 100)}% busy or more at the diagram's own rates; managed gateways, serverless and async consumers don't count.`,
  detect(ctx) {
    const through = onlyWayThrough(ctx);
    if (!through.size) return [];
    const findings: Finding[] = [];
    for (const node of ctx.diagram.nodes) {
      const entries = through.get(node.id);
      if (!entries) continue;
      const role = ctx.role(node.id);
      const runs =
        (role === "processor" && isSelfHostedService(node.stencil)) ||
        (role === "gateway" && isSelfHostedGateway(node.stencil));
      const replicas = node.props?.replicas;
      // A network device in an HA pair or cluster has two units unless it says otherwise.
      const device = isDevice(node.stencil);
      const ha = device && (node.props?.ha === "active-standby" || node.props?.ha === "active-active");
      const said =
        (typeof replicas === "number" && Number.isFinite(replicas)) || (device && node.props?.ha === "standalone");
      if (!runs || (typeof replicas === "number" && replicas > 1) || (ha && replicas === undefined)) continue;
      // Only a settled analysis is evidence: a feedback loop's numbers are estimates (sync-cycle reports the loop).
      const analysis = ctx.capacity();
      const load = analysis.nodes[node.id];
      const busy =
        analysis.converged && !!load && Number.isFinite(load.utilization) && load.utilization >= SINGLE_POINT_BUSY;
      if (!said && !busy) continue;
      const name = ctx.name(node.id);
      const who = listNames(entries.map(ctx.name));
      if (device) {
        // A box, not a replica: the fix is a second unit as an active-standby pair, which keeps its capacity.
        findings.push({
          id: `single-point:${node.id}`,
          rule: "single-point",
          severity: busy ? "warning" : "suggestion",
          target: node.id,
          elements: [node.id, ...entries],
          title: `Every request goes through one ${name}`,
          message: busy
            ? `It's a single unit at ${Math.round(load.utilization * 100)}% of its throughput, and every request from ${who} goes through it: if it fails, ${who} get${entries.length === 1 ? "s" : ""} nothing. A standby unit keeps traffic flowing; more throughput needs a bigger size.`
            : `It's a single unit, and every request from ${who} goes through it: if it fails, ${who} get${entries.length === 1 ? "s" : ""} nothing.`,
          rationale:
            "Network devices fail like any other box: a power supply, a crash, an upgrade. An active-standby pair keeps the path up while one unit is out.",
          fix: {
            label: "Make it an HA pair",
            ops: [{ op: "update", target: node.id, props: { ha: "active-standby", replicas: 2 } }],
          },
        });
        continue;
      }
      // Two replicas, or as many as capacity planning sizes it to when it's busy, within the op schema's bound. A
      // device's fix is a pair whatever its load (above), so it never pays for this sizing.
      const { replicas: to, enough } = busy
        ? redundancyFix(ctx.diagram, ctx.planning(), load)
        : { replicas: 2, enough: true };
      findings.push({
        id: `single-point:${node.id}`,
        rule: "single-point",
        severity: busy ? "warning" : "suggestion",
        target: node.id,
        elements: [node.id, ...entries],
        title: `Every request goes through one ${name}`,
        message: busy
          ? `It runs 1 replica at ${Math.round(load.utilization * 100)}% of what it can handle, and every request from ${who} goes through it: if it stops or slows, ${who} get${entries.length === 1 ? "s" : ""} nothing.${enough ? "" : " More replicas alone can't bring it under its limit: it needs faster processing or more concurrency too."}`
          : `It runs 1 replica, and every request from ${who} goes through it: if it stops, ${who} get${entries.length === 1 ? "s" : ""} nothing.`,
        rationale:
          "Redundancy is what turns one instance's availability into a service's: with two replicas, one can stop (a deploy, a crash, a node drained) while the other answers.",
        fix: {
          label: `Set replicas to ${to}`,
          ops: [{ op: "update", target: node.id, props: { replicas: to } }],
        },
      });
    }
    return findings;
  },
};
