import type { AutoscalingConfig, KedaTrigger } from "./autoscaling";
import type { DiagramNode, DiagramEdge } from "./types";
import type { DiagramFile } from "./types";

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
      e.props?.dlq === true ||
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
export function scalerGroupRemap(edges: readonly DiagramEdge[], ids: ReadonlyMap<string, string>) {
  const groups = new Map<string, Map<string, string>>();
  for (const e of edges) {
    const before =
      e.props?.groupOrigin === "inferred" ? String(e.props.group) : e.props?.group === undefined ? e.id : undefined;
    if (before === undefined) continue;
    const byName = groups.get(e.from) ?? new Map<string, string>();
    byName.set(before, ids.get(e.props?.groupOrigin === "inferred" ? e.to : e.id) ?? before);
    groups.set(e.from, byName);
  }
  return groups;
}
export function remapScaler(
  props: Record<string, unknown> | undefined,
  ids: ReadonlyMap<string, string>,
  groups: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map(),
): void {
  const a = props?.autoscaling as AutoscalingConfig | undefined;
  if (a?.mode !== "on" || a.controller.kind !== "keda") return;
  const next = structuredClone(a.controller);
  for (const t of next.triggers) {
    t.source.group = groups.get(t.source.node)?.get(t.source.group ?? "") ?? t.source.group;
    t.source.node = ids.get(t.source.node) ?? t.source.node;
  }
  props!.autoscaling = { ...a, controller: next };
}
/** Compile once per graph change. Per-candidate work is bounded by its sixteen bindings. */
export function bindingValidator(nodes: readonly Pick<DiagramNode, "id" | "stencil">[], edges: readonly DiagramEdge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const groups = new Map<string, Set<string>>();
  for (const e of edges) {
    if ((e.relation && e.relation !== "flow") || e.props?.dlq === true || e.props?.deny) continue;
    const names = groups.get(e.from) ?? new Set<string>();
    names.add(typeof e.props?.group === "string" ? e.props.group : e.id);
    groups.set(e.from, names);
  }
  return (a: AutoscalingConfig | undefined): boolean =>
    a?.mode !== "on" ||
    a.controller.kind !== "keda" ||
    a.controller.triggers.every((t) => {
      const source = byId.get(t.source.node);
      if (!source || !triggerFits(t.type, source.stencil)) return false;
      const named = t.type === "kafka" || source.stencil === "azure.service-bus.topic";
      return named
        ? !!t.source.group && !!groups.get(source.id)?.has(t.source.group)
        : t.source.group === undefined || t.source.group === "queue";
    });
}
