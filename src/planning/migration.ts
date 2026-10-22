import { ADMISSION_REVISION, managedKind } from "../model/admissionPresets";
import type { DiagramFile } from "../model/types";
import { resolveProps } from "../sim/defaults";
import { stencilRole } from "../stencils/roles";
import { profileOf, FAMILIES, PROCESSOR_LESSON } from "../stencils/profiles";
import { revisionAtLeast } from "../model/revisions";
import type { EdgeSimProps } from "../sim/types";
import { simulationEdges } from "../sim/simulationEdges";
import { activeCall, compileTopology } from "../sim/topology";

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

/** W1 inherits pinned A1 behavior and opts every saved run into logical, blocking calls. */
export function upgradeWaits(d: DiagramFile): DiagramFile {
  if (revisionAtLeast(d.planning?.revision, "p3-w1")) return structuredClone(d);
  const next = upgradeAutoscaling(d);
  next.planning = { ...next.planning!, revision: "p3-w1" };
  return next;
}

/** W2 is an explicit, undoable opt-in. The alternative preserves every saved field. */
export function upgradeResilience(d: DiagramFile, keepOff = false): DiagramFile {
  const next = upgradeWaits(d);
  next.planning = { ...next.planning!, revision: "p3-w2" };
  if (keepOff) {
    const disable = (caller?: EdgeSimProps["caller"]) => {
      if (caller?.retry) caller.retry.maxAttempts = 1;
    };
    for (const e of next.edges) disable(e.props?.caller as EdgeSimProps["caller"]);
    for (const simulation of next.simulations ?? [])
      for (const edge of Object.values(simulation.setup?.edges ?? {})) disable(edge.caller);
  }
  return next;
}

/** Preview every context that will start executing a saved retry policy. */
export function resilienceUpgradeCalls(d: DiagramFile) {
  const enabled = { ...d, planning: { ...d.planning, revision: "p3-w2" as const } };
  const names = new Map(d.nodes.map((n) => [n.id, n.label]));
  const roles = new Map(d.nodes.map((n) => [n.id, stencilRole(n.stencil)]));
  const eligible = new Set(
    compileTopology(d)
      .edges.filter((e) => activeCall(roles.get(e.from)!, e))
      .map((e) => e.id),
  );
  return [
    { diagram: d, simulation: undefined as string | undefined },
    ...(d.simulations ?? []).map((s) => ({ diagram: simulationEdges(enabled, s), simulation: s.title })),
  ].flatMap(({ diagram, simulation }) =>
    diagram.edges.flatMap((e) => {
      const retry = (e.props?.caller as EdgeSimProps["caller"])?.retry;
      return eligible.has(e.id) && retry && retry.maxAttempts > 1
        ? [
            {
              edge: e.id,
              from: names.get(e.from) ?? e.from,
              to: names.get(e.to) ?? e.to,
              attempts: Math.min(retry.maxAttempts, 10),
              simulation,
            },
          ]
        : [];
    }),
  );
}

/** The same traversal strips metadata and records losses, including saved setup and timeline props. */
export function legacyExport(d: DiagramFile): { diagram: DiagramFile; losses: string[] } {
  const diagram = normalizePersistence(d);
  const losses: string[] = [];
  if (revisionAtLeast(d.planning?.revision, "p3-w1")) losses.push("requests hold caller threads");
  if (revisionAtLeast(d.planning?.revision, "p3-w2"))
    losses.push("retries, circuit breakers and queue limits stop running");
  if (diagram.planning) losses.push("planning.revision");
  // Request routing has no older equivalent: its routes, mixes, tables and caller addresses are listed and dropped.
  if (diagram.planning?.requestRoutes) losses.push("planning.requestRoutes");
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
      "trafficMix",
      "routeTable",
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
    for (const key of ["endpointId", "caller", "requestRouteId", "requestFilter"])
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
