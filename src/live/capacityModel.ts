import { revisionAtLeast } from "../model/revisions";
// Inputs & capacity: the pure model behind the "Inputs & capacity" panel and the capacity heat map.
// No React, no DOM. It turns a diagram plus an optional saved simulation plus the panel's what-if
// inputs into (a) the simulation to run, (b) a planning analysis per node, (c) a bottleneck headline
// with a one-click fix. All rates are real messages per second.

import { flowEdges } from "../model/relations";
import { brokerSpec } from "../model/brokers";
import { t } from "../i18n/core";
import type { DiagramFile, DiagramNode, SimRole, Simulation } from "../model/types";
import { stencilRole } from "../stencils/roles";
import type { NodeCapacity } from "../sim/capacity";
import { compileTopology } from "../sim/topology";
import type { NodeStatus } from "../sim/types";
import { peakRate } from "../sim/scale";
import { type SizingChange } from "../sim/capacityInputs";
import { resolveMultiplier } from "../sim/units";
import { formatCount } from "./format";

import { baseProps, sourceIds, freeRate, withoutProp, type LiveInputs } from "./playbackInputs";
export {
  emptyInputs,
  hasInputs,
  baseProps,
  scaleShape,
  setEntryRate,
  effectiveSimulation,
  sourceIds,
  freeRate,
  freePlaySimulation,
  freePlayProps,
  freePlayScale,
  withFix,
  inputsWithoutFix,
  freePlaySaveProps,
  type LiveInputs,
} from "./playbackInputs";

/** Roles whose capacity limits playback. Gateways, stores and sinks accept parallel work in the
 *  simulation, so their single-lane estimates would paint every database red; they stay neutral. */
const MODELED: ReadonlySet<SimRole> = new Set(["processor", "topic", "stream", "queue"]);
export const isModeled = (role: SimRole) => MODELED.has(role);
const BROKERS: ReadonlySet<SimRole> = new Set(["topic", "stream", "queue"]);

const roleOf = (n: DiagramNode): SimRole => stencilRole(n.stencil);

/** Entry points: sources, plus nodes with traffic in the simulation. Rates are base peaks (before Traffic ×). */
export function entryRates(d: DiagramFile, sim: Simulation | null, inputs: LiveInputs): Map<string, number> {
  const out = new Map<string, number>();
  const ids = new Set(d.nodes.map((n) => n.id));
  if (sim)
    for (const p of sim.traffic) if (ids.has(p.node)) out.set(p.node, (out.get(p.node) ?? 0) + peakRate(p.shape));
  for (const id of sourceIds(d)) if (!out.has(id)) out.set(id, sim ? 0 : freeRate(d, id, inputs));
  for (const [id, rate] of Object.entries(inputs.rates)) if (out.has(id)) out.set(id, rate);
  // Diagram order reads like the picture.
  return new Map(d.nodes.filter((n) => out.has(n.id)).map((n) => [n.id, out.get(n.id)!]));
}

/**
 * Where traffic would enter (diagram order, at most three): nodes nothing points at that feed
 * something. In a cycle every node is fed, so then any node that feeds something; with no edges at
 * all, any node.
 */
export function entryCandidates(d: DiagramFile): DiagramNode[] {
  const ids = new Set(d.nodes.map((n) => n.id));
  const edges = flowEdges(d.edges).filter((e) => e.from !== e.to && ids.has(e.from) && ids.has(e.to));
  const fed = new Set(edges.map((e) => e.to));
  const feeds = new Set(edges.map((e) => e.from));
  const roots = d.nodes.filter((n) => !fed.has(n.id));
  const feeding = roots.filter((n) => feeds.has(n.id));
  if (feeding.length) return feeding.slice(0, 3);
  const inCycle = d.nodes.filter((n) => feeds.has(n.id));
  return (inCycle.length ? inCycle : roots.length ? roots : d.nodes).slice(0, 3);
}

// ---------------------------------------------------------------- analysis

export type HeatLevel = "idle" | "ok" | "warn" | "hot" | "over";

export const rank = (order: Map<string, number>) => (a: NodeHeat, b: NodeHeat) =>
  (b.utilization === a.utilization ? 0 : b.utilization > a.utilization ? 1 : -1) ||
  Number(b.role === "processor") - Number(a.role === "processor") ||
  (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);

