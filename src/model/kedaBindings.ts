import { isDlqEdge } from "./brokerRoutes";
import { stencilRole } from "../stencils/roles";
import type { AutoscalingConfig, KedaTrigger } from "./autoscaling";
import type { DiagramNode, DiagramEdge } from "./types";
import type { DiagramFile } from "./types";

/** The stencil whose routed requests ECS ALB metrics count. */
export const LOAD_BALANCER_STENCIL = "aws.elb";

/** KEDA triggers of an executable policy: a KEDA ScaledObject's or a Container Apps app's custom event rules. */
export function scalerTriggers(a: AutoscalingConfig | undefined): readonly KedaTrigger[] {
  if (a?.mode !== "on") return [];
  const c = a.controller;
  return c.kind === "keda" || c.kind === "aca" ? c.triggers : [];
}
/** Load balancer nodes that ECS ALB request metrics read. */
export function loadBalancerSources(a: AutoscalingConfig | undefined): readonly { node: string }[] {
  if (a?.mode !== "on" || a.controller.kind !== "ecs") return [];
  return [...a.controller.targetTracking, ...a.controller.stepScaling].flatMap((p) => (p.source ? [p.source] : []));
}

export function brokerChoices(d: DiagramFile | undefined, node: string, type: KedaTrigger["type"]) {
  if (!d) return [];
  const nodes = new Map(d.nodes.map((n) => [n.id, n]));
  const choices = new Map<string, { key: string; label: string; source: KedaTrigger["source"] }>();
  for (const e of d.edges) {
    const n = nodes.get(e.from);
    if (
      !n ||
      e.to !== node ||
      !triggerFits(type, n.stencil) ||
      (e.relation && e.relation !== "flow") ||
      isDlqEdge(
        e,
        stencilRole(n.stencil),
        nodes.get(e.to) ?? { label: "" },
        stencilRole(nodes.get(e.to)?.stencil ?? ""),
      ) ||
      e.props?.deny
    )
      continue;
    const group =
      type === "kafka" || n.stencil === "azure.service-bus.topic"
        ? typeof e.props?.group === "string"
          ? e.props.group
          : e.id
        : undefined;
    const key = JSON.stringify([n.id, group]);
    choices.set(key, {
      key,
      label: group ? `${n.label} · ${group}` : n.label,
      source: { node: n.id, ...(group ? { group } : {}) },
    });
  }
  return [...choices.values()];
}
/** Load balancers routing requests (sync flows) to `node`: the only valid ALB metric sources. */
export function loadBalancerChoices(d: DiagramFile | undefined, node: string) {
  if (!d) return [];
  const nodes = new Map(d.nodes.map((n) => [n.id, n]));
  const choices = new Map<string, { key: string; label: string; source: { node: string } }>();
  for (const e of d.edges) {
    const n = nodes.get(e.from);
    if (!n || e.to !== node || !requestRoute(e, n.stencil)) continue;
    choices.set(n.id, { key: n.id, label: n.label, source: { node: n.id } });
  }
  return [...choices.values()];
}
function requestRoute(e: DiagramEdge, stencil: string): boolean {
  return (
    stencil === LOAD_BALANCER_STENCIL && e.kind === "sync" && (!e.relation || e.relation === "flow") && !e.props?.deny
  );
}

export function triggerFits(t: KedaTrigger["type"], stencil: string): boolean {
  return t === "kafka"
    ? ["kafka.topic", "aws.msk", "confluent.cloud"].includes(stencil)
    : t === "aws-sqs-queue"
      ? stencil === "aws.sqs"
      : t === "rabbitmq"
        ? stencil === "rabbitmq.queue"
        : ["azure.service-bus.queue", "azure.service-bus.topic"].includes(stencil);
}
/** IDs, never labels. Used after allocation in clipboard and infrastructure mapping. */
export function scalerGroupRemap(
  edges: readonly DiagramEdge[],
  nodes: ReadonlyMap<string, string>,
  edgesById: ReadonlyMap<string, string>,
) {
  const groups = new Map<string, Map<string, string>>();
  for (const e of edges) {
    const before =
      e.props?.groupOrigin === "inferred" ? String(e.props.group) : e.props?.group === undefined ? e.id : undefined;
    if (before === undefined) continue;
    const byName = groups.get(e.from) ?? new Map<string, string>();
    byName.set(before, (e.props?.groupOrigin === "inferred" ? nodes.get(e.to) : edgesById.get(e.id)) ?? before);
    groups.set(e.from, byName);
  }
  return groups;
}
/** Remap every bound node of a policy (KEDA/ACA triggers, ECS load balancers) in one structural copy. */
export function remapScaler(
  props: Record<string, unknown> | undefined,
  ids: ReadonlyMap<string, string>,
  groups: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map(),
): void {
  const a = props?.autoscaling as AutoscalingConfig | undefined;
  if (a?.mode !== "on" || (!scalerTriggers(a).length && !loadBalancerSources(a).length)) return;
  const next = structuredClone(a);
  for (const t of scalerTriggers(next) as KedaTrigger[]) {
    t.source.group = groups.get(t.source.node)?.get(t.source.group ?? "") ?? t.source.group;
    t.source.node = ids.get(t.source.node) ?? t.source.node;
  }
  for (const s of loadBalancerSources(next) as { node: string }[]) s.node = ids.get(s.node) ?? s.node;
  props!.autoscaling = next;
}
/** Compile once per graph change. Per-candidate work is bounded by its sixteen bindings. */
export function bindingValidator(
  nodes: readonly Pick<DiagramNode, "id" | "stencil" | "label" | "sublabel">[],
  edges: readonly DiagramEdge[],
) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const groups = new Map<string, Set<string>>();
  /** `${loadBalancer}\u0000${target}` for every request route a load balancer has. */
  const routes = new Set<string>();
  const balancers = new Set<string>();
  for (const e of edges) {
    const source = byId.get(e.from),
      target = byId.get(e.to);
    if (!source || !target) continue;
    if (requestRoute(e, source.stencil)) {
      routes.add(`${e.from}\u0000${e.to}`);
      balancers.add(e.from);
    }
    if (
      (e.relation && e.relation !== "flow") ||
      e.props?.deny ||
      isDlqEdge(e, stencilRole(source.stencil), target, stencilRole(target.stencil))
    )
      continue;
    const names = groups.get(e.from) ?? new Set<string>();
    names.add(typeof e.props?.group === "string" ? e.props.group : e.id);
    groups.set(e.from, names);
  }
  /** `node` is the scaled node: ECS load balancers must route requests to it. Absent, any route suffices. */
  return (a: AutoscalingConfig | undefined, node?: string): boolean =>
    scalerTriggers(a).every((t) => {
      const source = byId.get(t.source.node);
      if (!source || !triggerFits(t.type, source.stencil)) return false;
      const named = t.type === "kafka" || source.stencil === "azure.service-bus.topic";
      return named
        ? !!t.source.group && !!groups.get(source.id)?.has(t.source.group)
        : t.source.group === undefined || t.source.group === "queue";
    }) &&
    loadBalancerSources(a).every((s) =>
      node === undefined ? balancers.has(s.node) : routes.has(`${s.node}\u0000${node}`),
    );
}
