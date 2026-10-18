import { describe, expect, it } from "vitest";
import { faultDrillFixture } from "../lab/faultDrillFixture";
import { toFlow } from "../canvas/convert";
import { basisOf, matchesBasis } from "../canvas/checks/simulationRuns";
import { structuralKey } from "../live/controller";
import { simulationContent } from "./simulationContent";

describe("shared simulation content", () => {
  it("invalidates playback, planner keys and evidence for membership and boundary ancestry only", () => {
    const d = faultDrillFixture();
    const content = (diagram: typeof d) => ({ ...toFlow(diagram), meta: diagram });
    const basis = basisOf(content(d));
    for (const change of ["membership", "ancestry", "geometry", "labels", "planning"] as const) {
      const next = structuredClone(d);
      if (change === "membership") next.nodes[2].group = "zone-a";
      if (change === "ancestry") next.groups![1].group = "zone-a";
      if (change === "geometry") {
        next.nodes[2].x++;
        next.groups![1].width++;
      }
      if (change === "labels") {
        next.groups![1].label = "Renamed";
        next.edges[0].label = "Renamed";
      }
      if (change === "planning") next.planning = { revision: "p1" };
      const equal = change === "geometry" || change === "labels";
      expect(simulationContent(next) === simulationContent(d), `planner: ${change}`).toBe(equal);
      expect(structuralKey(next) === structuralKey(d), `playback: ${change}`).toBe(equal);
      expect(matchesBasis(basis, content(next)), `evidence: ${change}`).toBe(equal);
    }
  });
});
