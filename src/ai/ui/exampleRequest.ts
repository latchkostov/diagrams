import type { DiagramFile, DiagramNode } from "../../model/types";
import { getStencil } from "../../stencils/registry";

// The idle AI panel's "Copy example request": a request someone can paste into their browser's AI
// assistant, naming a real node of the diagram so it works as it is.

const named = (n: DiagramNode) => !!n.label?.trim();

/**
 * A sample request for this diagram. Editing: a dead-letter queue after a service that consumes
 * messages, else a cache in front of a database, else a change next to the first named node. Live view
 * only offers reading tools, so there it asks for an explanation. An empty diagram gets a whole one.
 */
export function exampleRequest(diagram: DiagramFile | null, live = false): string {
  const nodes = (diagram?.nodes ?? []).filter(named);
  const label = (n: DiagramNode) => n.label.trim();
  if (!nodes.length)
    return "Draw a Kafka topic orders.created consumed by a .NET service billing-worker that writes to PostgreSQL";
  const role = (n: DiagramNode) => getStencil(n.stencil).simRole;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // A processor fed by an async edge from a queue or topic: the classic place for a dead-letter queue.
  const consumer = (diagram?.edges ?? [])
    .filter((e) => (e.kind ?? "async") === "async" && !e.relation)
    .map((e) => ({ from: byId.get(e.from), to: byId.get(e.to) }))
    .find(
      ({ from, to }) => from && to && role(to) === "processor" && getStencil(from.stencil).category === "messaging",
    )?.to;
  if (live) return `Explain what happens to a message when it reaches ${label(consumer ?? nodes[0])}`;
  if (consumer) return `Add a dead-letter queue after ${label(consumer)}`;
  const store = nodes.find((n) => role(n) === "store");
  if (store) return `Add a Redis cache in front of ${label(store)}`;
  return `Add a Kafka topic after ${label(nodes[0])}`;
}
