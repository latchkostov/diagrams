import type { EdgeSimState, NodeSimState } from "../sim/types";

/** Health is observational, in simulation time. Outcomes remain cumulative since restart. */
export const HEALTH_WINDOW_MS = 10_000;
export const HEALTH_SAMPLE_MS = 1_000;
export const queueGrowthThreshold = (before: number, scale = 1) => Math.max(10, 3 * scale, 0.2 * before);
export const retryPressure = (c: Partial<NonNullable<EdgeSimState["calls"]>>) =>
  (c.windowRequests ?? 0) > 0 && (c.windowAttempts ?? 0) / c.windowRequests! >= 1.2 && (c.windowRetried ?? 0) >= 10;

type Recent = {
  failed: number;
  timedOut: number;
  dropped: number;
  rejected: number;
  succeeded: number;
  growing: boolean;
  breaker: boolean;
};
const neutral: Recent = {
  failed: 0,
  timedOut: 0,
  dropped: 0,
  rejected: 0,
  succeeded: 0,
  growing: false,
  breaker: false,
};
const readings = new WeakMap<object, Recent>();
export const currentHealth = (metrics: object | undefined): Readonly<Recent> =>
  (metrics && readings.get(metrics)) || neutral;

export function callsSucceeding(calls: EdgeSimState["calls"]): boolean {
  const recent = currentHealth(calls);
  return recent.succeeded > 0 && recent.failed === 0 && recent.timedOut === 0;
}

type Frame = {
  time: number;
  scale?: number;
  nodes: Record<string, Pick<NodeSimState, "failed" | "dropped" | "rejected" | "backlog">>;
  edges: Record<string, Pick<EdgeSimState, "calls" | "breaker">>;
};
type Sample = { time: number; nodes: Record<string, number[]>; edges: Record<string, number[]> };
const nodeCounts = (n: Frame["nodes"][string]) => [n.failed, n.dropped, n.rejected ?? 0, n.backlog];
const callCounts = (c: EdgeSimState["calls"]) => [c?.failed ?? 0, c?.timedOut ?? 0, c?.succeeded ?? 0];

/** One bounded history per Live controller, shared by cards, badges, Properties and trouble announcements.
 * Rebuilds start a new interval; checkpoints preserve observations while seeking. Unknown history never invents an incident. */
export class HealthWindow {
  private samples: Sample[] = [];
  private generation: unknown;
  checkpoint(): Sample[] {
    return [...this.samples];
  }

  restore(samples: Sample[], generation: unknown): void {
    this.samples = [...samples];
    this.generation = generation;
  }

  observe(frame: Frame, generation: unknown, countScale = 1): void {
    const last = this.samples.at(-1);
    if (
      generation !== this.generation ||
      (last && (frame.time < last.time || frame.time - last.time > HEALTH_WINDOW_MS))
    )
      this.samples = [];
    this.generation = generation;
    while (this.samples.length > 1 && this.samples[1].time <= frame.time - HEALTH_WINDOW_MS) this.samples.shift();
    const oldest = this.samples[0];
    const middle = this.samples[Math.floor(this.samples.length / 2)];
    const recent = this.samples.at(-2);
    const delta = (now: number, before: number | undefined) => (before === undefined ? 0 : Math.max(0, now - before));
    for (const [id, n] of Object.entries(frame.nodes)) {
      const before = oldest?.nodes[id];
      const growing =
        !!before &&
        frame.time - oldest.time >= HEALTH_WINDOW_MS - HEALTH_SAMPLE_MS &&
        n.backlog - before[3] >= queueGrowthThreshold(before[3] * countScale, frame.scale) / countScale &&
        (middle?.nodes[id]?.[3] ?? 0) >= before[3] &&
        n.backlog >= (middle?.nodes[id]?.[3] ?? 0) &&
        n.backlog > (recent?.nodes[id]?.[3] ?? n.backlog) &&
        n.backlog >= (last?.nodes[id]?.[3] ?? 0);
      readings.set(n, {
        ...neutral,
        failed: delta(n.failed, before?.[0]),
        dropped: delta(n.dropped, before?.[1]),
        rejected: delta(n.rejected ?? 0, before?.[2]),
        growing,
      });
    }
    for (const [id, e] of Object.entries(frame.edges)) {
      if (!e.calls) continue;
      const before = oldest?.edges[id];
      readings.set(e.calls, {
        ...neutral,
        failed: delta(e.calls.failed, before?.[0]),
        timedOut: delta(e.calls.timedOut, before?.[1]),
        succeeded: delta(e.calls.succeeded ?? 0, before?.[2]),
        breaker: !!e.breaker && e.breaker.state !== "closed",
      });
    }
    if (!this.samples.length || frame.time - this.samples.at(-1)!.time >= HEALTH_SAMPLE_MS)
      this.samples.push({
        time: frame.time,
        nodes: Object.fromEntries(Object.entries(frame.nodes).map(([id, n]) => [id, nodeCounts(n)])),
        edges: Object.fromEntries(Object.entries(frame.edges).map(([id, e]) => [id, callCounts(e.calls)])),
      });
  }
}
