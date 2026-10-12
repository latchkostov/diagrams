// Where the AI panel is being used and what that changes: the kind of prompt Advanced copies, the
// elements Copy for AI names, and what's running in live view. Pure, so it's unit-tested.

import type { DiagramFile } from "../../model/types";
import type { LiveState } from "../../live/controller";

/** "create": an empty diagram; "edit": the editor; "live": live view. */
export type AiPlace = "create" | "edit" | "live";
export type AiIntent = "change" | "explain";

export function aiPlace(diagram: DiagramFile | null, live: boolean): AiPlace {
  if (live) return "live";
  return !diagram || (!diagram.nodes.length && !diagram.annotations?.length) ? "create" : "edit";
}

export interface ScopeItem {
  id: string;
  label: string;
  kind: "node" | "connection" | "boundary";
}

/** The ids that still exist, with their labels and kinds. */
export function resolveScope(diagram: DiagramFile, ids: readonly string[]): ScopeItem[] {
  if (!ids.length) return [];
  // Maps, not a search per id: a big selection on a big diagram stays linear.
  const nodes = new Map(diagram.nodes.map((n) => [n.id, n]));
  const edges = new Map(diagram.edges.map((e) => [e.id, e]));
  const groups = new Map((diagram.groups ?? []).map((g) => [g.id, g]));
  const name = (nid: string) => nodes.get(nid)?.label || nid;
  const out: ScopeItem[] = [];
  for (const id of ids) {
    const node = nodes.get(id);
    if (node) {
      out.push({ id, label: node.label || id, kind: "node" });
      continue;
    }
    const edge = edges.get(id);
    if (edge) {
      out.push({ id, label: edge.label || `${name(edge.from)} → ${name(edge.to)}`, kind: "connection" });
      continue;
    }
    const group = groups.get(id);
    if (group) out.push({ id, label: group.label || id, kind: "boundary" });
  }
  return out;
}

/**
 * Copy for AI: the selected elements as text for the person to give their agent ("change these"): the
 * diagram's title, then each element's id and label, so an agent finds them with describe_diagram.
 */
export function referenceText(title: string, scope: readonly ScopeItem[]): string {
  return [
    `In my Diagrams diagram ${JSON.stringify(title)} (https://www.livediagrams.dev), these elements:`,
    ...scope.map((s) => `- ${s.kind} ${JSON.stringify(s.id)} ${JSON.stringify(s.label)}`),
  ].join("\n");
}

const clock = (ms: number) => {
  const sec = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};
const round = (n: number) => (Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 10) / 10);

/** What's running in live view, in a few lines a model can read. */
export function liveText(
  state: Pick<LiveState, "playing" | "simulation" | "snapshot" | "run">,
  diagram: DiagramFile,
  maxNodes = 8,
): string {
  const label = (id: string) => diagram.nodes.find((n) => n.id === id)?.label || id;
  const lines = [
    `Live view, ${state.playing ? "playing" : "paused"}: ${
      state.simulation
        ? `simulation ${JSON.stringify(state.simulation.title)} at ${clock(state.run?.time ?? state.snapshot.time)}${
            state.run ? ` of ${clock(state.run.totalMs)}` : ""
          }`
        : `free play at ${clock(state.snapshot.time)}`
    }. ${round(state.snapshot.inSystem)} messages in flight.`,
  ];
  const nodes = Object.values(state.snapshot.nodes)
    .filter((n) => n.status !== "up" || n.backlog || n.inFlight || n.failed || n.deadLettered || n.dropped)
    .sort((a, b) => b.backlog + b.inFlight - (a.backlog + a.inFlight))
    .slice(0, maxNodes);
  if (nodes.length) {
    lines.push("Busiest nodes now:");
    for (const n of nodes) {
      const parts = [
        n.status !== "up" ? n.status : "",
        `backlog ${round(n.backlog)}`,
        `in process ${round(n.inFlight)}`,
        `${round(n.throughput)}/s`,
        n.failed ? `${round(n.failed)} failed` : "",
        n.deadLettered ? `${round(n.deadLettered)} dead-lettered` : "",
        n.dropped ? `${round(n.dropped)} dropped` : "",
      ].filter(Boolean);
      lines.push(`- ${JSON.stringify(n.id)} ${JSON.stringify(label(n.id))}: ${parts.join(", ")}`);
    }
  }
  const failing = state.run?.expectations.filter((e) => e.status === "fail") ?? [];
  if (failing.length) lines.push(`Failing expectations: ${failing.map((e) => JSON.stringify(e.label)).join(", ")}`);
  return lines.join("\n");
}
