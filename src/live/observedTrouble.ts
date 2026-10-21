import type { DiagramFile, SimRole } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { brokerFeeds, compileTopology, deadLetterRoutes, type CompiledGroup } from "../sim/topology";
import type { NodeStatus } from "../sim/types";
import { formatCount } from "./format";
import { formatList } from "../i18n/format";
import { t, getLocale } from "../i18n";
import type { NodeSimState } from "../sim/types";
import { callPolicy } from "../sim/callPolicy";
import { affordableTimeout } from "./affordableTimeout";
import type { EdgeSimProps } from "../sim/types";
import { waitingDetails } from "./waitingDetails";
import type { Fault } from "../model/faults";
import { resolveNodeProps } from "../sim/defaults";
import { resolvedTiming } from "../sim/timing";

// What playback shows going wrong, whatever the plan says (docs/research/sim-flows-review.md, F-1, F-5, F-32): a node
// that's down, a node losing messages, a broker whose lag keeps rising. The live callout reports it on its own, with
// one action each, so "Healthy" never sits over a backlog that only grows. Pure: it reads real-unit snapshots.

/** How far back "rising" and "losing" look, in simulated time. */
export const WINDOW_MS = 10_000;
const SAMPLE_MS = 1_000;

export type TroubleKind = "down" | "dropping" | "threads-exhausted" | "lag";
export type TroubleAction =
  | {
      kind: "scale-threads";
      changes: { node: string; props: Record<string, unknown> }[];
      plan: NonNullable<import("../checks/types").Finding["scalingPlan"]>;
    }
  | { kind: "free-thread"; edge: string }
  | { kind: "add-timeout"; edge: string; deadlineMs: number }
  | { kind: "restore-boundary"; boundary: string; label: string }
  | { kind: "clear-fault"; node: string }
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
  threads?: NodeSimState["threads"];
  backlog?: number;
  status: NodeStatus;
  lag: Record<string, number>;
  dropped: number;
  outageDropped?: number;
  noConsumer?: true;
  processed?: number;
  failed?: number;
  inFlight?: number;
  fleet?: NodeSimState["fleet"];
}
export interface WatchedFrame {
  faults?: readonly Fault[];
  expectedTimeouts?: ReadonlySet<string>;
  time: number;
  /** Real messages per dot (default 1). */
  scale?: number;
  nodes: Record<string, WatchedNode>;
  edges?: Record<string, { calls?: { timedOut: number } }>;
}

interface Sample {
  exhausted: Map<string, { edge: string; count: number }>;
  time: number;
  lag: Map<string, number>;
  dropped: Map<string, number>;
  outageDropped: Map<string, number>;
  arrivals: Map<string, number>;
}

const BROKERS: ReadonlySet<SimRole> = new Set(["queue", "topic", "stream"]);
const maxLag = (n: WatchedNode) => Math.max(n.backlog ?? 0, ...Object.values(n.lag), 0);
const KIND_ORDER: Record<TroubleKind, number> = { down: 0, "threads-exhausted": 1, dropping: 2, lag: 3 };

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
        exhausted = new Map<string, { edge: string; count: number }>(),
        dropped = new Map<string, number>(),
        outageDropped = new Map<string, number>(),
        arrivals = new Map<string, number>();
      for (const [id, n] of Object.entries(frame.nodes)) {
        lag.set(id, maxLag(n));
        const t = n.threads;
        if (t && t.waiting > 0 && t.waiting >= t.slots / 2 && t.working + t.waiting >= t.slots && t.waitingOn[0])
          exhausted.set(id, { edge: t.waitingOn[0][0], count: t.waitingOn[0][1] });
        dropped.set(id, n.dropped);
        outageDropped.set(id, n.outageDropped ?? 0);
        if (n.processed !== undefined)
          arrivals.set(id, n.processed + (n.failed ?? 0) + (n.inFlight ?? 0) + (n.backlog ?? 0));
      }
      this.samples.push({ time: frame.time, lag, dropped, outageDropped, exhausted, arrivals });
      while (this.samples.length > 2 && this.samples[1].time <= frame.time - WINDOW_MS) this.samples.shift();
      sampled = true;
    }
    let statuses = `${getLocale()}:${JSON.stringify(frame.faults ?? [])}`,
      losses = "";
    for (const [id, n] of Object.entries(frame.nodes)) {
      if (n.status !== "up") statuses += `${id}:${n.status};`;
      if (n.threads) statuses += `${id}:${n.threads.waiting}:${n.threads.working};`;
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
  targets: Map<string, string>;
  deadlines: Map<string, number | undefined>;
  responses: Map<string, number>;
  sources: Map<string, string>;
  incomingTimeouts: Map<string, string[]>;
  outgoingCalls: Map<string, string[]>;
  cyclic: Set<string>;
}

