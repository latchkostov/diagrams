import type { Tutorial } from "./types";

const words = () => "Dependencies visibility fixture";
/** Both directions exercise the idempotent visibility demo without relying on a user's preference. */
export const visibilityFixtures: readonly Tutorial[] = [false, true].map((visible) => ({
  id: `fixture-visibility-${visible}`,
  version: 1,
  track: "basics",
  level: 1,
  minutes: 1,
  title: words,
  summary: words,
  start: () => ({ format: "diagrams/v1", title: words(), nodes: [], edges: [] }),
  subjects: {},
  steps: [
    {
      id: String(visible),
      title: words,
      goal: words,
      check: { kind: "dependencies", visible },
      targets: [{ testId: "canvas-pane", tip: words }],
      demo: [{ kind: "dependencies", visible }],
      solution: [
        { rightclick: "canvas-pane" },
        { hover: "context-menu-item-canvas.view-options" },
        { click: "context-menu-item-view:dependencies" },
      ],
      sticky: true,
    },
  ],
  finish: { text: words },
}));
