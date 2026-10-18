import type { DiagramFile, Simulation } from "./types";
import type { JsonSchema } from "./jsonSchema";
import { isDependency } from "./relations";
import { t } from "../i18n/core";

/** Runtime overlays: clearing a fault reveals the current configuration, without overwriting it. */
export type Fault =
  | { kind: "boundary"; boundary: string; down: boolean }
  | { kind: "slow"; node: string; factor: 1 | 2 | 5 | 10 }
  | { kind: "fail"; node: string; rate: 0 | 0.1 | 0.5 }
  | { kind: "link"; edge: string; cut: boolean };

export const DRILL_PRESETS = ["zone-outage", "region-connectivity", "slow-dependency", "error-spike"] as const;
export type DrillPreset = (typeof DRILL_PRESETS)[number];

export const faultTarget = (fault: Fault): string =>
  fault.kind === "boundary" ? fault.boundary : fault.kind === "link" ? fault.edge : fault.node;
export const faultKey = (fault: Fault): string => JSON.stringify([fault.kind, faultTarget(fault)]);
export const faultActive = (fault: Fault): boolean =>
  fault.kind === "boundary"
    ? fault.down
    : fault.kind === "link"
      ? fault.cut
      : fault.kind === "slow"
        ? fault.factor !== 1
        : fault.rate !== 0;

/** Includes enclosing boundaries, bounded even for an unvalidated cyclic input. */
export const boundaryParents = (diagram: DiagramFile): ReadonlyMap<string, string | undefined> =>
  new Map((diagram.groups ?? []).map((g) => [g.id, g.group]));

export function boundaryAncestors(
  parents: ReadonlyMap<string, string | undefined>,
  group: string | undefined,
): string[] {
  const seen = new Set<string>();
  while (group && parents.has(group) && !seen.has(group)) {
    seen.add(group);
    group = parents.get(group);
  }
  return [...seen];
}

/** Partitions apply only to flows crossing two distinct, declared boundaries. */
export function canCutLink(diagram: DiagramFile, id: string): boolean {
  const edge = diagram.edges.find((e) => e.id === id);
  if (!edge || isDependency(edge)) return false;
  const from = diagram.nodes.find((n) => n.id === edge.from)?.group;
  const to = diagram.nodes.find((n) => n.id === edge.to)?.group;
  const groups = new Set(diagram.groups?.map((g) => g.id));
  return !!from && !!to && from !== to && groups.has(from) && groups.has(to);
}

export function faultProblem(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "a fault needs a kind and target";
  const f = value as Record<string, unknown>;
  const fields =
    f.kind === "boundary"
      ? ["kind", "boundary", "down"]
      : f.kind === "link"
        ? ["kind", "edge", "cut"]
        : f.kind === "slow"
          ? ["kind", "node", "factor"]
          : ["kind", "node", "rate"];
  if (Object.keys(f).some((key) => !fields.includes(key))) return "unexpected fault property";
  const target = f.kind === "boundary" ? f.boundary : f.kind === "link" ? f.edge : f.node;
  if (typeof target !== "string" || !target.length) return "a fault needs a target id";
  if (f.kind === "boundary" && typeof f.down === "boolean") return;
  if (f.kind === "link" && typeof f.cut === "boolean") return;
  if (f.kind === "slow" && [1, 2, 5, 10].includes(f.factor as number)) return;
  if (f.kind === "fail" && [0, 0.1, 0.5].includes(f.rate as number)) return;
  return "invalid fault kind or magnitude";
}

/** DFS intervals index all descendants in linear space, including deeply nested boundaries. */
export function faultTopology(diagram: DiagramFile) {
  const nodes = new Map(diagram.nodes.map((n) => [n.id, n]));
  const parents = boundaryParents(diagram);
  const children = new Map<string | undefined, string[]>();
  const direct = new Map<string, string[]>();
  for (const [id, parent] of parents) {
    const key = parent && parents.has(parent) ? parent : undefined;
    const list = children.get(key) ?? [];
    list.push(id);
    children.set(key, list);
  }
  for (const n of nodes.values()) {
    if (!n.group) continue;
    const list = direct.get(n.group) ?? [];
    list.push(n.id);
    direct.set(n.group, list);
  }
  const members: string[] = [];
  const ranges = new Map<string, { start: number; end: number }>();
  const visit = (root: string) => {
    const stack: { id: string; exit?: boolean }[] = [{ id: root }];
    while (stack.length) {
      const { id, exit } = stack.pop()!;
      if (exit) {
        ranges.get(id)!.end = members.length;
        continue;
      }
      if (ranges.has(id)) continue;
      ranges.set(id, { start: members.length, end: members.length });
      members.push(...(direct.get(id) ?? []));
      stack.push({ id, exit: true });
      for (const child of children.get(id) ?? []) stack.push({ id: child });
    }
  };
  for (const id of children.get(undefined) ?? []) visit(id);
  for (const id of parents.keys()) if (!ranges.has(id)) visit(id);
  const links = new Map(
    diagram.edges
      .filter((e) => {
        if (isDependency(e)) return false;
        const from = nodes.get(e.from)?.group,
          to = nodes.get(e.to)?.group;
        return !!from && !!to && from !== to && parents.has(from) && parents.has(to);
      })
      .map((e) => [e.id, e]),
  );
  return { nodes, members, ranges, links };
}

