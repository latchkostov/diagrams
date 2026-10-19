import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { LiveState } from "./controller";
import { waitingFixture } from "../lab/waitingFixture";

const pills = vi.hoisted(() => vi.fn(() => null));
vi.mock("./lazyWaitingVisuals", () => ({ CallPill: pills, CallPills: pills, ThreadMeter: () => null }));
vi.mock("@xyflow/react", () => ({
  useNodes: () => [],
  useStore: (select: (s: object) => unknown) => select({ transform: [0, 0, 1], domNode: null }),
}));
vi.mock("./context", () => ({ useLive: () => ({ controller: { currentDiagram: waitingFixture() } }) }));
vi.mock("../canvas/DiagramContext", () => ({ useDiagram: () => ({ editing: null }) }));
vi.mock("../canvas/interaction", () => ({ useInteraction: () => null }));

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
