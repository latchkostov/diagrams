import type { DiagramFile, DiagramNode, SimRole, Simulation, TrafficProfile } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { analyzeCapacity, type NodeCapacity } from "./capacity";
import { resolveProps } from "./defaults";
import { allocateGroupReplicas, compileTopology } from "./topology";
import type { NodeStatus } from "./types";
import { resolveMultiplier } from "./units";
import { activeUnits, deviceSpec, messagesPerSec, presetOf, sizesOf, type DeviceSize } from "../stencils/netDevices";

// Capacity planning and its one-click fix, shared by live view's Show capacity (src/live/capacityModel.ts)
// and the capacity check (src/checks/rules/capacity.ts), so the two never disagree. Pure, and free of the
// simulation engine: the checks chunk loads it without playback.

/** Utilization above this gets a fix; fixes aim for this much headroom (lands in green). */
export const FIX_ABOVE = 0.9;
export const FIX_TARGET = 0.55;
/** The largest replica or partition count a fix may set: the node props schema's bound (src/model/simProps.ts). */
/** The most replicas or partitions a fix proposes: the file format's count bound (SIM_LIMITS.count in model/simProps.ts). */
export const MAX_COUNT = 10_000;

const PARTITIONED: ReadonlySet<SimRole> = new Set(["topic", "stream"]);
const roleOf = (n: DiagramNode): SimRole => stencilRole(n.stencil);

/** Node props as a simulation sees them: the diagram's, then the saved setup's. */
const planProps = (node: DiagramNode, sim: Simulation, d: DiagramFile) =>
  resolveProps(roleOf(node), node.label, { ...node.props, ...sim.setup?.props?.[node.id] }, node.stencil, d.planning);

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

/** Analysis copy where gateways and stores are unlimited, as they are in playback. */
export function planningSimulation(d: DiagramFile, sim: Simulation): Simulation {
  const props = structuredClone(sim.setup?.props ?? {});
  for (const n of d.nodes) {
    const role = roleOf(n);
    if (role === "gateway" || role === "store") props[n.id] = { ...props[n.id], latencyMs: 0 };
  }
  return { ...sim, setup: { ...sim.setup, props } };
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

export interface SizingOptions {
  /** Optional explicit utilization target; the existing planner still verifies every proposed change. */
  target?: number;
  /** A node whose idle replicas need partitions, even under FIX_ABOVE (the busy top bottleneck). */
  idle?: string;
  /** The run's node statuses right now. */
  status?: Readonly<Record<string, NodeStatus | undefined>>;
  /** The largest replica or partition count to suggest. */
  maxCount?: number;
}

/**
 * The capacity fix: raise replicas on each of `nodes` (busiest first) at ≥ FIX_ABOVE so it lands around
 * FIX_TARGET, and raise a topic's partitions when its consumer group needs more of them (including `idle`'s
 * idle replicas). Values are base props, ready to save. Null when nothing changes, or when the change
 * wouldn't land at FIX_TARGET (checked with the same analysis).
 */
export function sizingFix(
  d: DiagramFile,
  sim: Simulation,
  nodes: readonly NodeCapacity[],
  opts: SizingOptions = {},
): SizingChange[] | null {
  const max = opts.maxCount ?? 10_000;
  const target = opts.target ?? FIX_TARGET;
  if (!(target > 0 && target <= 1)) return null;
  const m = resolveMultiplier(sim.multipliers?.capacity);
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const effective = new Map<string, number>();
  const changes: SizingChange[] = [];
  const devices = new Set<string>();
  for (const n of nodes) {
    if (n.device && Number.isFinite(n.utilization) && n.utilization >= FIX_ABOVE && n.capacity) {
      const sized = deviceSizing(byId.get(n.id)!, sim, n, d, target);
      if (sized) {
        changes.push(...sized);
        devices.add(n.id);
      }
      continue;
    }
    if (n.role !== "processor" || !Number.isFinite(n.utilization) || n.utilization < FIX_ABOVE || !n.capacity) continue;
    const active = Math.max(1, n.activeReplicas);
    const wanted = Math.max(n.replicas, Math.ceil((active * n.utilization) / target));
    effective.set(n.id, wanted);
    const from = planProps(byId.get(n.id)!, sim, d).replicas;
    const to = Math.min(max, Math.max(from, Math.ceil(wanted / Math.max(m, 1e-9))));
    if (to > from) changes.push({ nodeId: n.id, key: "replicas", from, to });
  }
  const needsPartitions = (id: string) => effective.has(id) || opts.idle === id;
  for (const [brokerId, groups] of compileTopology(d).groups) {
    const broker = byId.get(brokerId)!;
    if (!PARTITIONED.has(roleOf(broker))) continue;
    const from = planProps(broker, sim, d).partitions;
    let to = from;
    for (const group of groups) {
      if (!group.members.some(needsPartitions)) continue;
      const members = group.members.map((id) => ({
        id,
        role: roleOf(byId.get(id)!),
        replicas: effective.get(id) ?? Math.max(1, Math.round(planProps(byId.get(id)!, sim, d).replicas * m)),
      }));
      const sufficient = (partitions: number) => {
        const allocated = allocateGroupReplicas(roleOf(broker), partitions, members);
        return members.every(
          (member) => !needsPartitions(member.id) || (allocated.get(member.id) ?? 0) >= member.replicas,
        );
      };
      // Nonprocessor members can consume a partition budget too. Search using the same allocator
      // as playback, with an explicit bound rather than reconstructing processor-only groups.
      let high = Math.max(from, 1);
      while (high < max && !sufficient(high)) high = Math.min(max, high * 2);
      if (!sufficient(high)) continue;
      let low = from;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (sufficient(mid)) high = mid;
        else low = mid + 1;
      }
      to = Math.max(to, high);
    }
    if (to > from) changes.push({ nodeId: brokerId, key: "partitions", from, to });
  }
  if (!changes.length) return null;
  const verified = analyzeCapacity(d, planningSimulation(d, withSizing(sim, changes)), { status: opts.status });
  if ([...effective.keys(), ...devices].some((id) => verified.nodes[id].utilization > target + 1e-9)) return null;
  return changes;
}

