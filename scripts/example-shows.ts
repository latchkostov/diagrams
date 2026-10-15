import type { DiagramFile } from "../src/model/types";

/** Metadata only: never modifies the diagram, simulation or exported content. */
export function exampleShows(d: DiagramFile): string[] {
  return [
    ...(d.nodes.some((n) => typeof n.props?.partitions === "number" && n.props.partitions > 1) ? ["partitions"] : []),
    ...(d.nodes.some((n) => n.stencil === "generic.rate-limiter") ? ["rateLimits"] : []),
    ...(d.nodes.some((n) => /^(cisco|juniper|paloalto|arista|f5)\./.test(n.stencil)) ? ["networkDevices"] : []),
  ];
}
