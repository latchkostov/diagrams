import type { ApiBehaviour } from "../src/model/admission";
import type { AutoscalingConfig } from "../src/model/autoscaling";
import type { DiagramFile } from "../src/model/types";

/** Metadata only: never modifies the diagram, simulation or exported content. */
export function exampleShows(d: DiagramFile): string[] {
  return [
    ...(d.nodes.some((n) => typeof n.props?.partitions === "number" && n.props.partitions > 1) ? ["partitions"] : []),
    ...(d.nodes.some(
      (n) =>
        n.stencil === "generic.rate-limiter" ||
        (n.props?.api as ApiBehaviour | undefined)?.quotas?.some((q) => q.amount > 0 && q.windowMs > 0),
    )
      ? ["rateLimits"]
      : []),
    ...(d.nodes.some((n) => /^(cisco|juniper|paloalto|arista|f5)\./.test(n.stencil)) ? ["networkDevices"] : []),
    ...(d.planning?.revision === "p3-a1" &&
    d.nodes.some((n) => n.props?.resources && (n.props.autoscaling as AutoscalingConfig | undefined)?.mode === "on")
      ? ["autoscaling"]
      : []),
    ...(Array.isArray(d.planning?.requestRoutes) &&
    d.nodes.some((n) => n.props?.routeTable !== undefined || n.props?.trafficMix !== undefined)
      ? ["routing"]
      : []),
  ];
}
