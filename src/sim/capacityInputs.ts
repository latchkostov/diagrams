// Playback input helpers: no capacity analyzer dependency.
import type { DiagramFile, DiagramNode, Simulation, TrafficProfile } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { resolveProps } from "./defaults";
import type { DeviceSize } from "../stencils/netDevices";
const roleOf = (n: DiagramFile["nodes"][number]) => stencilRole(n.stencil);

/** Every source sending steadily at `rate` (default: its own ratePerSec): free play as a simulation. */
export function sourceTraffic(
  d: DiagramFile,
  rate: (node: DiagramNode) => number = (n) =>
    resolveProps("source", n.label, n.props ?? {}, n.stencil, d.planning).ratePerSec,
): TrafficProfile[] {
  return d.nodes
    .filter((n) => roleOf(n) === "source")
    .map((n) => ({
      id: `src-${n.id}`,
      node: n.id,
      shape: { kind: "constant", ratePerSec: rate(n), durationMs: 60_000 },
    }));
}

export type SizingChange =
  | {
      nodeId: string;
      key: "replicas" | "partitions";
      /** Base values, as saved (before Capacity ×). */
      from: number;
      to: number;
    }
  /** A network device's next size; with `gbps` alongside when the old size's throughput was typed over. */
  | { nodeId: string; key: "size"; from: DeviceSize; to: DeviceSize; model: string }
  | { nodeId: string; key: "gbps"; from: number; to: number };

/** The simulation with `changes` in its saved setup props. */
export function withSizing(sim: Simulation, changes: readonly SizingChange[]): Simulation {
  const next = structuredClone(sim);
  const props = (next.setup ??= {}).props ?? {};
  for (const c of changes) props[c.nodeId] = { ...props[c.nodeId], [c.key]: c.to };
  next.setup.props = props;
  return next;
}
