import type { CheckRule, Finding } from "../types";
import type { MessageLoop } from "../../model/messageTypes";

export const messageLoop: CheckRule = {
  id: "message-loop",
  name: "Messages loop back",
  about: "Finds message types forwarded around a processor cycle. Retries and broker redelivery do not count.",
  detect(ctx) {
    const types = ctx.messageTypes();
    // Automatic fixes are quarantined: transition membership cannot prove per-input path preservation.
    // Keep the verifier in messageLoopFix.ts for docs/backlog/2026-10-23-message-loop-fix-quarantine.md.
    // One finding per node, with manual guidance for every typed loop reported there.
    const byNode = new Map<string, MessageLoop[]>();
    for (const loop of types.loops) {
      const list = byNode.get(loop.node);
      if (list) list.push(loop);
      else byNode.set(loop.node, [loop]);
    }
    const findings: Finding[] = [...byNode.values()].map((loops) => {
      const loop = loops[0];
      const node = ctx.name(loop.node);
      const message = `${loop.type} messages loop back to ${node}: each one is sent again.`;
      return {
        id: `message-loop:${loop.node}`,
        rule: "message-loop" as const,
        severity: "warning" as const,
        target: loop.node,
        elements: [...new Set([loop.node, ...loop.steps.flatMap((step) => [step.from, step.to, step.edge])])],
        title: "Messages loop back",
        message,
        messageLoop: { type: loop.type, node },
        rationale:
          "No single filter or rename was verified to preserve the other message paths. Choose where the callback should stop, then check again.",
      };
    });
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
