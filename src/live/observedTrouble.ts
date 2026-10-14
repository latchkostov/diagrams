import type { DiagramFile, SimRole } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { brokerFeeds, compileTopology, deadLetterRoutes, type CompiledGroup } from "../sim/topology";
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
  /** A rising lag's consumers that don't keep up (to match the capacity callout's diagnosis). */
  related?: string[];
}

/** What the watcher reads of a node: a real-unit snapshot's node (RealSimSnapshot["nodes"][id]). */
export interface WatchedNode {
  status: NodeStatus;
  lag: Record<string, number>;
  dropped: number;
  outageDropped?: number;
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
  outageDropped: Map<string, number>;
}

const BROKERS: ReadonlySet<SimRole> = new Set(["queue", "topic", "stream"]);
const maxLag = (n: WatchedNode) => Math.max(0, ...Object.values(n.lag));
const KIND_ORDER: Record<TroubleKind, number> = { down: 0, dropping: 1, lag: 2 };

/**
 * Samples snapshots about once a simulated second and reports the trouble they show, worst first: down, then
 * losing messages, then lag that rose over the last 10 s (and is still rising). A jump (a restart, a seek)
 * starts the history again. Status is read on every call (a node killed or revived while paused shows at once);
 * loss counters are also read every call, independently of trend sampling.
 */
export class TroubleWatcher {
  private samples: Sample[] = [];
  private last: { statuses: string; losses: string; diagram: DiagramFile; troubles: Trouble[] } | undefined;

  reset(): void {
    this.samples = [];
    this.last = undefined;
  }

  /** Whether the history spans the window: until then a trend can't be seen, so its absence proves nothing. */
  get warm(): boolean {
    const first = this.samples[0],
      last = this.samples.at(-1);
    return !!first && !!last && last.time - first.time >= WINDOW_MS - SAMPLE_MS;
  }

  observe(frame: WatchedFrame, diagram: DiagramFile): Trouble[] {
    const last = this.samples.at(-1);
    // A jump (a seek, a restart, a stalled tab) isn't a trend: start the history again.
    const jumped = !!last && (frame.time < last.time || frame.time - last.time > 3 * SAMPLE_MS);
    if (jumped) this.samples = [];
    let sampled = false;
    if (!last || jumped || frame.time - last.time >= SAMPLE_MS) {
      const lag = new Map<string, number>(),
        dropped = new Map<string, number>(),
        outageDropped = new Map<string, number>();
      for (const [id, n] of Object.entries(frame.nodes)) {
        lag.set(id, maxLag(n));
        dropped.set(id, n.dropped);
        outageDropped.set(id, n.outageDropped ?? 0);
      }
      this.samples.push({ time: frame.time, lag, dropped, outageDropped });
      while (this.samples.length > 2 && this.samples[1].time <= frame.time - WINDOW_MS) this.samples.shift();
      sampled = true;
    }
    let statuses = "",
      losses = "";
    for (const [id, n] of Object.entries(frame.nodes)) {
      if (n.status !== "up") statuses += `${id}:${n.status};`;
      if (n.dropped) losses += `${id}:${n.dropped}:${n.outageDropped ?? 0};`;
    }
    const cached = this.last;
    if (!sampled && cached && cached.statuses === statuses && cached.losses === losses && cached.diagram === diagram)
      return cached.troubles;
    const result = troubles(frame, shapeOf(diagram), this.samples);
    this.last = { statuses, losses, diagram, troubles: result };
    return result;
  }
}

