import type { CompiledEdge } from "../../sim/topology";
import { edgeName, type CheckContext } from "../context";
import { stronglyConnected } from "../graph";
import type { CheckRule, Finding } from "../types";

// 4. sync-chain: a request that waits on a request that waits on another, service to service. Each synchronous
// hop multiplies availability (all of them must be up) and adds its latency. Only requests between processors
// count: browser → gateway → API → database is normal. The longest path is worked out on the condensation of
// the request graph (a loop counts as one stop; sync-cycle reports loops), so it's linear and never explores
// paths one by one. One finding per chain start, and one per last hop: the fix makes that hop a message.

/** Hops (requests between services) from which a chain is a finding: five services in a row. */
export const SYNC_CHAIN_MIN = 4;

/**
 * The longest request chain from each start, one per last hop (when starts share a last hop, the longest chain
 * keeps it, then reading order), as edges, longest first. Each component's last hop is known before any path is
 * built, so only the winners' paths are: starts feeding one long shared tail cost one path, not one each.
 */
function chains(ctx: CheckContext): { start: string; edges: CompiledEdge[] }[] {
  const services = ctx.diagram.nodes.filter((n) => ctx.role(n.id) === "processor").map((n) => n.id);
  const between = new Map(
    services.map((id) => [id, ctx.requests(id).filter((e) => e.to !== e.from && ctx.role(e.to) === "processor")]),
  );
  const targets = new Map([...between].map(([id, edges]) => [id, edges.map((e) => e.to)]));
  const none: readonly string[] = [];
  // Tarjan lists a component after every component it reaches: one pass in that order sees each target first.
  const components = stronglyConnected(services, (id) => targets.get(id) ?? none);
  const componentOf = new Map<string, number>();
  components.forEach((members, i) => members.forEach((id) => componentOf.set(id, i)));
  const depth = new Array<number>(components.length).fill(0);
  const via = new Array<CompiledEdge | undefined>(components.length);
  /** The last hop of each component's longest chain. */
  const last = new Array<CompiledEdge | undefined>(components.length);
  const entered = new Array<boolean>(components.length).fill(false);
  const edgeOrder = new Map(ctx.diagram.edges.map((e, i) => [e.id, i]));
  components.forEach((members, c) => {
    const out = members
      .flatMap((id) => between.get(id)!)
      .filter((e) => componentOf.get(e.to) !== c)
      .sort((a, b) => edgeOrder.get(a.id)! - edgeOrder.get(b.id)!);
    for (const e of out) {
      const d = componentOf.get(e.to)!;
      entered[d] = true;
      if (depth[d] + 1 > depth[c]) {
        depth[c] = depth[d] + 1;
        via[c] = e;
        last[c] = last[d] ?? e;
      }
    }
  });
  // The winning start for each last hop, before any path is built.
  const winners = new Map<string, number>();
  components.forEach((_, c) => {
    if (entered[c] || depth[c] < SYNC_CHAIN_MIN) return;
    const hop = last[c]!.id;
    const held = winners.get(hop);
    if (
      held === undefined ||
      depth[c] > depth[held] ||
      (depth[c] === depth[held] && ctx.rank(via[c]!.from) < ctx.rank(via[held]!.from))
    )
      winners.set(hop, c);
  });
  return [...winners.values()]
    .sort((a, b) => depth[b] - depth[a] || ctx.rank(via[a]!.from) - ctx.rank(via[b]!.from))
    .map((c) => {
      const edges: CompiledEdge[] = [];
      for (let at: number | undefined = c; at !== undefined && via[at];) {
        const e: CompiledEdge = via[at]!;
        edges.push(e);
        at = componentOf.get(e.to);
      }
      return { start: edges[0].from, edges };
    });
}

/** The services a chain passes through, in order (a loop it passes through shows where it enters and leaves). */
function stops(edges: readonly CompiledEdge[]): string[] {
  const out = [edges[0].from];
  for (const e of edges) {
    if (out[out.length - 1] !== e.from) out.push(e.from);
    out.push(e.to);
  }
  return out;
}

export const syncChain: CheckRule = {
  id: "sync-chain",
  name: "Requests chained too deep",
  about:
    "Every service a request waits on must be up for it to succeed, and their latencies add up: three services at 99.99% give 99.97% at best. " +
    `Fires when requests go from service to service ${SYNC_CHAIN_MIN} or more times in a row; calls from clients and gateways, and into stores, don't count.`,
  detect(ctx) {
    const findings: Finding[] = [];
    for (const { start, edges } of chains(ctx)) {
      const last = edges[edges.length - 1];
      const path = stops(edges);
      const hops = edges.length;
      const head = ctx.name(start);
      const tail = ctx.name(last.to);
      findings.push({
        id: `sync-chain:${start}`,
        rule: "sync-chain",
        severity: "warning",
        target: start,
        elements: [...new Set(path), ...edges.map((e) => e.id)],
        title: `${hops} requests deep`,
        message: `${path.map(ctx.name).join(" → ")}: each waits for the next, so all ${new Set(path).size} must be up, and their latencies add up. Making the last call a message means ${head} no longer waits for ${tail}.`,
        rationale:
          "Each synchronous hop multiplies availability and adds latency: a request succeeds only when every service it waits on does. Turning a call into a message lets the caller finish without waiting.",
        fix: {
          label: `Make ${edgeName(ctx, last)} a message`,
          ops: [{ op: "update", target: last.id, kind: "async" }],
        },
      });
    }
    return findings;
  },
};
