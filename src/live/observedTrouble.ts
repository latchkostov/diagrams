import type { DiagramFile, SimRole } from "../model/types";
import { flowEdges } from "../model/relations";
import { stencilRole } from "../stencils/roles";
import { compileTopology } from "../sim/topology";
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
  headline: string;
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
 * losing messages, then lag that rose over the last 10 s (and is still rising). Time going backwards (a restart,
 * a seek) starts the history again.
 */
export class TroubleWatcher {
  private samples: Sample[] = [];

  reset(): void {
    this.samples = [];
  }

  observe(frame: WatchedFrame, diagram: DiagramFile): Trouble[] {
    const last = this.samples.at(-1);
    if (last && frame.time < last.time) this.samples = [];
    if (!last || frame.time < last.time || frame.time - last.time >= SAMPLE_MS) {
      const lag = new Map<string, number>(),
        dropped = new Map<string, number>();
      for (const [id, n] of Object.entries(frame.nodes)) {
        lag.set(id, maxLag(n));
        dropped.set(id, n.dropped);
      }
      this.samples.push({ time: frame.time, lag, dropped });
      while (this.samples.length > 2 && this.samples[1].time <= frame.time - WINDOW_MS) this.samples.shift();
    }
    return troubles(frame, diagram, this.samples);
  }
}

function troubles(frame: WatchedFrame, d: DiagramFile, samples: readonly Sample[]): Trouble[] {
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const name = (id: string) => byId.get(id)?.label || id;
  const role = (id: string): SimRole | undefined => {
    const n = byId.get(id);
    return n ? stencilRole(n.stencil) : undefined;
  };
  const compiled = compileTopology(d);
  const flows = flowEdges(d.edges);
  const out: Trouble[] = [];
  const oldest = samples[0];
  const middle = samples[Math.floor(samples.length / 2)];
  const spanned = oldest && frame.time - oldest.time >= WINDOW_MS - SAMPLE_MS;
  // Lag must rise by more than noise: a few dots at this scale, and a fifth of what was there.
  const threshold = (before: number) => Math.max(10, 3 * (frame.scale ?? 1), 0.2 * before);

  for (const [id, n] of Object.entries(frame.nodes)) {
    const r = role(id);
    if (!r || r === "none" || r === "source") continue;
    if (n.status === "down") {
      const into = compiled.edges.filter((e) => e.to === id && !e.dlq);
      const brokers = into.length && into.every((e) => BROKERS.has(role(e.from)!)) ? into.map((e) => e.from) : [];
      let detail: string;
      if (BROKERS.has(r)) detail = "Messages sent to it are dropped until it's back.";
      else if (brokers.length) {
        // What waits for it: each feeding broker's lag in the groups it belongs to (a queue's whole backlog).
        const waiting = [...new Set(brokers)].reduce((sum, b) => {
          const groups = compiled.groups.get(b) ?? [];
          const lags = frame.nodes[b]?.lag ?? {};
          return sum + groups.filter((g) => g.members.includes(id)).reduce((s, g) => s + (lags[g.name] ?? 0), 0);
        }, 0);
        detail = waitDetail([...new Set(brokers.map(name))], waiting);
      } else detail = flows.some((e) => e.to === id) ? "Messages sent to it fail until it's back." : "";
      out.push({
        key: `down:${id}`,
        kind: "down",
        node: id,
        headline: `${name(id)} is down`,
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
        detail: broker
          ? "They ran out of deliveries and it has no dead-letter queue to keep them."
          : "Messages that fail here are dropped: nothing retries them.",
        action:
          broker && !compiled.edges.some((e) => e.from === id && e.dlq)
            ? { kind: "add-dlq", node: id }
            : { kind: "events", node: id },
      });
      continue;
    }
    if (!BROKERS.has(r) || (n.noConsumer && r !== "queue")) continue;
    const now = maxLag(n),
      before = oldest.lag.get(id) ?? 0,
      mid = middle.lag.get(id) ?? 0;
    if (now - before < threshold(before) || mid < before || now < mid) continue;
    if (n.noConsumer) {
      out.push({
        key: `lag:${id}`,
        kind: "lag",
        node: id,
        headline: `Nobody reads ${name(id)}`,
        detail: `Messages wait in it until a consumer takes them: ${formatCount(now)} so far, and rising.`,
        action: { kind: "add-consumer", node: id },
      });
      continue;
    }
    // Name who's behind: the members of the group with the most lag.
    const groups = compiled.groups.get(id) ?? [];
    const behind = groups.reduce<(typeof groups)[number] | undefined>(
      (worst, g) => ((n.lag[g.name] ?? 0) > (worst ? (n.lag[worst.name] ?? 0) : -1) ? g : worst),
      undefined,
    );
    const readers = behind ? brokerList(behind.members.map(name)) : "";
    out.push({
      key: `lag:${id}`,
      kind: "lag",
      node: id,
      headline: `${name(id)} is falling behind: lag ${formatCount(now)} and rising`,
      detail: readers
        ? `${readers} ${behind!.members.length > 1 ? "don't" : "doesn't"} keep up with it.`
        : "Its consumers don't keep up with it.",
      action: { kind: "inputs" },
    });
  }
  const order = new Map(d.nodes.map((n, i) => [n.id, i]));
  return out.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || order.get(a.node)! - order.get(b.node)!);
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