/** Green < 60%, amber 60–90%, red ≥ 90%, pulsing red above 100%. No offered traffic: no colour. */
export function heatLevel(utilization: number, offered: number): HeatLevel {
  if (!(offered > 0)) return "idle";
  if (!Number.isFinite(utilization) || utilization > 1) return "over";
  if (utilization >= 0.9) return "hot";
  if (utilization >= 0.6) return "warn";
  return "ok";
}

export function formatUtilization(u: number): string {
  if (!Number.isFinite(u)) return "∞";
  const pct = Math.round(u * 100);
  return pct < 1000 ? `${pct}%` : `${formatCount(u)}×`;
}

export interface NodeHeat extends NodeCapacity {
  modeled: boolean;
  /**
   * A topic, stream or queue with no consumer. Not an overload: a topic keeps what's published (its heat is a
   * warning, not red), a queue's messages wait in it. Its capacity is zero either way.
   */
  noReader?: boolean;
  /** Down or paused (in the run, the simulation's setup or the diagram); undefined when up. */
  status?: Exclude<NodeStatus, "up">;
  /**
   * Down or paused, and fed only by topics, streams or queues: their names. Its messages wait there for it (that's
   * what a broker is for); they fail only when they're pushed to it.
   */
  waitsIn?: string[];
  level: HeatLevel;
  /** Compact label for the badge slot, e.g. "82% · 4.1k/s of 5k/s". */
  text: string;
}

/** A planned change (src/sim/capacityPlanning.ts), with the node's label: replicas, partitions, or a device's size. */
export type FixChange = SizingChange & { label: string };

export interface CapacityFix {
  changes: FixChange[];
  /** e.g. "Payments service 6 → 26 replicas". */
  label: string;
}

export interface CapacityView {
  nodes: Record<string, NodeHeat>;
  top?: NodeHeat;
  tone: HeatLevel;
  headline: string;
  detail: string;
  fix: CapacityFix | null;
  /** The broker the headline says nobody reads: the callout offers Add a consumer instead of a fix. */
  addConsumer?: string;
  converged: boolean;
}

/** A run's node statuses right now (only the ones that aren't up need to be listed). */
export type RunStatus = Readonly<Record<string, NodeStatus | undefined>>;

/** "orders", "orders and payments", "orders and 2 more". */
export function brokerList(names: readonly string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names[0]} and ${names.length - 1} more`;
}

/**
 * Where a down consumer's messages are: "Messages wait in orders until it's back (49 so far)". The live callout and
 * the capacity callout say the same, the live one with the count it sees.
 */
export function waitDetail(brokers: readonly string[], count?: number): string {
  const sofar = count !== undefined && count > 0 ? ` (${formatCount(count)} so far)` : "";
  return `Messages wait in ${brokerList(brokers)} until it's back${sofar}.`;
}

// ---------------------------------------------------------------- partitions

/**
 * Why raising a topic's partitions changes nothing, by topic id, for the notes under Partitions in the Inputs panel:
 * only topics raised past their saved value, and only where that can't help. Partitions cap how many consumers in
 * one group work in parallel; they don't speed up publishing. One topology and one node index for every row (none
 * at all while nothing is raised), so a panel of hundreds of topics stays linear.
 */
export function partitionsNotes(d: DiagramFile, sim: Simulation | null, inputs: LiveInputs): Map<string, string> {
  const notes = new Map<string, string>();
  const raised = d.nodes.filter(
    (n) =>
      brokerSpec(n.stencil, roleOf(n), d.planning)?.partitioned &&
      baseProps(d, n, sim, inputs.props[n.id]).partitions > baseProps(d, n, sim).partitions,
  );
  if (!raised.length) return notes;
  const groupsOf = compileTopology(d).groups;
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const capacity = inputs.capacity ?? resolveMultiplier(sim?.multipliers?.capacity);
  const replicas = (id: string) => {
    const member = byId.get(id)!;
    if (roleOf(member) !== "processor") return Infinity;
    return Math.max(1, Math.round(baseProps(d, member, sim, inputs.props[id]).replicas * capacity));
  };
  for (const node of raised) {
    const groups = groupsOf.get(node.id) ?? [];
    if (!groups.length) {
      notes.set(
        node.id,
        revisionAtLeast(d.planning?.revision, "p2")
          ? t("broker.noReader")
          : "Nobody reads it yet, so more partitions change nothing.",
      );
      continue;
    }
    const now = baseProps(d, node, sim, inputs.props[node.id]).partitions;
    const most = Math.max(...groups.map((g) => g.members.reduce((sum, id) => sum + replicas(id), 0)));
    if (!(most < now)) continue;
    const which = groups.length > 1 ? "Its largest consumer group has" : "Its consumer group has";
    notes.set(
      node.id,
      revisionAtLeast(d.planning?.revision, "p2")
        ? t("broker.assignmentNote")
        : `${which} ${most} ${most === 1 ? "replica" : "replicas"}: partitions past ${most} add no speed.`,
    );
  }
  return notes;
}

