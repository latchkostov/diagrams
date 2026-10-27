import type { NodeSimState } from "../sim/types";

/** Production playback readouts, owned by Live rather than the shell's JSX attribute table. */
export function badgeAttributes(s: NodeSimState, rejected: number) {
  const values = {
    status: s.status,
    ready: s.fleet?.ready,
    starting: s.fleet?.starting,
    desired: s.fleet?.desired,
    cpu: s.resources?.cpuRequestPct,
    processed: s.processed,
    backlog: s.backlog,
    inflight: s.inFlight,
    failed: s.failed,
    dropped: s.dropped,
    dlq: s.deadLettered,
    blocked: s.blocked ?? 0,
    rejected,
  };
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [`data-${name}`, value]));
}
