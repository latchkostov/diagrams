import { describe, it, expect } from "vitest";
import { runChecks } from "./run";
import { presentFinding } from "./presentation";
import { applyOps } from "../ai/ops";
import { plannerFixture } from "../lab/plannerFixture";
import { planScaling } from "../sim/scalingPlanner";

describe("scenario sizing in Checks", () => {
  it("raises the planner's verified suggestion as one undoable capacity fix with the complete policy", () => {
    const d = plannerFixture();
    const finding = runChecks(d).findings.find((f) => f.id === "capacity:worker")!;
    expect(finding.scalingPlan).toMatchObject({ kind: "max", from: 10, to: 14, verified: true, platform: "HPA" });
    expect(finding.message).toContain("At 3× traffic in “Black Friday”, HPA hits max 10");
    expect(finding.message).toContain("Raise max to 14");
    expect(finding.fix!.ops).toHaveLength(1);
    const shown = presentFinding(finding);
    expect(shown.message).toContain("Raise the maximum to 14");
    expect(shown.fix!.label).toBe("Raise max to 14");
    // The same result the planner returns to agents and playback.
    expect(finding.fix!.ops![0]).toMatchObject({
      op: "update",
      target: "worker",
      props: planScaling(d)[0].suggestions[0].fix![0].props,
    });
    const fixed = applyOps(d, finding.fix!.ops!);
    expect(fixed.ok).toBe(true);
    expect(runChecks(fixed.diagram).findings.find((f) => f.id === "capacity:worker")?.scalingPlan?.kind).not.toBe(
      "max",
    );
  });
  it("names partitions, not replicas, when the input's partitions bind", () => {
    const finding = runChecks(plannerFixture("partitions", 60)).findings.find((f) => f.id === "capacity:worker")!;
    expect(finding.scalingPlan).toMatchObject({ kind: "partitions", broker: "Orders", verified: true });
    expect(finding.fix!.label).toMatch(/^Set Orders partitions to \d+$/);
    expect(finding.fix!.ops!.map((op) => op.op === "update" && op.target)).toContain("orders");
  });
  it("offers no fix when an admission quota binds", () => {
    const finding = runChecks(plannerFixture("quota", 60)).findings.find((f) => f.id === "capacity:worker")!;
    expect(finding.scalingPlan?.kind).toBe("quota");
    expect(finding.fix).toBeUndefined();
  });
});
