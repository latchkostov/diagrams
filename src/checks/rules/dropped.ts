import { isBroker, listNames, type CheckContext } from "../context";
import type { CheckRule, Finding, FindingEvidence } from "../types";
import { deadLetterGap, isDeadLetterQueue } from "./deadLetter";

// 11. dropped: messages a saved simulation lost where no other check says so. Raised only by Run simulations
// (src/checks/evidence.ts), which plays the simulations and decides what's lost on purpose; this file only words
// the finding. Always a Suggestion: evidence never adds to the warnings under the title. Never a fix: Run
// simulations reports what happened and where; the static checks (dead-letter and the rest) offer the fixes.

const RATIONALE =
  "A message that fails where nothing can deliver it again, or that runs out of deliveries with no dead-letter route, is gone. " +
  "Whether that happens depends on the traffic and the failures a simulation plays, so only playing it shows where, and how many.";

/**
 * The `dropped` finding for node `id`, with what the simulations counted there. At a broker, `failing` are the
 * consumers that failed in the simulations that lost messages there.
 */
export function droppedFinding(
  ctx: CheckContext,
  id: string,
  evidence: FindingEvidence[],
  failing: readonly string[] = [],
): Finding {
  const name = ctx.name(id);
  const broker = isBroker(ctx, id);
  if (broker) {
    const what = deadLetterGap(ctx, id)?.route
      ? `${name}'s dead-letter route doesn't take them`
      : isDeadLetterQueue(ctx, id)
        ? `${name} is itself a dead-letter queue`
        : `${name} has no dead-letter queue`;
    return {
      id: `dropped:${id}`,
      rule: "dropped",
      severity: "suggestion",
      target: id,
      elements: [id, ...failing],
      title: `Messages are lost at ${name}`,
      message: `Messages ${failing.length ? `${listNames(failing.map(ctx.name))} kept failing` : "that kept failing"} ran out of deliveries and were lost: ${what}.`,
      rationale: RATIONALE,
      evidence,
    };
  }
  const requests = ctx.incoming(id).some((e) => e.sync);
  return {
    id: `dropped:${id}`,
    rule: "dropped",
    severity: "suggestion",
    target: id,
    elements: [id],
    title: `Failed ${requests ? "requests" : "messages"} to ${name} are lost`,
    message: `${name} fails some of what it's sent, and nothing delivers it again: there's no queue or topic in front of it to redeliver.`,
    rationale: RATIONALE,
    evidence,
  };
}

export const dropped: CheckRule = {
  id: "dropped",
  name: "Messages are lost in a simulation",
  about:
    "Run simulations plays the diagram's saved simulations and reports messages they lose that no other check explains. " +
    "Only on demand, and never for losses a simulation causes on purpose: at a node it takes down or makes fail, or counts its own expectations name.",
  onDemand: true,
  detect: () => [],
};
