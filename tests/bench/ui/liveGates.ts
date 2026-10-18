import { flipsPer100Edges, layerRatio, liveGateLimits, per100 } from "../../../src/bench/liveMetrics";
import { round, type WorkloadInfo } from "../results";
import type { uiSuite } from "./harness";

/**
 * Records the gates for one x10 window, held on a large diagram only: running transitions, layers against x1, edge
 * churn.
 */
export function recordLiveGates(
  s: Pick<ReturnType<typeof uiSuite>, "count">,
  w: WorkloadInfo,
  detail: string,
  o: {
    x1Layers: number | null;
    x10Layers: number;
    x10Transitions: number;
    flips: number;
    publishes: number;
    elements: number;
    large: boolean;
    /**
     * Gate the edge churn: only in `live gates`. Per publish it depends on how much simulated time a publish covers,
     * which grows as frames slow down (5,000 nodes), so elsewhere it's reported only.
     */
    gateFlips?: boolean;
  },
) {
  const ratio = round(layerRatio(o.x1Layers ?? 0, o.x10Layers), 2);
  const churn = round(flipsPer100Edges(o.flips, o.publishes, w.edges), 2);
  const expectedElements = w.nodes + w.edges;
  const limits = liveGateLimits(expectedElements, o.gateFlips);
  const fades = round(per100(o.x10Transitions, expectedElements), 2);
  s.count("decoratedElements", o.elements, { w: w, detail, ...limits.decoratedElements });
  s.count("largeDiagram", o.large ? 1 : 0, { w: w, detail, ...limits.largeFlag });
  s.count("layersX1", o.x1Layers ?? NaN, { w: w, detail });
  s.count("layersX10Peak", o.x10Layers, { w: w, detail });
  // Small diagrams keep their fades on purpose (decorations.ts): the gates hold where they're dropped.
  s.count("transitionsX10Peak", o.x10Transitions, { w: w, detail });
  s.count("transitionsX10Per100Elements", fades, {
    w: w,
    detail,
    ...limits.transitions,
    why: "CSS transitions running at x10 per 100 nodes and edges: each is animated on its own",
  });
  // Report-only: the layers follow how far the simulation has got (each pulsing node is one), and holding the pulses
  // still cut them by five while making frames twice as slow (docs/BENCHMARKS.md § Live view on large diagrams).
  s.count("layerRatioX10", ratio, { w: w, detail });
  s.count("edgeFlipsPer100EdgesPerPublish", churn, {
    w: w,
    detail,
    ...limits.flips,
    why: "edges changing active/idle per publish: the hold keeps a busy edge lit",
  });
}
