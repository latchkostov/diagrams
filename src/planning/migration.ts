import { ADMISSION_REVISION, managedKind } from "../model/admissionPresets";
import type { DiagramFile } from "../model/types";
import { resolveProps } from "../sim/defaults";
import { stencilRole } from "../stencils/roles";
import { profileOf, FAMILIES, PROCESSOR_LESSON } from "../stencils/profiles";

/** Resolve behaviour before changing the resolver revision; retain unknown authored properties. */
function materialized(d: DiagramFile, node: DiagramFile["nodes"][number], props: Record<string, unknown>) {
  const resolved = resolveProps(stencilRole(node.stencil), node.label, props, node.stencil, d.planning);
  const { device } = resolved;
  return {
    ...props,
    ...Object.fromEntries(
      Object.entries(resolved).filter(
        ([key, v]) =>
          key !== "device" &&
          key !== "profile" &&
          key !== "broker" &&
          key !== "admission" &&
          key !== "autoscalingProblem" &&
          v !== undefined &&
          (typeof v !== "number" || Number.isFinite(v)),
      ),
    ),
    ...(device
      ? {
          gbps: device.gbps,
          messageKB: device.messageKB,
          ha: device.ha,
          failoverMs: device.failoverMs,
          size: device.size,
        }
      : {}),
  };
}

/** Pin only authored patch keys, plus defaults whose resolution changes with those keys. */
function materializedPatch(
  d: DiagramFile,
  node: DiagramFile["nodes"][number],
  context: Record<string, unknown>,
  patch: Record<string, unknown>,
) {
  const values = materialized(d, node, context);
  const keys = new Set(Object.keys(patch));
  // A device size/preset changes throughput and service time. HA changes legacy unit defaults.
  if ("size" in patch || "preset" in patch || "presetRevision" in patch) {
    for (const key of ["gbps", "latencyMs"]) if (!(key in context)) keys.add(key);
  }
  if ("ha" in patch && !("replicas" in context)) keys.add("replicas");
  return Object.fromEntries(
    [...keys].filter((key) => key in values).map((key) => [key, values[key as keyof typeof values]]),
  );
}

/** Node, setup and cumulative timeline contexts all resolve against the original document. */
function normalizePersistence(d: DiagramFile): DiagramFile {
  const next = structuredClone(d);
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  next.nodes = d.nodes.map((n) => ({ ...structuredClone(n), props: materialized(d, n, n.props ?? {}) }));
  for (const sim of next.simulations ?? []) {
    const contexts = new Map(d.nodes.map((n) => [n.id, { ...n.props, ...sim.setup?.props?.[n.id] }]));
    for (const [id, props] of Object.entries(sim.setup?.props ?? {})) {
      const node = byId.get(id);
      if (node) sim.setup!.props![id] = materializedPatch(d, node, { ...node.props, ...props }, props);
    }
    for (const step of [...(sim.timeline ?? [])].sort((a, b) => a.atMs - b.atMs)) {
      if (step.action.do !== "props") continue;
      const { node: id, props } = step.action;
      const node = byId.get(id);
      if (!node) continue;
      const context = { ...contexts.get(id), ...props };
      contexts.set(id, context);
      step.action.props = materializedPatch(d, node, context, props);
    }
  }
  return next;
}

/** Explicit opt-in preserves effective values in free play and every saved simulation context. */
export function upgradePlanning(d: DiagramFile): DiagramFile {
  if (d.planning?.revision === "p3") return structuredClone(d);
  const next = normalizePersistence(d);
  next.format = "diagrams/v2";
  next.planning = { ...d.planning, revision: "p3" };
  for (const node of next.nodes) {
    const family = profileOf(node.stencil)?.family;
    if (family && FAMILIES[family]?.roles.includes("processor"))
      Object.assign(node.props!, { preset: PROCESSOR_LESSON.id, presetRevision: PROCESSOR_LESSON.revision });
    if (managedKind(node.stencil))
      Object.assign(node.props!, { preset: "managed-measured", presetRevision: ADMISSION_REVISION });
    if (resolveProps(stencilRole(node.stencil), node.label, node.props!, node.stencil, undefined).device)
      Object.assign(node.props!, { preset: "device-size", presetRevision: "1" });
  }
  return next;
}

/** Explicit A1 upgrade materializes every saved patch without adding workload costs. */
export function upgradeAutoscaling(d: DiagramFile): DiagramFile {
  const next =
    d.planning?.revision === "p3-a1" || d.planning?.revision === "p3" ? normalizePersistence(d) : upgradePlanning(d);
  next.format = "diagrams/v2";
  next.planning = { ...next.planning, revision: "p3-a1" };
  return next;
}

/** The same traversal strips metadata and records losses, including saved setup and timeline props. */
export function legacyExport(d: DiagramFile): { diagram: DiagramFile; losses: string[] } {
  const diagram = normalizePersistence(d);
  const losses: string[] = [];
  if (diagram.planning) losses.push("planning.revision");
  delete diagram.planning;
  diagram.format = "diagrams/v1";
  const strip = (props: Record<string, unknown> | undefined, path: string) => {
    for (const key of [
      "resources",
      "autoscaling",
      "resumeAutoscaling",
      "preset",
      "presetRevision",
      "connections",
      "querySlots",
      "api",
      "endpoints",
      "scaling",
      "maxConcurrency",
    ])
      if (props && key in props) {
        losses.push(`${path}.${key}`);
        Reflect.deleteProperty(props, key);
      }
  };
  for (const node of diagram.nodes) strip(node.props, `${node.id}.props`);
  for (const sim of diagram.simulations ?? []) {
    for (const [id, props] of Object.entries(sim.setup?.props ?? {})) strip(props, `${sim.id}.setup.props.${id}`);
    for (const [i, step] of (sim.timeline ?? []).entries())
      if (step.action.do === "props") strip(step.action.props, `${sim.id}.timeline.${i}.props`);
  }
  for (const edge of diagram.edges) {
    for (const key of ["endpointId", "caller"])
      if (edge.props && key in edge.props) {
        losses.push(`${edge.id}.props.${key}`);
        Reflect.deleteProperty(edge.props, key);
      }
    if (edge.props && "networkDelayMs" in edge.props) {
      losses.push(`${edge.id}.props.networkDelayMs`);
      delete edge.props.networkDelayMs;
    }
  }
  return { diagram, losses };
}
