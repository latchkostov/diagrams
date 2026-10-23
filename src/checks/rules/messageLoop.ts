import type { CheckRule, Finding } from "../types";
import { messageLoopFix } from "../messageLoopFix";

export const messageLoop: CheckRule = {
  id: "message-loop",
  name: "Messages loop back",
  about: "Finds message types forwarded around a processor cycle. Retries and broker redelivery do not count.",
  detect(ctx) {
    const types = ctx.messageTypes();
    const seen = new Set<string>();
    const findings: Finding[] = types.loops
      .filter((loop) => !seen.has(loop.node) && !!seen.add(loop.node))
      .map((loop) => {
        const node = ctx.name(loop.node);
        const message = `${loop.type} messages loop back to ${node}: each one is sent again.`;
        const fix = messageLoopFix(ctx.diagram, types, loop);
        return {
          id: `message-loop:${loop.node}`,
          rule: "message-loop" as const,
          severity: "warning" as const,
          target: loop.node,
          elements: [...new Set([loop.node, ...loop.steps.flatMap((step) => [step.from, step.to, step.edge])])],
          title: "Messages loop back",
          message,
          messageLoop: { type: loop.type, node },
          fix,
          rationale: fix
            ? "Forwarding a callback into the send path can multiply traffic and exhaust processing threads. Filter the returning type out of the send path."
            : "No single filter or rename was verified to preserve the other message paths. Choose where the callback should stop, then check again.",
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