/**
 * A network device's fix: the smallest bigger size whose preset carries its load at FIX_TARGET, on the units it has
 * carrying traffic. A throughput typed over the old size (in the diagram or the simulation's setup) would hide the
 * preset, so it moves to the new size's figure alongside. Null when no bigger size would do.
 */
function deviceSizing(
  node: DiagramNode,
  sim: Simulation,
  n: NodeCapacity,
  d: DiagramFile,
  target: number,
): SizingChange[] | null {
  const spec = deviceSpec(node.stencil);
  const device = planProps(node, sim, d).device;
  if (!spec || !device?.size) return null;
  const sizes = sizesOf(spec);
  const units = activeUnits(device.ha, Math.max(1, n.replicas));
  const to = sizes
    .slice(sizes.indexOf(device.size) + 1)
    .find((s) => messagesPerSec(presetOf(spec, s).gbps, device.messageKB) * units * target >= n.offered);
  if (!to) return null;
  const preset = presetOf(spec, to);
  const typed = { ...node.props, ...sim.setup?.props?.[node.id] }.gbps;
  return [
    { nodeId: node.id, key: "size", from: device.size, to, model: preset.model },
    ...(typeof typed === "number" ? [{ nodeId: node.id, key: "gbps" as const, from: typed, to: preset.gbps }] : []),
  ];
}

/**
 * Replicas for a node that runs one and is the only way through (the single-point check): two, for redundancy,
 * or, when it's busy (at FIX_ABOVE or more), what the capacity fix asks, within `maxCount`. `enough` is false when
 * no count within the bound brings it to FIX_TARGET: two replicas still remove the single point, but capacity needs
 * more than replicas (faster processing, more concurrency).
 */
export function redundancyFix(
  d: DiagramFile,
  sim: Simulation,
  node: NodeCapacity,
  maxCount = MAX_COUNT,
): { replicas: number; enough: boolean } {
  if (!Number.isFinite(node.utilization) || node.utilization < FIX_ABOVE) return { replicas: 2, enough: true };
  const sized = sizingFix(d, sim, [node], { maxCount })?.find((c) => c.nodeId === node.id && c.key === "replicas");
  return sized?.key === "replicas"
    ? { replicas: Math.min(maxCount, Math.max(2, sized.to)), enough: true }
    : { replicas: 2, enough: false };
}
