// Where Ask AI is being used, and what that changes: the panel's heading and suggestions, what the
// request is about (a selection), and what's running in live view. Pure, so it's unit-tested and the
// prompt builders and the model share it.

import type { DiagramFile } from "../../model/types";
import type { LiveState } from "../../live/controller";

/** "create": an empty diagram; "edit": the editor; "live": live view. */
export type AiPlace = "create" | "edit" | "live";
export type AiIntent = "change" | "explain";

export function aiPlace(diagram: DiagramFile | null, live: boolean): AiPlace {
  if (live) return "live";
  return !diagram || (!diagram.nodes.length && !diagram.annotations?.length) ? "create" : "edit";
}

export interface Suggestion {
  /** Short words on the chip. */
  label: string;
  /** What goes in the request box. */
  request: string;
  intent: AiIntent;
}

const s = (label: string, request = label, intent: AiIntent = "change"): Suggestion => ({ label, request, intent });

/** Suggestion chips for an empty conversation. */
export function suggestions(place: AiPlace, scoped: boolean): Suggestion[] {
  if (place === "create")
    return [
      s(
        "An order pipeline on Kafka",
        "An orders API publishes OrderPlaced to a Kafka topic; inventory, payments and notification services consume it, each with its own database.",
      ),
      s(
        "A web app with a cache",
        "A browser calls an API gateway, which calls a .NET API that reads through a Redis cache from PostgreSQL.",
      ),
      s(
        "Event-driven on Azure",
        "An Azure Function receives webhooks and puts them on a Service Bus queue; a worker processes them into Cosmos DB, with a dead-letter queue for failures. Put it in an Azure boundary.",
      ),
    ];
  if (place === "live")
    return [
      s("A storm at 9am", "A storm of 100 new orders at the start, then steady traffic for a minute."),
      s(
        "A dependency fails",
        "Steady traffic, then the busiest downstream service goes down at 20 seconds and comes back at 40.",
      ),
      s("A slow ramp", "Traffic ramps from 1 to 20 messages per second over two minutes."),
      s("What's happening?", "What's happening right now, and where is the bottleneck?", "explain"),
    ];
  if (scoped)
    return [
      s("Scale it out", "Run these with 3 replicas."),
      s("Add a retry queue", "Add a retry queue with a dead-letter queue after these."),
      s("Explain these", "What do these do, and what depends on them?", "explain"),
    ];
  return [
    s("Add a cache", "Put a Redis cache in front of the busiest database."),
    s("Add a dead-letter queue", "Add a dead-letter queue for messages that keep failing."),
    s("Group into boundaries", "Group the nodes into boundaries by cloud or team."),
    s("Explain this diagram", "Explain what this system does, step by step.", "explain"),
  ];
}

export function emptyHeading(place: AiPlace, scoped: boolean): { title: string; text: string } {
  if (place === "create")
    return {
      title: "Build with AI",
      text: "Describe the system you want: the services, queues and databases, and how messages flow between them.",
    };
  if (place === "live")
    return {
      title: "Simulate a scenario",
      text: "Describe traffic and failures in plain words. It becomes a saved simulation and plays straight away.",
    };
  if (scoped)
    return {
      title: "Change the selection",
      text: "Your request is about the elements on the chip. Each change is one undo step.",
    };
  return {
    title: "Change this diagram",
    text: "Ask for a change in plain words. Each change is one undo step, and you can revert to any earlier one.",
  };
}

export interface ScopeItem {
  id: string;
  label: string;
  kind: "node" | "connection" | "boundary";
}

/** The ids that still exist, with their labels and kinds. */
export function resolveScope(diagram: DiagramFile, ids: readonly string[]): ScopeItem[] {
  const out: ScopeItem[] = [];
  for (const id of ids) {
    const node = diagram.nodes.find((n) => n.id === id);
    if (node) {
      out.push({ id, label: node.label || id, kind: "node" });
      continue;
    }
    const edge = diagram.edges.find((e) => e.id === id);
    if (edge) {
      const name = (nid: string) => diagram.nodes.find((n) => n.id === nid)?.label || nid;
      out.push({ id, label: edge.label || `${name(edge.from)} → ${name(edge.to)}`, kind: "connection" });
      continue;
    }
    const group = diagram.groups?.find((g) => g.id === id);
    if (group) out.push({ id, label: group.label || id, kind: "boundary" });
  }
  return out;
}

/** The lines that name the selection as the request's targets (for the prompt and the model). */
export function scopeText(scope: readonly ScopeItem[]): string {
  if (!scope.length) return "";
  return [
    "The request is about these selected elements (its targets; change others only if the request needs it):",
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
