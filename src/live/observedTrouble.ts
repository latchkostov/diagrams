import type { DiagramFile, SimRole } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { compileTopology, type CompiledEdge, type CompiledGroup } from "../sim/topology";
import type { NodeStatus } from "../sim/types";
import { formatCount } from "./format";
import { brokerList, waitDetail } from "./capacityModel";

// What playback shows going wrong, whatever the plan says (docs/research/sim-flows-review.md, F-1, F-5, F-32): a node
// that's down, a node losing messages, a broker whose lag keeps rising. The live callout reports it on its own, with
// one action each, so "Healthy" never sits over a backlog that only grows. Pure: it reads real-unit snapshots.

/** How far back "rising" and "losing" look, in simulated time. */
export const WINDOW_MS = 10_000;
const SAMPLE_MS = 1_000;

export type TroubleKind = "down" | "dropping" | "lag";
export type TroubleAction =
  | { kind: "revive"; node: string }
  | { kind: "add-consumer"; node: string }
  | { kind: "add-dlq"; node: string }
  | { kind: "events"; node: string }
  | { kind: "inputs" };

export interface Trouble {
  /** One cause: its kind and node ("lag:orders"). The callout shows each cause once per run. */
  key: string;
  kind: TroubleKind;
  node: string;
  /** Changes with its counts (lag 240, 12 dropped). */
  headline: string;
  /** The cause in words, without counts: what a screen reader hears, once. */
  announce: string;
  detail: string;
  action: TroubleAction;
}

/** What the watcher reads of a node: a real-unit snapshot's node (RealSimSnapshot["nodes"][id]). */
export interface WatchedNode {
  status: NodeStatus;
  lag: Record<string, number>;
  dropped: number;
  noConsumer?: true;
}
export interface WatchedFrame {
  time: number;
  /** Real messages per dot (default 1). */
  scale?: number;
  nodes: Record<string, WatchedNode>;
}

interface Sample {
  time: number;
  lag: Map<string, number>;
  dropped: Map<string, number>;
}

const BROKERS: ReadonlySet<SimRole> = new Set(["queue", "topic", "stream"]);
const maxLag = (n: WatchedNode) => Math.max(0, ...Object.values(n.lag));
const KIND_ORDER: Record<TroubleKind, number> = { down: 0, dropping: 1, lag: 2 };

/**
 * Samples snapshots about once a simulated second and reports the trouble they show, worst first: down, then
 * losing messages, then lag that rose over the last 10 s (and is still rising). A jump (a restart, a seek)
 * starts the history again. Status is read on every call (a node killed or revived while paused shows at once);
 * the rest is recomputed only when a sample is taken.
 */
export class TroubleWatcher {
  private samples: Sample[] = [];
  private last: { statuses: string; diagram: DiagramFile; troubles: Trouble[] } | undefined;

  reset(): void {
    this.samples = [];
    this.last = undefined;
  }

  observe(frame: WatchedFrame, diagram: DiagramFile): Trouble[] {
    const last = this.samples.at(-1);
    // A jump (a seek, a restart, a stalled tab) isn't a trend: start the history again.
    const jumped = !!last && (frame.time < last.time || frame.time - last.time > 3 * SAMPLE_MS);
    if (jumped) this.samples = [];
    let sampled = false;
    if (!last || jumped || frame.time - last.time >= SAMPLE_MS) {
      const lag = new Map<string, number>(),
        dropped = new Map<string, number>();
      for (const [id, n] of Object.entries(frame.nodes)) {
        lag.set(id, maxLag(n));
        dropped.set(id, n.dropped);
      }
      this.samples.push({ time: frame.time, lag, dropped });
      while (this.samples.length > 2 && this.samples[1].time <= frame.time - WINDOW_MS) this.samples.shift();
      sampled = true;
    }
    let statuses = "";
    for (const [id, n] of Object.entries(frame.nodes)) if (n.status !== "up") statuses += `${id}:${n.status};`;
    const cached = this.last;
    if (!sampled && cached && cached.statuses === statuses && cached.diagram === diagram) return cached.troubles;
    const result = troubles(frame, shapeOf(diagram), this.samples);
    this.last = { statuses, diagram, troubles: result };
    return result;
  }
}

/** What the watcher needs of a diagram, built once per diagram (a new object after every edit). */
interface Shape {
  order: Map<string, number>;
  name: (id: string) => string;
  role: Map<string, SimRole>;
  /** Flow routes into each node, dead-letter routes aside. */
  into: Map<string, CompiledEdge[]>;
  /** Nodes some flow reaches (deny rules and dead-letter routes aside). */
  fed: Set<string>;
  /** Targets of a broker's dead-letter route, as playback classifies them (an explicit `dlq: false` included). */
  deadLetterTargets: Set<string>;
  /** Brokers with a dead-letter route of their own. */
  hasDeadLetterRoute: Set<string>;
  groups: Map<string, CompiledGroup[]>;
}

const shapes = new WeakMap<DiagramFile, Shape>();
function shapeOf(d: DiagramFile): Shape {
  const known = shapes.get(d);
  if (known) return known;
  const labels = new Map(d.nodes.map((n) => [n.id, n.label || n.id]));
  const role = new Map(d.nodes.map((n) => [n.id, stencilRole(n.stencil)]));
  const compiled = compileTopology(d);
  const into = new Map<string, CompiledEdge[]>();
  const deadLetterTargets = new Set<string>(),
    hasDeadLetterRoute = new Set<string>();
  for (const e of compiled.edges) {
    // A deny rule delivers nothing: it feeds no one, and its target is no consumer of it.
    if (e.deny) continue;
    if (e.dlq) {
      if (BROKERS.has(role.get(e.from)!)) {
        deadLetterTargets.add(e.to);
        hasDeadLetterRoute.add(e.from);
      }
      continue;
    }
    const list = into.get(e.to) ?? [];
    list.push(e);
    into.set(e.to, list);
  }
  const shape: Shape = {
    order: new Map(d.nodes.map((n, i) => [n.id, i])),
    name: (id) => labels.get(id) ?? id,
    role,
    into,
    fed: new Set(into.keys()),
    deadLetterTargets,
    hasDeadLetterRoute,
    groups: compiled.groups,
  };
  shapes.set(d, shape);
  return shape;
}

