import type { CheckRule, Finding } from "../types";
import type { CheckContext } from "../context";
import type { MessageLoop } from "../../model/messageTypes";
import { findingBudget, findingName, omission } from "../findingBudget";
import { stronglyConnected } from "../../model/stronglyConnected";

/**
 * Timeline props cannot add connections or change roles. Include every processor flow, even denied,
 * filtered, zero-share and dead-letter ones: an acyclic superset proves no processor loop at any time,
 * including messages in flight across edits. This does not claim complete arriving/carried type sets.
 */
function mayHaveProcessorCycle(ctx: CheckContext): boolean {
  const processors = new Set(
    ctx.diagram.nodes.filter((node) => ["processor", "none"].includes(ctx.role(node.id))).map((node) => node.id),
  );
  const outgoing = new Map<string, string[]>();
  for (const edge of ctx.topology.edges) {
    if (!processors.has(edge.from) || !processors.has(edge.to)) continue;
    const targets = outgoing.get(edge.from) ?? [];
    targets.push(edge.to);
    outgoing.set(edge.from, targets);
  }
  return stronglyConnected([...processors], (id) => outgoing.get(id) ?? []).some(
    (component) => component.length > 1 || outgoing.get(component[0])?.includes(component[0]),
  );
}

/** Every authored string occurrence that the finding will copy, before building its text or elements array. */
function* outputStrings(loop: MessageLoop, type: string, node: string) {
  yield loop.node; // id suffix
  yield loop.node; // target
  yield type;
  yield node; // message
  yield type;
  yield node; // messageLoop metadata
  yield* loopElements(loop);
}

/** The finding copies each element only once, even when several typed states revisit it. */
function* loopElements(loop: MessageLoop) {
  const seen = new Set([loop.node]);
  yield loop.node;
  for (const step of loop.steps) {
    for (const id of [step.from, step.to, step.edge]) {
      if (seen.has(id)) continue;
      seen.add(id);
      yield id;
    }
  }
}

export const messageLoop: CheckRule = {
  id: "message-loop",
  name: "Messages loop back",
  about: "Finds message types forwarded around a processor cycle. Retries and broker redelivery do not count.",
  detect(ctx) {
    const types = ctx.messageTypes();
    // Automatic fixes are quarantined: transition membership cannot prove per-input path preservation.
    // Keep the verifier in messageLoopFix.ts for docs/backlog/2026-10-23-message-loop-fix-quarantine.md.
    // One finding per node, with manual guidance for every typed loop reported there.
    const byNode = new Map<string, MessageLoop>();
    for (const loop of types.loops) {
      if (!byNode.has(loop.node)) byNode.set(loop.node, loop);
    }
    const budget = findingBudget();
    let omitted = 0;
    const findings: Finding[] = [];
    for (const loop of byNode.values()) {
      const node = findingName(ctx.name(loop.node));
      const type = findingName(loop.type);
      if (!budget.take(outputStrings(loop, type, node))) {
        omitted++;
        continue;
      }
      findings.push({
        id: `message-loop:${loop.node}`,
        rule: "message-loop" as const,
        severity: "warning" as const,
        target: loop.node,
        elements: [...loopElements(loop)],
        title: "Messages loop back",
        message: `${type} messages loop back to ${node}: each one is sent again.`,
        messageLoop: { type, node },
        rationale:
          "No single filter or rename was verified to preserve the other message paths. Choose where the callback should stop, then check again.",
      });
    }
    if (omitted) findings.push(omission("message-loop", omitted));
    const timelineOnly = types.incompleteReasons?.length === 1 && types.incompleteReasons[0] === "timeline-forwarding";
    if (!types.complete && (!timelineOnly || mayHaveProcessorCycle(ctx)))
      findings.push({
        id: "message-loop:incomplete",
        scope: "diagram",
        target: "",
        rule: "message-loop",
        severity: "warning",
        elements: [],
        title: "Message type propagation incomplete",
        message: types.incompleteReasons?.includes("timeline-forwarding")
          ? "Timeline forwarding edits cannot be analyzed completely."
          : "The message path budget was reached.",
        rationale: [
          ...(types.incompleteReasons?.includes("timeline-forwarding")
            ? ["Review message paths before and after timeline forwarding edits manually."]
            : []),
          ...(!types.incompleteReasons?.length || types.incompleteReasons.includes("work-budget")
            ? ["Check a smaller diagram to enumerate every message path."]
            : []),
        ].join(" "),
      });
    return findings;
  },
};