/** Maximum descendant updates across a whole timeline, checked before allocating an engine. */
export const MAX_FAULT_WORK = 1_000_000;
export class FaultTimelineError extends Error {}
export function faultTimelineProblem(diagram: DiagramFile, simulation: Simulation): string | undefined {
  const steps = simulation.timeline?.filter((s) => s.action.do === "fault") ?? [];
  if (!steps.length) return;
  const topology = faultTopology(diagram);
  const active = new Map<string, string>();
  let work = 0;
  for (const { action } of steps.sort((a, b) => a.atMs - b.atMs)) {
    if (action.do !== "fault") continue;
    const f = action.fault;
    const problem = faultProblem(f);
    if (problem) return problem;
    const range = f.kind === "boundary" ? topology.ranges.get(f.boundary) : undefined;
    if (f.kind === "boundary" ? !range : f.kind === "link" ? !topology.links.has(f.edge) : !topology.nodes.has(f.node))
      return t("fault.repairTarget");
    const key = faultKey(f),
      value = faultActive(f) ? JSON.stringify(f) : undefined;
    if (active.get(key) === value) continue;
    if (value) active.set(key, value);
    else active.delete(key);
    // Drill fault changes also reset every node's latency recorder.
    work += topology.nodes.size + (range ? range.end - range.start : 1);
    if (work > MAX_FAULT_WORK) return t("fault.workBudget");
  }
}

export const faultSchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      required: ["kind", "boundary", "down"],
      additionalProperties: false,
      properties: {
        kind: { const: "boundary" },
        boundary: { type: "string", minLength: 1 },
        down: { type: "boolean" },
      },
    },
    {
      type: "object",
      required: ["kind", "node", "factor"],
      additionalProperties: false,
      properties: { kind: { const: "slow" }, node: { type: "string", minLength: 1 }, factor: { enum: [1, 2, 5, 10] } },
    },
    {
      type: "object",
      required: ["kind", "node", "rate"],
      additionalProperties: false,
      properties: { kind: { const: "fail" }, node: { type: "string", minLength: 1 }, rate: { enum: [0, 0.1, 0.5] } },
    },
    {
      type: "object",
      required: ["kind", "edge", "cut"],
      additionalProperties: false,
      properties: { kind: { const: "link" }, edge: { type: "string", minLength: 1 }, cut: { type: "boolean" } },
    },
  ],
};

type Boundary = NonNullable<DiagramFile["groups"]>[number];
const outageIndexes = new WeakMap<
  DiagramFile,
  {
    topology: ReturnType<typeof faultTopology>;
    groups: Map<string, Boundary>;
    key?: string;
    members: ReadonlyMap<string, Boundary>;
    faults?: readonly Fault[];
  }
>();
const NO_FAULTS: readonly Fault[] = [];

/** First active outage wins for overlapping boundaries, just as in the engine's fault order. */
export function outageMembership(
  diagram: DiagramFile,
  faults: readonly Fault[] = NO_FAULTS,
): ReadonlyMap<string, Boundary> {
  let index = outageIndexes.get(diagram);
  if (!index) {
    index = {
      topology: faultTopology(diagram),
      groups: new Map(diagram.groups?.map((g) => [g.id, g])),
      members: new Map(),
    };
    outageIndexes.set(diagram, index);
  }
  if (index.faults === faults) return index.members;
  const outages = faults.filter((f): f is Extract<Fault, { kind: "boundary" }> => f.kind === "boundary" && f.down);
  const key = JSON.stringify(outages.map((f) => f.boundary));
  index.faults = faults;
  if (index.key === key) return index.members;
  index.key = key;
  const members = new Map<string, Boundary>();
  const topology = index.topology;
  // Skip assigned descendants so overlapping outages never re-walk the same nodes.
  const next = Array.from({ length: topology.members.length + 1 }, (_, i) => i);
  const unassigned = (start: number): number => {
    let i = start;
    while (next[i] !== i) i = next[i];
    while (next[start] !== start) {
      const parent = next[start];
      next[start] = i;
      start = parent;
    }
    return i;
  };
  for (const fault of outages) {
    const range = topology.ranges.get(fault.boundary),
      boundary = index.groups.get(fault.boundary);
    if (!range || !boundary) continue;
    for (let i = unassigned(range.start); i < range.end; i = unassigned(i)) {
      members.set(topology.members[i], boundary);
      next[i] = unassigned(i + 1);
    }
  }
  index.members = members;
  return members;
}

/** The enclosing outage that must be restored before a member can be revived. */
export function boundaryOutage(diagram: DiagramFile, nodeId: string, faults?: readonly Fault[]) {
  return outageMembership(diagram, faults).get(nodeId);
}