// ---------------------------------------------------------------- rows

export interface PanelRows {
  entries: string[];
  services: string[];
  brokers: string[];
  /** How many rows "Show all" would add. */
  hidden: number;
}

/**
 * Which rows the panel shows. Entry points always; services and topics/queues show the busiest
 * `limit` of each plus whatever the bottleneck callout and its fix touch. "Show all" lists everything.
 */
export function selectRows(
  d: DiagramFile,
  view: CapacityView,
  entries: Iterable<string>,
  { showAll = false, limit = 4, editing }: { showAll?: boolean; limit?: number; editing?: string | null } = {},
): PanelRows {
  const order = new Map(d.nodes.map((n, i) => [n.id, i]));
  const pinned = new Set([
    ...(editing ? [editing] : []),
    ...(view.fix?.changes.map((c) => c.nodeId) ?? []),
    ...(view.top ? [view.top.id] : []),
  ]);
  const busiest = (ids: string[]) =>
    ids
      .map((id) => view.nodes[id])
      .filter(Boolean)
      .sort(rank(order))
      .map((n) => n.id);
  let hidden = 0;
  const pick = (ids: string[]) => {
    const all = busiest(ids);
    if (showAll) return all;
    const shown = all.filter((id, i) => i < limit || pinned.has(id));
    hidden += all.length - shown.length;
    return shown;
  };
  const roleIds = (pred: (r: SimRole) => boolean) => d.nodes.filter((n) => pred(roleOf(n))).map((n) => n.id);
  return {
    entries: [...entries],
    services: pick(roleIds((r) => r === "processor").filter((id) => !view.nodes[id]?.managed)),
    brokers: pick(roleIds((r) => BROKERS.has(r))),
    hidden,
  };
}

// ---------------------------------------------------------------- presets

export type PresetId = "normal" | "black-friday" | "half-pods" | "double-partitions";

export const PRESETS: readonly { id: PresetId; label: string; hint: string }[] = [
  { id: "normal", label: "Normal", hint: "1× traffic, 1× capacity, saved partitions" },
  { id: "black-friday", label: "Black Friday", hint: "5× traffic" },
  { id: "half-pods", label: "Half the pods", hint: "Capacity × 0.5" },
  { id: "double-partitions", label: "Double partitions", hint: "Every topic and stream gets 2× partitions" },
];

const partitionedIds = (d: DiagramFile) =>
  d.nodes.filter((n) => brokerSpec(n.stencil, roleOf(n), d.planning)?.partitioned);

/** What a preset does to the inputs. Presets combine (Black Friday on half the pods). */
export function applyPreset(id: PresetId, inputs: LiveInputs, d: DiagramFile, base: Simulation | null): LiveInputs {
  const props = structuredClone(inputs.props);
  switch (id) {
    case "normal": {
      let reset = props;
      for (const n of partitionedIds(d)) reset = withoutProp(reset, n.id, "partitions");
      return { ...inputs, traffic: 1, capacity: 1, props: reset };
    }
    case "black-friday":
      return { ...inputs, traffic: 5 };
    case "half-pods":
      return { ...inputs, capacity: 0.5 };
    case "double-partitions":
      for (const n of partitionedIds(d))
        props[n.id] = { ...props[n.id], partitions: baseProps(d, n, base).partitions * 2 };
      return { ...inputs, props };
  }
}

