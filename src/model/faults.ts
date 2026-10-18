import type { DiagramFile } from "./types";
import type { JsonSchema } from "./jsonSchema";
import { isDependency } from "./relations";

/** Runtime overlays: clearing a fault reveals the current configuration, without overwriting it. */
export type Fault =
  | { kind: "boundary"; boundary: string; down: boolean }
  | { kind: "slow"; node: string; factor: 1 | 2 | 5 | 10 }
  | { kind: "fail"; node: string; rate: 0 | 0.1 | 0.5 }
  | { kind: "link"; edge: string; cut: boolean };

export const DRILL_PRESETS = ["zone-outage", "region-connectivity", "slow-dependency", "error-spike"] as const;
export type DrillPreset = (typeof DRILL_PRESETS)[number];

export const faultTarget = (fault: Fault): string =>
  "boundary" in fault ? fault.boundary : "edge" in fault ? fault.edge : fault.node;
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
  const target = f.kind === "boundary" ? f.boundary : f.kind === "link" ? f.edge : f.node;
  if (typeof target !== "string" || !target.length) return "a fault needs a target id";
  if (f.kind === "boundary" && typeof f.down === "boolean") return;
  if (f.kind === "link" && typeof f.cut === "boolean") return;
  if (f.kind === "slow" && [1, 2, 5, 10].includes(f.factor as number)) return;
  if (f.kind === "fail" && [0, 0.1, 0.5].includes(f.rate as number)) return;
  return "invalid fault kind or magnitude";
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

/** The enclosing outage that must be restored before a member can be revived. */
export function boundaryOutage(diagram: DiagramFile, nodeId: string, faults: readonly Fault[] = []) {
  if (!faults.some((f) => f.kind === "boundary" && f.down)) return undefined;
  const membership = boundaryAncestors(boundaryParents(diagram), diagram.nodes.find((n) => n.id === nodeId)?.group);
  const outage = faults.find((f) => f.kind === "boundary" && f.down && membership.includes(f.boundary));
  return outage?.kind === "boundary" ? diagram.groups?.find((g) => g.id === outage.boundary) : undefined;
}
