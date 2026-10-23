import type { CheckRule, Finding } from "../types";
import type { MessageLoop } from "../../model/messageTypes";
import { findingBudget, findingName, omission } from "../findingBudget";

/** Every authored string occurrence that the finding will copy, before building its text or elements array. */
function* outputStrings(loop: MessageLoop, type: string, node: string) {
  yield loop.node; // id suffix
  yield loop.node; // target
  yield loop.node; // first element
  yield type;
  yield node; // message
  yield type;
  yield node; // messageLoop metadata
  for (const step of loop.steps) {
    yield step.from;
    yield step.to;
    yield step.edge;
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
        elements: [...new Set([loop.node, ...loop.steps.flatMap((step) => [step.from, step.to, step.edge])])],
        title: "Messages loop back",
        message: `${type} messages loop back to ${node}: each one is sent again.`,
        messageLoop: { type, node },
        rationale:
          "No single filter or rename was verified to preserve the other message paths. Choose where the callback should stop, then check again.",
      });
    }
    if (omitted) findings.push(omission("message-loop", omitted));
    if (!types.complete)
      findings.push({
        omitted: 1,
        id: "message-loop:incomplete",
        target: "",
        rule: "message-loop",
        severity: "warning",
        elements: [],
        title: "Message type propagation incomplete",
        message: "The message path budget was reached.",
        rationale: "Check a smaller diagram to enumerate every message path.",
      });
    return findings;
  },
};