const shapes = new WeakMap<DiagramFile, Shape>();
function shapeOf(d: DiagramFile): Shape {
  const known = shapes.get(d);
  if (known) return known;
  const labels = new Map(d.nodes.map((n) => [n.id, n.label || n.id]));
  const role = new Map(d.nodes.map((n) => [n.id, stencilRole(n.stencil)]));
  const nodes = new Map(d.nodes.map((n) => [n.id, n]));
  const plan = waitingDetails(d, Object.fromEntries(d.nodes.map((n) => [n.id, n.props ?? {}])));
  const responses = new Map(
    Array.from(new Set(d.edges.map((e) => e.to)), (id) => {
      const target = nodes.get(id);
      return [
        id,
        plan?.nodes.get(id)?.memoryResidenceMs ?? (target ? resolvedTiming(resolveNodeProps(d, target)).workMs : 0),
      ] as const;
    }),
  );
  const deadlines = new Map<string, number | undefined>();
  const callResponses = new Map(
    d.edges.map((e) => {
      deadlines.set(
        e.id,
        callPolicy(nodes.get(e.from)?.stencil ?? "", e.props?.caller as EdgeSimProps["caller"]).deadlineMs,
      );
      return [
        e.id,
        responses.get(e.to)! + 2 * (typeof e.props?.networkDelayMs === "number" ? e.props.networkDelayMs : 0),
      ];
    }),
  );
  const incomingTimeouts = new Map<string, string[]>(),
    outgoingCalls = new Map<string, string[]>();
  for (const e of d.edges) {
    if (e.kind !== "sync" || (e.relation && e.relation !== "flow")) continue;
    const outgoing = outgoingCalls.get(e.from) ?? [];
    outgoing.push(e.id);
    outgoingCalls.set(e.from, outgoing);
    if (deadlines.get(e.id) === undefined) continue;
    const incoming = incomingTimeouts.get(e.to) ?? [];
    incoming.push(e.id);
    incomingTimeouts.set(e.to, incoming);
  }
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
    targets: new Map(d.edges.map((e) => [e.id, e.to])),
    deadlines,
    incomingTimeouts,
    outgoingCalls,
    responses: callResponses,
    sources: new Map(d.edges.map((e) => [e.id, e.from])),
    cyclic: new Set([...(plan?.nodes ?? [])].filter(([, n]) => !Number.isFinite(n.threadHoldMs)).map(([id]) => id)),
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
        detail =
          waiting > 0
            ? t("trouble.waitingCount", { names: formatList(feeds.map(name)), count: formatCount(waiting) })
            : t("trouble.waiting", { names: formatList(feeds.map(name)) });
      } else if (feeds === null) detail = BROKERS.has(r) ? t("trouble.downBroker") : t("trouble.downService");
      else detail = "";
      out.push({
        key: `down:${id}`,
        kind: "down",
        node: id,
        headline: t("trouble.down", { name: name(id) }),
        announce: t("trouble.down", { name: name(id) }),
        detail,
        action: { kind: "revive", node: id },
      });
      continue;
    }
    let exhausted: { edge: string; count: number } | undefined;
    for (let i = samples.length - 1; i >= 0 && !exhausted; i--) exhausted = samples[i].exhausted.get(id);
    if (spanned && n.threads && exhausted && !n.fleet?.starting) {
      const { edge } = exhausted;
      const feeds = d.memberships.get(id) ?? [];
      const rising =
        maxLag(n) > (oldest.lag.get(id) ?? 0) ||
        feeds.some(({ broker }) => maxLag(frame.nodes[broker]) > (oldest.lag.get(broker) ?? 0));
      if (edge && rising) {
        const target = d.targets.get(edge)!;
        const stalled =
          d.cyclic.has(id) ||
          frame.nodes[target]?.status !== "up" ||
          frame.faults?.some(
            (f) =>
              (f.kind === "link" && f.edge === edge && f.cut) ||
              (f.kind === "slow" && f.node === target && f.factor > 1),
          );
        const before = oldest.arrivals.get(id);
        const elapsed = frame.time - oldest.time;
        const total =
          n.processed === undefined ? undefined : n.processed + (n.failed ?? 0) + (n.inFlight ?? 0) + (n.backlog ?? 0);
        const rate =
          before === undefined || total === undefined || elapsed <= 0
            ? 0
            : (Math.max(0, total - before) * 1000) / elapsed;
        const deadlineMs = affordableTimeout(d.responses.get(edge) ?? 0, n.threads.slots, rate);
        const timeout = d.deadlines.get(edge) === undefined && stalled && deadlineMs !== undefined;
        const upstream = d.incomingTimeouts
          .get(id)
          ?.find((incoming) => (frame.edges?.[incoming]?.calls?.timedOut ?? 0) > 0);
        const detail = d.cyclic.has(id)
          ? t("threads.deadlocked")
          : t("threads.exhaustedDetail", { count: exhausted.count, name: name(target) });
        out.push({
          key: `threads-exhausted:${id}`,
          kind: "threads-exhausted",
          node: id,
          headline: t("threads.exhausted", { name: name(id) }),
          announce: t("threads.exhausted", { name: name(id) }),
          detail: upstream
            ? t("threads.exhaustedTimeout", {
                cause: detail,
                name: name(d.sources.get(upstream)!),
                seconds: d.deadlines.get(upstream)! / 1000,
              })
            : detail,
          action: timeout ? { kind: "add-timeout", edge, deadlineMs: deadlineMs! } : { kind: "free-thread", edge },
        });
        continue;
      }
    }
    // Loss needs no long history: a short run that drops one message says so.
    const lost = oldest ? n.dropped - (oldest.dropped.get(id) ?? 0) : 0;
    if (lost > 0) {
      const broker = BROKERS.has(r);
      const outage = (n.outageDropped ?? 0) - (oldest?.outageDropped.get(id) ?? 0);
      const exhausted = broker && lost > outage;
      const timeoutEdge = d.outgoingCalls
        .get(id)
        ?.find((edge) => !frame.expectedTimeouts?.has(edge) && (frame.edges?.[edge]?.calls?.timedOut ?? 0) > 0);
      const timeoutCount = timeoutEdge ? (frame.edges?.[timeoutEdge]?.calls?.timedOut ?? 0) : 0;
      const timeoutMs = timeoutEdge ? d.deadlines.get(timeoutEdge) : undefined;
      out.push({
        key: `dropping:${id}`,
        kind: "dropping",
        node: id,
        headline:
          timeoutMs !== undefined
            ? t("trouble.timedOut", { name: name(id), count: timeoutCount, seconds: timeoutMs / 1000 })
            : t("trouble.dropping", { name: name(id), count: formatCount(n.dropped) }),
        announce:
          timeoutMs !== undefined
            ? t("trouble.timeoutAnnounce", { name: name(id) })
            : t("trouble.lossAnnounce", { name: name(id) }),
        detail: broker && !exhausted ? t("trouble.outageLoss") : broker ? t("trouble.noDlq") : t("trouble.noRetry"),
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
        headline: t("trouble.noReader", { name: name(id) }),
        announce: t("trouble.noReader", { name: name(id) }),
        detail: t("trouble.kept", { count: formatCount(now) }),
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
    const readers = behind ? formatList(behind.members.map(name)) : "";
    out.push({
      key: `lag:${id}`,
      kind: "lag",
      node: id,
      headline: t("trouble.lag", { name: name(id), count: formatCount(now) }),
      announce: t("trouble.lagAnnounce", { name: name(id) }),
      detail:
        behind && readers
          ? t("trouble.readers", { names: readers, count: behind.members.length })
          : t("trouble.consumers"),
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