export function isPresetActive(id: PresetId, inputs: LiveInputs, d: DiagramFile, base: Simulation | null): boolean {
  const traffic = inputs.traffic ?? resolveMultiplier(base?.multipliers?.traffic);
  const capacity = inputs.capacity ?? resolveMultiplier(base?.multipliers?.capacity);
  const partitions = (n: DiagramNode) => inputs.props[n.id]?.partitions;
  switch (id) {
    case "normal":
      return (
        traffic === 1 &&
        capacity === 1 &&
        partitionedIds(d).every(
          (n) => partitions(n) === undefined || partitions(n) === baseProps(d, n, base).partitions,
        )
      );
    case "black-friday":
      return traffic === 5;
    case "half-pods":
      return capacity === 0.5;
    case "double-partitions": {
      const brokers = partitionedIds(d);
      return brokers.length > 0 && brokers.every((n) => partitions(n) === baseProps(d, n, base).partitions * 2);
    }
  }
}

// ---------------------------------------------------------------- number formats and sliders

const trim = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);

/** A rate for an input box: "25", "2.5", "2k", "1.25k", "1.5M", or "1,234" when a suffix would round. */
export function formatRateInput(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const fits = (v: number) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6;
  if (n >= 1e6 && fits(n / 1e6)) return `${trim((n / 1e6).toFixed(2))}M`;
  if (n >= 1000 && fits(n / 1000)) return `${trim((n / 1000).toFixed(2))}k`;
  if (n < 10) return trim(n.toFixed(2));
  return Math.round(n).toLocaleString("en-US");
}

/** Parses "2000", "2,000", "2k", "1.5 M", "2.5/s"; NaN when it isn't a non-negative number. */
export function parseRate(text: string): number {
  const m = /^\s*([0-9][0-9,]*(?:\.[0-9]*)?|\.[0-9]+)\s*([kKmM]?)\s*(?:msg)?\s*(?:\/\s*s)?\s*$/.exec(text);
  if (!m) return NaN;
  const value = Number(m[1].replace(/,/g, ""));
  const unit = m[2].toLowerCase();
  return value * (unit === "k" ? 1e3 : unit === "m" ? 1e6 : 1);
}

export const TRAFFIC_STOPS = [
  0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10,
] as const;
export const CAPACITY_STOPS = [0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4] as const;

/** Index of the stop nearest `value` on a log scale. */
export function nearestStop(stops: readonly number[], value: number): number {
  let best = 0;
  for (let i = 1; i < stops.length; i++)
    if (Math.abs(Math.log(stops[i] / value)) < Math.abs(Math.log(stops[best] / value))) best = i;
  return best;
}

export function formatMultiplier(m: number): string {
  return `${trim(m.toFixed(m < 1 ? 2 : 1))}×`;
}

/** Rate slider: position 0 is zero, 1…STEPS map logarithmically onto 1…max, rounded to 2 significant digits. */
export const RATE_STEPS = 120;
export function rateSliderMax(rate: number): number {
  const want = Math.max(10_000, rate * 10);
  const power = 10 ** Math.floor(Math.log10(want));
  return [1, 2, 5, 10].find((v) => v * power >= want)! * power;
}
export function rateFromSlider(pos: number, max: number): number {
  if (pos <= 0) return 0;
  const raw = Math.exp((Math.log(max) * pos) / RATE_STEPS);
  const digits = 10 ** Math.max(0, Math.floor(Math.log10(raw)) - 1);
  return Math.round(raw / digits) * digits;
}
export function sliderFromRate(rate: number, max: number): number {
  if (!(rate >= 1)) return rate > 0 ? 1 : 0;
  return Math.max(1, Math.min(RATE_STEPS, Math.round((Math.log(rate) / Math.log(max)) * RATE_STEPS)));
}

/** Choices for the "1 dot ≈ N" override: the 1/2/5 series up to well past the automatic value. */
export function scaleOptions(auto: number, current: number): number[] {
  const valid = (v: number) => Number.isFinite(v) && v >= 1;
  const out = new Set<number>(valid(current) ? [current] : []);
  const top = Math.min(1e7, Math.max(1000, valid(auto) ? auto * 20 : 1000, valid(current) ? current : 1));
  for (let exponent = 0; exponent <= 7; exponent++)
    for (const v of [1, 2, 5]) if (v * 10 ** exponent <= top) out.add(v * 10 ** exponent);
  return [...out].sort((a, b) => a - b);
}
