// "Start a storm here…": build a ready-to-run simulation from a right-click on a node, plus the
// small id / message-type helpers the authoring panel shares.

import { flowEdges } from "../model/relations";
import type { DiagramFile, DiagramNode, Simulation, TrafficProfile, TrafficShape } from "../model/types";

/** The message type a storm uses when nothing better is known (the story from docs/SIMULATIONS.md). */
export const DEFAULT_STORM_TYPE = "MemberJoined";
export const DEFAULT_STORM_COUNT = 100;
export const DEFAULT_STORM_SPREAD_MS = 3000;
export const DEFAULT_SEED = 7;

/** A unique id from a base, e.g. "storm", "storm-2", "storm-3". */
export function uniqueSimId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const clean = slugify(base) || "simulation";
  if (!used.has(clean)) return clean;
  for (let i = 2; ; i++) if (!used.has(`${clean}-${i}`)) return `${clean}-${i}`;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

/**
 * Best guess for what a node sends: an explicit `messageType` prop, else the type an existing
 * saved simulation already starts at this node with, else the storm default.
 */
export function suggestedMessageType(diagram: DiagramFile, nodeId: string): string {
  const node = diagram.nodes.find((n) => n.id === nodeId);
  const explicit = node?.props?.messageType;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  for (const sim of diagram.simulations ?? []) {
    const t = sim.traffic.find((p) => p.node === nodeId && p.messageType)?.messageType;
    if (t) return t;
  }
  return DEFAULT_STORM_TYPE;
}

/** Every message type the diagram mentions, for pickers: props, emits maps, edge filters, simulations. */
export function knownMessageTypes(diagram: DiagramFile): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string" && v.trim() && !v.includes("*")) out.add(v.trim());
  };
  for (const n of diagram.nodes) {
    add(n.props?.messageType);
    const emits = n.props?.emits;
    if (typeof emits === "string") add(emits);
    else if (emits && typeof emits === "object") {
      for (const [k, v] of Object.entries(emits)) {
        add(k);
        add(v);
      }
    }
  }
  for (const e of flowEdges(diagram.edges)) {
    add(e.props?.emits);
    if (Array.isArray(e.props?.filter)) e.props.filter.forEach(add);
  }
  for (const s of diagram.simulations ?? []) {
    for (const p of s.traffic) add(p.messageType);
    for (const step of s.timeline ?? []) if (step.action.do === "inject") add(step.action.messageType);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

export interface StormOptions {
  count?: number;
  spreadMs?: number;
  messageType?: string;
  title?: string;
}

/** A burst of `count` messages at `nodeId`, spread over `spreadMs`. Not yet saved anywhere. */
export function createStormSimulation(diagram: DiagramFile, nodeId: string, opts: StormOptions = {}): Simulation {
  const node: DiagramNode | undefined = diagram.nodes.find((n) => n.id === nodeId);
  const count = Math.max(1, Math.floor(opts.count ?? DEFAULT_STORM_COUNT));
  const messageType = opts.messageType?.trim() || suggestedMessageType(diagram, nodeId);
  const where = node?.label || nodeId;
  const title = opts.title ?? `${count} ${messageType} at ${where}`;
  const traffic: TrafficProfile = {
    id: "storm",
    node: nodeId,
    messageType,
    label: `${count} × ${messageType}`,
    shape: { kind: "burst", count, spreadMs: Math.max(0, opts.spreadMs ?? DEFAULT_STORM_SPREAD_MS) },
  };
  return {
    id: uniqueSimId(
      `storm-${where}`,
      (diagram.simulations ?? []).map((s) => s.id),
    ),
    title,
    seed: DEFAULT_SEED,
    traffic: [traffic],
    // No focus: the point of a storm is watching it fan out across the whole diagram.
    timeline: [{ atMs: 0, action: { do: "note", text: `${count} ${messageType} messages arrive at ${where}.` } }],
    expectations: [],
  };
}

/** A fresh, empty simulation for "New simulation". */
export function blankSimulation(diagram: DiagramFile): Simulation {
  return {
    id: uniqueSimId(
      "simulation",
      (diagram.simulations ?? []).map((s) => s.id),
    ),
    title: "New simulation",
    seed: DEFAULT_SEED,
    traffic: [],
    timeline: [],
    expectations: [],
  };
}

/** Default shapes for the shape editor's kind switch, keeping whatever timing carries over. */
export function defaultShape(kind: TrafficShape["kind"], from?: TrafficShape): TrafficShape {
  const at = from && "atMs" in from && typeof from.atMs === "number" ? from.atMs : 0;
  switch (kind) {
    case "burst":
      return { kind, count: DEFAULT_STORM_COUNT, atMs: at, spreadMs: DEFAULT_STORM_SPREAD_MS };
    case "constant":
      return { kind, ratePerSec: 20, fromMs: at, durationMs: 5000 };
    case "ramp":
      return {
        kind,
        fromMs: at,
        startRate: 5,
        stages: [
          { durationMs: 4000, targetRate: 40 },
          { durationMs: 3000, targetRate: 10 },
        ],
      };
    case "spike":
      return { kind, baseRate: 5, peakRate: 60, atMs: Math.max(at, 2000), peakMs: 1500, durationMs: 8000 };
  }
}
