import type { DiagramFile } from "../model/types";
import { resolveProps } from "../sim/defaults";
import { stencilRole } from "../stencils/roles";
import { profileOf, FAMILIES, PROCESSOR_LESSON } from "../stencils/profiles";

/** Explicit opt-in: pin today's effective defaults; preserve overrides, group omission and every simulation. */
export function upgradePlanning(d: DiagramFile): DiagramFile {
  if (d.planning) return structuredClone(d);
  return {
    ...structuredClone(d),
    format: "diagrams/v2",
    planning: { revision: "p1" },
    nodes: d.nodes.map((node) => {
      const resolved = resolveProps(stencilRole(node.stencil), node.label, node.props ?? {}, node.stencil);
      const { device } = resolved;
      const pinned = Object.fromEntries(
        Object.entries(resolved).filter(
          ([key, v]) =>
            key !== "device" && key !== "profile" && v !== undefined && (typeof v !== "number" || Number.isFinite(v)),
        ),
      );
      const family = profileOf(node.stencil)?.family;
      return {
        ...structuredClone(node),
        props: {
          ...pinned,
          ...(device
            ? {
                gbps: device.gbps,
                messageKB: device.messageKB,
                ha: device.ha,
                failoverMs: device.failoverMs,
                size: device.size,
              }
            : {}),
          ...(family && FAMILIES[family]?.roles.includes("processor")
            ? { preset: PROCESSOR_LESSON.id, presetRevision: PROCESSOR_LESSON.revision }
            : {}),
          ...(device ? { preset: "device-size", presetRevision: "1" } : {}),
          ...structuredClone(node.props),
        },
      };
    }),
  };
}

/** Explicit downgrade with a loss report; P1 metadata has no new execution semantics. */
export function legacyExport(d: DiagramFile): { diagram: DiagramFile; losses: string[] } {
  const diagram = structuredClone(d);
  const losses: string[] = [];
  if (diagram.planning) losses.push("planning.revision");
  delete diagram.planning;
  diagram.format = "diagrams/v1";
  for (const node of diagram.nodes)
    for (const key of ["preset", "presetRevision", "connections", "querySlots"]) {
      if (node.props && key in node.props) {
        losses.push(`${node.id}.props.${key}`);
        Reflect.deleteProperty(node.props, key);
      }
    }
  for (const edge of diagram.edges)
    if (edge.props && "networkDelayMs" in edge.props) {
      losses.push(`${edge.id}.props.networkDelayMs`);
      delete edge.props.networkDelayMs;
    }
  return { diagram, losses };
}
