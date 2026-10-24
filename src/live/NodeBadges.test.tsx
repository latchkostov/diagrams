import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { LiveState } from "./controller";
import { waitingFixture } from "../lab/waitingFixture";

const nodes = vi.hoisted(() => [] as unknown[]);
const pills = vi.hoisted(() => vi.fn(() => null));
vi.mock("./lazyWaitingVisuals", () => ({ CallPill: pills, CallPills: pills, ThreadMeter: () => null }));
vi.mock("@xyflow/react", () => ({
  useNodes: () => nodes,
  useStore: (select: (s: object) => unknown) => select({ transform: [0, 0, 1], domNode: null }),
}));
vi.mock("./context", () => ({ useLive: () => ({ controller: { currentDiagram: waitingFixture() } }) }));
vi.mock("../canvas/DiagramContext", () => ({ useDiagram: () => ({ editing: null }) }));
vi.mock("../canvas/interaction", () => ({ useInteraction: () => null }));

import { HealthWindow } from "./healthWindow";
import { NodeBadges } from "./NodeBadges";

it("never mounts call-pill consumers for idle Request snapshots", () => {
  const state = {
    inputs: {},
    configuration: {},
    snapshot: {
      nodes: {},
      edges: Object.fromEntries(
        Array.from({ length: 1500 }, (_, i) => [
          `request-${i}`,
          { calls: { held: 0, inFlight: 0, failed: 0, late: 0 } },
        ]),
      ),
    },
  } as unknown as LiveState;
  renderToStaticMarkup(<NodeBadges state={state} presenting={false} />);
  expect(pills).not.toHaveBeenCalled();
});

it("counts terminal losses once and excludes failed attempts that recovered", () => {
  nodes.push({
    id: "caller",
    type: "diagram",
    data: { stencil: "generic.service", label: "Caller" },
    position: { x: 0, y: 0 },
  });
  try {
    const sample: import("../sim/types").NodeSimState = {
      id: "caller",
      role: "processor",
      status: "up",
      processed: 1,
      inFlight: 0,
      throughput: 1,
      backlog: 0,
      failed: 12,
      dropped: 5,
      deadLettered: 2,
      lag: {},
    };
    const state = {
      inputs: {},
      configuration: {},
      snapshot: { nodes: { caller: sample }, edges: {} },
    } as unknown as LiveState;
    const health = new HealthWindow();
    health.observe(
      { ...state.snapshot, time: 0, nodes: { caller: { ...sample, dropped: 0 } } } as Parameters<
        HealthWindow["observe"]
      >[0],
      0,
    );
    health.observe({ ...state.snapshot, time: 1000 }, 0);
    const html = renderToStaticMarkup(<NodeBadges state={state} presenting={false} />);
    expect(html).toContain('data-testid="node-alert-caller">5</div>');
    for (let time = 2000; time <= 12000; time += 1000) health.observe({ ...state.snapshot, time }, 0);
    expect(sample.dropped).toBe(5);
    expect(sample.deadLettered).toBe(2);
    expect(renderToStaticMarkup(<NodeBadges state={state} presenting={false} />)).not.toContain(
      'data-testid="node-alert-caller"',
    );
  } finally {
    nodes.length = 0;
  }
});
