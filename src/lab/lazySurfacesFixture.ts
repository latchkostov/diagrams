import { inspectorLayoutFixture } from "./inspectorLayoutFixture";

/** Small deterministic system for generated lazy-surface entry points and recovery previews. */
export function lazySurfacesFixture() {
  const diagram = inspectorLayoutFixture();
  diagram.annotations = [{ id: "note", kind: "note", text: "Review", x: 400, y: 420, width: 160, height: 100 }];
  diagram.simulations = [
    {
      id: "narration",
      title: "Review the flow",
      durationMs: 10000,
      traffic: [],
      timeline: [
        { atMs: 0, action: { do: "note", text: "Follow a request through the decision service.", pause: true } },
      ],
    },
  ];
  return diagram;
}
