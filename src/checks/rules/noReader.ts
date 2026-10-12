import { isBroker, listNames } from "../context";
import type { CheckRule, Finding } from "../types";
import { isDeadLetterQueue } from "./deadLetter";

// 2. no-reader: a broker with incoming flows and no ordinary route out. Its backlog only grows (in live view
// its capacity is zero). A Warning; a dead-letter queue nobody reads is a Suggestion ("Dead letters pile up"),
// since someone should read or alert on it, but replay is often a manual runbook outside the diagram.

export const noReader: CheckRule = {
  id: "no-reader",
  name: "Nobody reads a topic or queue",
  about:
    "A topic or queue that receives messages and has no consumer only grows; in live view its backlog climbs. " +
    "Fires for a broker with incoming flows and no route out: a suggestion when it's a dead-letter queue.",
  detect(ctx) {
    const out: Finding[] = [];
    for (const node of ctx.diagram.nodes) {
      const id = node.id;
      if (!isBroker(ctx, id) || ctx.routes(id).length) continue;
      const incoming = ctx.incoming(id);
      if (!incoming.length) continue;
      const producers = [...new Set(incoming.map((e) => e.from))];
      const name = ctx.name(id);
      const choice = `Pick what reads ${name}, then add it and connect ${id} to it.`;
      if (isDeadLetterQueue(ctx, id)) {
        out.push({
          id: `no-reader:${id}`,
          rule: "no-reader",
          severity: "suggestion",
          target: id,
          elements: [id, ...producers],
          title: `Dead letters pile up in ${name}`,
          message: `Nothing in the diagram reads or alerts on ${name}: failed messages stay there until someone looks.`,
          rationale:
            "A dead-letter queue has no automatic cleanup. Someone should be told when messages land there, and be able to replay them.",
          fix: { label: "Add a reader…", choice },
        });
      } else {
        out.push({
          id: `no-reader:${id}`,
          rule: "no-reader",
          severity: "warning",
          target: id,
          elements: [id, ...producers],
          title: `Nobody reads ${name}`,
          message: `${listNames(producers.map(ctx.name))} send${producers.length === 1 ? "s" : ""} to ${name}, but nothing consumes it: messages pile up.`,
          rationale:
            "A topic or queue with producers and no consumers only grows. Every message sent to a topic should have at least one subscription that reads it.",
          fix: { label: "Add a consumer…", choice },
        });
      }
    }
    return out;
  },
};