function troubles(frame: WatchedFrame, d: Shape, samples: readonly Sample[]): Trouble[] {
  const { name } = d;
  const out: Trouble[] = [];
  const oldest = samples[0];
  const middle = samples[Math.floor(samples.length / 2)];
  const previous = samples.at(-2);
  const spanned = oldest && frame.time - oldest.time >= WINDOW_MS - SAMPLE_MS;
  // Lag must rise by more than noise: a few dots at this scale, and a fifth of what was there.
  const threshold = (before: number) => Math.max(10, 3 * (frame.scale ?? 1), 0.2 * before);

  for (const [id, n] of Object.entries(frame.nodes)) {
    const r = d.role.get(id);
    if (!r || r === "none" || r === "source") continue;
    if (n.status === "down") {
      const into = d.into.get(id) ?? [];
      const brokers =
        into.length && into.every((e) => BROKERS.has(d.role.get(e.from)!)) ? [...new Set(into.map((e) => e.from))] : [];
      let detail: string;
      if (BROKERS.has(r)) detail = "Messages sent to it are dropped until it's back.";
      else if (brokers.length) {
        // What waits for it: each feeding broker's lag in the groups it belongs to (a queue's whole backlog).
        const waiting = brokers.reduce((sum, b) => {
          const lags = frame.nodes[b]?.lag ?? {};
          let lag = 0;
          for (const g of d.groups.get(b) ?? []) if (g.members.includes(id)) lag += lags[g.name] ?? 0;
          return sum + lag;
        }, 0);
        detail = waitDetail(brokers.map(name), waiting);
      } else detail = d.fed.has(id) ? "Messages sent to it fail until it's back." : "";
      out.push({
        key: `down:${id}`,
        kind: "down",
        node: id,
        headline: `${name(id)} is down`,
        announce: `${name(id)} is down`,
        detail,
        action: { kind: "revive", node: id },
      });
      continue;
    }
    if (!spanned) continue;
    const lost = n.dropped - (oldest.dropped.get(id) ?? 0);
    if (lost > 0) {
      const broker = BROKERS.has(r);
      out.push({
        key: `dropping:${id}`,
        kind: "dropping",
        node: id,
        headline: `${name(id)} is losing messages: ${formatCount(n.dropped)} dropped`,
        announce: `${name(id)} is losing messages`,
        detail: broker
          ? "They ran out of deliveries, and no dead-letter queue keeps them."
          : "Messages that fail here are dropped: nothing retries them.",
        action: broker && !d.hasDeadLetterRoute.has(id) ? { kind: "add-dlq", node: id } : { kind: "events", node: id },
      });
      continue;
    }
    // A dead-letter queue keeps what it gets on purpose, read or not: its backlog is no trouble.
    if (!BROKERS.has(r) || (n.noConsumer && r !== "queue") || d.deadLetterTargets.has(id)) continue;
    const now = maxLag(n),
      before = oldest.lag.get(id) ?? 0,
      mid = middle.lag.get(id) ?? 0;
    if (now - before < threshold(before) || mid < before || now < mid || now < (previous?.lag.get(id) ?? 0)) continue;
    if (n.noConsumer) {
      out.push({
        key: `lag:${id}`,
        kind: "lag",
        node: id,
        headline: `Nobody reads ${name(id)}`,
        announce: `Nobody reads ${name(id)}`,
        detail: `Messages wait in it until a consumer takes them: ${formatCount(now)} so far, and rising.`,
        action: { kind: "add-consumer", node: id },
      });
      continue;
    }
    // Name who's behind: the members of the group with the most lag.
    const groups = d.groups.get(id) ?? [];
    const behind = groups.reduce<CompiledGroup | undefined>(
      (worst, g) => ((n.lag[g.name] ?? 0) > (worst ? (n.lag[worst.name] ?? 0) : -1) ? g : worst),
      undefined,
    );
    const readers = behind ? brokerList(behind.members.map(name)) : "";
    out.push({
      key: `lag:${id}`,
      kind: "lag",
      node: id,
      headline: `${name(id)} is falling behind: lag ${formatCount(now)} and rising`,
      announce: `${name(id)} is falling behind`,
      detail:
        behind && readers
          ? `${readers} ${behind.members.length > 1 ? "don't" : "doesn't"} keep up with it.`
          : "Its consumers don't keep up with it.",
      action: { kind: "inputs" },
    });
  }
  return out.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || d.order.get(a.node)! - d.order.get(b.node)!);
}

/**
 * Which trouble the callout shows: the worst one not dismissed and not already shown and over in this run (each
 * cause once per run). `seen` and `ended` are the caller's, kept per run; this updates them.
 */
export function pickTrouble(
  current: readonly Trouble[],
  memory: { shown: Set<string>; ended: Set<string>; dismissed: Set<string> },
): Trouble | undefined {
  const keys = new Set(current.map((t) => t.key));
  for (const key of memory.shown) if (!keys.has(key)) memory.ended.add(key);
  const pick = current.find((t) => !memory.dismissed.has(t.key) && !memory.ended.has(t.key));
  if (pick) memory.shown.add(pick.key);
  return pick;
}
