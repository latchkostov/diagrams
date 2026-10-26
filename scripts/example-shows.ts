import { revisionAtLeast } from "../src/model/revisions";
import type { ApiBehaviour } from "../src/model/admission";
import type { AutoscalingConfig } from "../src/model/autoscaling";
import type { DiagramFile } from "../src/model/types";
import { catalog } from "../src/stencils/catalog";
import { stencilRole } from "../src/stencils/roles";
import { acceptsType } from "../src/sim/topology";
import { VENDOR_PARENTS } from "../src/stencils/vendorParents";

const brandedClients = new Set(
  catalog.filter((s) => s.id.startsWith("client.") && s.simRole === "source" && s.vendor !== "Client").map((s) => s.id),
);

/** A traffic spike must reach configured work without crossing a Request or dependency. */
function showsLatency(d: DiagramFile): boolean {
  const pending: string[] = [];
  for (const simulation of d.simulations ?? [])
    for (const traffic of simulation.traffic) if (traffic.shape.kind === "spike") pending.push(traffic.node);
  if (!pending.length) return false;
  const nodes = new Map(d.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  for (const edge of d.edges) {
    if (edge.kind === "sync" || (edge.relation !== undefined && edge.relation !== "flow")) continue;
    const next = outgoing.get(edge.from) ?? [];
    next.push(edge.to);
    outgoing.set(edge.from, next);
  }
  const seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const node = nodes.get(id);
    if (node && typeof node.props?.latencyMs === "number" && node.props.latencyMs >= 250) {
      const role = stencilRole(node.stencil);
      if (role === "processor" || role === "gateway" || role === "store") return true;
    }
    for (const next of outgoing.get(id) ?? []) pending.push(next);
  }
  return false;
}

/** Metadata only: never modifies the diagram, simulation or exported content. */
export function exampleShows(d: DiagramFile): string[] {
  return [
    ...(d.groups?.some((g) => typeof g.borderRadius === "number") &&
    d.annotations?.some((a) => a.kind === "zone" && typeof a.borderRadius === "number")
      ? ["roundedRegions"]
      : []),
    ...(d.nodes.some((n) => Object.hasOwn(VENDOR_PARENTS, n.stencil)) ? ["vendorStencils"] : []),
    ...(d.nodes.some((n) => brandedClients.has(n.stencil)) ? ["brandedClients"] : []),
    ...(d.edges.some(
      (edge) =>
        typeof edge.props?.emits === "string" &&
        d.edges.some(
          (next) =>
            next.from === edge.to &&
            Array.isArray(next.props?.filter) &&
            !acceptsType(next.props.filter, String(edge.props?.emits)),
        ),
    )
      ? ["messageTypes"]
      : []),
    ...(revisionAtLeast(d.planning?.revision, "p3-w1") && d.edges.some((e) => e.kind === "sync")
      ? ["requestsWait"]
      : []),
    ...(revisionAtLeast(d.planning?.revision, "p3-w2") &&
    d.edges.some(
      (e) =>
        e.kind === "sync" &&
        (Number((e.props?.caller as { retry?: { maxAttempts: number } } | undefined)?.retry?.maxAttempts) > 1 ||
          d.simulations?.some((s) => Number(s.setup?.edges?.[e.id]?.caller?.retry?.maxAttempts) > 1)),
    )
      ? ["resilience"]
      : []),
    ...(showsLatency(d) ? ["latency"] : []),
    ...(d.simulations?.some(
      (s) =>
        s.timeline?.some((step) => step.atMs <= 10000 && step.action.do === "note") &&
        s.timeline?.some((step) => step.atMs <= 10000 && step.action.do === "fault"),
    )
      ? ["runHistory"]
      : []),
    ...(d.simulations?.some((s) => s.timeline?.some((step) => step.action.do === "fault")) ? ["faultDrills"] : []),
    ...(d.nodes.some((n) => typeof n.props?.partitions === "number" && n.props.partitions > 1) ? ["partitions"] : []),
    ...(d.nodes.some(
      (n) =>
        n.stencil === "generic.rate-limiter" ||
        (n.props?.api as ApiBehaviour | undefined)?.quotas?.some((q) => q.amount > 0 && q.windowMs > 0),
    )
      ? ["rateLimits"]
      : []),
    ...(d.nodes.some((n) => /^(cisco|juniper|paloalto|arista|f5)\./.test(n.stencil)) ? ["networkDevices"] : []),
    ...(revisionAtLeast(d.planning?.revision, "p3-a1") &&
    d.nodes.some((n) => n.props?.resources && (n.props.autoscaling as AutoscalingConfig | undefined)?.mode === "on")
      ? ["autoscaling"]
      : []),
    ...(Array.isArray(d.planning?.requestRoutes) &&
    d.nodes.some((n) => n.props?.routeTable !== undefined || n.props?.trafficMix !== undefined)
      ? ["routing"]
      : []),
  ];
}