/** What the watcher needs of a diagram, built once per diagram (a new object after every edit). */
interface Shape {
  order: Map<string, number>;
  name: (id: string) => string;
  role: Map<string, SimRole>;
  /** How messages reach each node (brokerFeeds): the brokers that keep them while it's down, or null if pushed. */
  feeds: Map<string, string[] | null>;
  /** Each consumer's groups, with their broker: what waits for it is their lag. */
  memberships: Map<string, { broker: string; group: string }[]>;
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
  const deadLetterTargets = new Set<string>(),
    hasDeadLetterRoute = new Set<string>();
  for (const e of deadLetterRoutes(compiled).values())
    if (!e.deny && BROKERS.has(role.get(e.from)!)) {
      deadLetterTargets.add(e.to);
      hasDeadLetterRoute.add(e.from);
    }
  const memberships = new Map<string, { broker: string; group: string }[]>();
  for (const [broker, groups] of compiled.groups)
    for (const group of groups)
      for (const member of group.members) {
        const list = memberships.get(member) ?? [];
        list.push({ broker, group: group.name });
        memberships.set(member, list);
      }
  const shape: Shape = {
    order: new Map(d.nodes.map((n, i) => [n.id, i])),
    name: (id) => labels.get(id) ?? id,
    role,
    feeds: brokerFeeds(compiled, (id) => role.get(id)),
    memberships,
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
  // Still rising lately, not only overall: a backlog that levels off stops being "rising".
  const recent = samples.at(-3) ?? oldest;
  const spanned = oldest && frame.time - oldest.time >= WINDOW_MS - SAMPLE_MS;
  // Lag must rise by more than noise: a few dots at this scale, and a fifth of what was there.
  const threshold = (before: number) => Math.max(10, 3 * (frame.scale ?? 1), 0.2 * before);

  for (const [id, n] of Object.entries(frame.nodes)) {
    const r = d.role.get(id);
    if (!r || r === "none" || r === "source") continue;
    if (n.status === "down") {
      const feeds = d.feeds.get(id);
      let detail: string;
      if (feeds) {
        // What waits for it: its groups' lag at the brokers that feed it (a queue's whole backlog).
        let waiting = 0;
        for (const { broker, group } of d.memberships.get(id) ?? []) waiting += frame.nodes[broker]?.lag[group] ?? 0;
        detail = waitDetail(feeds.map(name), waiting);
      } else if (feeds === null)
        detail = BROKERS.has(r)
          ? "Messages sent to it are dropped until it's back."
          : "Messages sent to it fail until it's back.";
      else detail = "";
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
    // Loss needs no long history: a short run that drops one message says so.
    const lost = oldest ? n.dropped - (oldest.dropped.get(id) ?? 0) : 0;
    if (lost > 0) {
      const broker = BROKERS.has(r);
      const outage = (n.outageDropped ?? 0) - (oldest?.outageDropped.get(id) ?? 0);
      const exhausted = broker && lost > outage;
      out.push({
        key: `dropping:${id}`,
        kind: "dropping",
        node: id,
        headline: `${name(id)} is losing messages: ${formatCount(n.dropped)} dropped`,
        announce: `${name(id)} is losing messages`,
        detail:
          broker && !exhausted
            ? "Messages sent to it while it was down were dropped on arrival."
            : broker
              ? "They ran out of deliveries, and no dead-letter queue keeps them."
              : "Messages that fail here are dropped: nothing retries them.",
        action:
          exhausted && !d.hasDeadLetterRoute.has(id) ? { kind: "add-dlq", node: id } : { kind: "events", node: id },
      });
      continue;
    }
    if (!spanned) continue;
    // A dead-letter queue keeps what it gets on purpose, read or not: its backlog is no trouble.
    if (!BROKERS.has(r) || (n.noConsumer && r !== "queue") || d.deadLetterTargets.has(id)) continue;
    const now = maxLag(n),
      before = oldest.lag.get(id) ?? 0,
      mid = middle.lag.get(id) ?? 0;
    if (
      now - before < threshold(before) ||
      mid < before ||
      now < mid ||
      now < (previous?.lag.get(id) ?? 0) ||
      now <= (recent.lag.get(id) ?? 0)
    )
      continue;
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
      related: behind?.members ?? [],
    });
  }
  return out.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || d.order.get(a.node)! - d.order.get(b.node)!);
}

/** What the callout remembers in one run: causes shown, causes over after being shown, causes dismissed. */
export interface TroubleMemory {
  shown: Set<string>;
  ended: Set<string>;
  dismissed: Set<string>;
}

/**
 * Notes which shown causes are over now. While the watcher\'s history is short (just after a seek or a restart),
 * a trend it can\'t see yet isn\'t over: rising lag and losses are only ended once it\'s warm again.
 */
export function noteEnded(current: readonly Trouble[], memory: TroubleMemory, warm = true): void {
  const keys = new Set(current.map((t) => t.key));
  for (const key of memory.shown) if (!keys.has(key) && (warm || key.startsWith("down:"))) memory.ended.add(key);
}

/** The worst cause not dismissed and not over after being shown in this run. Reads the memory only. */
export function selectTrouble(current: readonly Trouble[], memory: TroubleMemory): Trouble | undefined {
  return current.find((t) => !memory.dismissed.has(t.key) && !memory.ended.has(t.key));
}

/**
 * Which trouble the callout would show (each cause once per run): notes what\'s over, then selects. Showing it is
 * separate: only a callout actually on screen marks its cause shown (`memory.shown.add`), so one hidden behind a
 * panel or a presentation keeps its turn.
 */
export function pickTrouble(current: readonly Trouble[], memory: TroubleMemory, warm = true): Trouble | undefined {
  noteEnded(current, memory, warm);
  return selectTrouble(current, memory);
}

/**
 * Whether the trouble leads the capacity callout when both could show: always, unless it\'s a rising lag the plan
 * already diagnoses with its own action: the same broker (nobody reads it, or it\'s the bottleneck) or one of the
 * consumers behind it over capacity. An unrelated overload elsewhere never hides it.
 */
export function troubleLeads(
  trouble: Trouble,
  view: { tone: string; top?: { id: string }; addConsumer?: string } | null,
): boolean {
  if (!view || trouble.kind !== "lag") return true;
  if (view.addConsumer === trouble.node) return false;
  const top = view.top?.id;
  const overloaded = view.tone === "over" || view.tone === "hot";
  return !(overloaded && !!top && (top === trouble.node || !!trouble.related?.includes(top)));
}
