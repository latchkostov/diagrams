import { timelineConfigurations } from "../model/timelineConfiguration";
import type { DiagramFile, Simulation } from "../model/types";
import { type DrillPreset, type Fault } from "../model/faults";
import { faultTopology } from "../model/faultRuntime";
import { stencilRole } from "../stencils/roles";
import { cacheEnabled } from "../model/caching";

export { drillName } from "../model/faultWords";

const targetCache = new WeakMap<DiagramFile, Map<Fault["kind"], { id: string; label: string }[]>>();
const setups = new WeakMap<DiagramFile, WeakMap<object, DiagramFile>>();
export function faultDiagram(diagram: DiagramFile, simulation: Simulation): DiagramFile {
  const props = simulation.setup?.props;
  if (!props) return diagram;
  const cache = setups.get(diagram) ?? new WeakMap<object, DiagramFile>();
  setups.set(diagram, cache);
  let effective = cache.get(props);
  if (!effective) {
    effective = {
      ...diagram,
      nodes: diagram.nodes.map((n) => (props[n.id] ? { ...n, props: { ...n.props, ...props[n.id] } } : n)),
    };
    cache.set(props, effective);
  }
  return effective;
}
export function faultStepDiagrams(diagram: DiagramFile, simulation: Simulation): Map<number, DiagramFile> {
  const result = new Map<number, DiagramFile>();
  let effective: DiagramFile | undefined;
  for (const { step, index, props } of timelineConfigurations(diagram, simulation)) {
    if (step.action.do === "props") effective = undefined;
    else if (step.action.do === "fault") {
      effective ??= {
        ...diagram,
        nodes: diagram.nodes.map((n) => ({ ...n, props: props.get(n.id) })),
      };
      result.set(index, effective);
    }
  }
  return result;
}
export function faultTargets(diagram: DiagramFile, kind: Fault["kind"]): { id: string; label: string }[] {
  let cache = targetCache.get(diagram);
  if (!cache) targetCache.set(diagram, (cache = new Map()));
  const cached = cache.get(kind);
  if (cached) return cached;
  const targets = buildTargets(diagram, kind);
  cache.set(kind, targets);
  return targets;
}
function buildTargets(diagram: DiagramFile, kind: Fault["kind"]): { id: string; label: string }[] {
  if (kind === "purge")
    return diagram.nodes.filter((n) =>
      cacheEnabled(diagram.planning, n.stencil, stencilRole(n.stencil), n.props?.cache),
    );
  if (kind === "boundary") return diagram.groups ?? [];
  if (kind === "link") {
    const { nodes, links } = faultTopology(diagram);
    return [...links.values()].map((e) => ({
      id: e.id,
      label: e.label || `${nodes.get(e.from)?.label ?? e.from} → ${nodes.get(e.to)?.label ?? e.to}`,
    }));
  }
  return diagram.nodes;
}

export function defaultFault(kind: Fault["kind"], diagram: DiagramFile): Fault {
  const target = faultTargets(diagram, kind);
  if (kind === "boundary") return { kind, boundary: target[0]?.id ?? "", down: true };
  if (kind === "link") return { kind, edge: target[0]?.id ?? "", cut: true };
  if (kind === "purge") return { kind, node: target[0]?.id ?? "", mode: "hard" };
  const roles = new Map(diagram.nodes.map((node) => [node.id, stencilRole(node.stencil)]));
  const node =
    target.find((n) => roles.get(n.id) === "processor")?.id ??
    target.find((n) => roles.get(n.id) === "gateway" || roles.get(n.id) === "store")?.id ??
    target[0]?.id ??
    "";
  if (kind === "slow") return { kind, node, factor: 5 };
  return { kind, node, rate: 0.5 };
}

export function drillFault(preset: DrillPreset, diagram: DiagramFile): Fault {
  return defaultFault(drillKind(preset), diagram);
}

export function drillKind(preset: DrillPreset): Fault["kind"] {
  if (preset === "cold-cache") return "purge";
  return preset === "zone-outage"
    ? "boundary"
    : preset === "region-connectivity"
      ? "link"
      : preset === "slow-dependency"
        ? "slow"
        : "fail";
}
