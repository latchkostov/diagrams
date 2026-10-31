import { msg } from "../i18n";
import type { Target, Tutorial } from "./types";

/** Optional display routes. Completion and playback never consume these instructions. */
export function withCoachRoutes(tutorial: Tutorial): Tutorial {
  for (const step of tutorial.steps) {
    if (step.coach) continue;
    const grow = step.targets.find((t) => t.testId.startsWith("grow-chip-"));
    if (grow) {
      const node = grow.testId.replace("grow-chip-", "node-");
      const search: Target = { testId: "quick-add-search", tip: msg("tutorials.coach.searchThenEnter") };
      const fields = step.targets.filter((t) => t.testId.startsWith("inspector-field-"));
      step.coach = {
        routes: [
          {
            kind: "pointer",
            summary: step.goal,
            targets: [...fields, search, grow, { testId: node, tip: msg("tutorials.coach.selectSource") }],
          },
          {
            kind: "keyboard",
            summary: msg("tutorials.coach.growKeyboard"),
            targets: [...fields, search, { testId: node, tip: msg("tutorials.coach.growKeyboard") }],
          },
        ],
      };
      continue;
    }
    const gesture = step.solution.find((a) => "drag" in a && /^(handle-|reconnect-)/.test(a.drag));
    if (!gesture || !("drag" in gesture)) continue;
    const source = /^handle-(.+)-(top|right|bottom|left)$/.exec(gesture.drag);
    const reconnect = /^reconnect-(.+)-target$/.exec(gesture.drag);
    const destination =
      /^handle-(.+)-(top|right|bottom|left)$/.exec(gesture.to)?.[1] ?? gesture.to.replace("node-", "");
    const origin = source ? `node-${source[1]}` : `edge-${reconnect![1]}`;
    const keyboardWords = source ? msg("tutorials.coach.connectKeyboard") : msg("tutorials.coach.reconnectKeyboard");
    step.coach = {
      routes: [
        {
          kind: "pointer",
          summary: step.goal,
          targets: [{ testId: gesture.drag, tip: step.goal }, ...step.targets.filter((t) => t.testId !== gesture.drag)],
        },
        {
          kind: "keyboard",
          summary: keyboardWords,
          targets: [
            {
              testId: `context-menu-item-${source ? "connect" : "reconnect-target"}:${destination}`,
              tip: msg("tutorials.coach.chooseDestination"),
            },
            {
              testId: source ? "context-menu-item-node.connect" : "context-menu-item-edge.reconnect:to",
              tip: keyboardWords,
            },
            { testId: origin, tip: keyboardWords },
          ],
        },
      ],
    };
  }
  return tutorial;
}
