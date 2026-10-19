import type { DiagramFile } from "../model/types";
import { type DrillPreset, type Fault } from "../model/faults";
import { faultTopology } from "../model/faultRuntime";
import { stencilRole } from "../stencils/roles";

export { drillName } from "../model/faultWords";

const targetCache = new WeakMap<DiagramFile, Map<Fault["kind"], { id: string; label: string }[]>>();
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
  return preset === "zone-outage"
    ? "boundary"
    : preset === "region-connectivity"
      ? "link"
      : preset === "slow-dependency"
        ? "slow"
        : "fail";
}
