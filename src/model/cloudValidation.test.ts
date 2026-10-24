import { describe, it, expect } from "vitest";
import { validateDiagram } from "../interop/native";
import { applyOps } from "../ai/ops";
import { cloudFixture } from "../lab/cloudFixture";
import { type CloudConfig } from "./autoscaling";
import { cloudLesson, kedaLesson } from "./autoscalingLessons";
import { checkAutoscaling } from "./autoscalingSchema";
import { propsProblem } from "./simProps";
import { resourceLesson } from "./autoscalingLessons";

const r = resourceLesson();

describe("A3 policies at every ingress", () => {
  it("reads each platform's preset diagram natively", () => {
    for (const preset of [
      "ecs-cpu",
      "ecs-alb",
      "ecs-step",
      "aca-http",
      "aca-event",
      "app-service",
      "cloud-run",
    ] as const)
      expect(validateDiagram(cloudFixture(preset)).ok, preset).toBe(true);
  });
  it("refuses a dangling load balancer or event source in a file and in agent operations", () => {
    for (const preset of ["ecs-alb", "aca-event"] as const) {
      const d = cloudFixture(preset);
      const dangling = cloudLesson(preset, { source: "missing", binding: { node: "missing" } });
      d.nodes.find((n) => n.id === "worker")!.props!.autoscaling = dangling;
      expect(validateDiagram(d).ok, preset).toBe(false);
      const ops = applyOps(cloudFixture(preset), [
        { op: "update", target: "worker", props: { autoscaling: dangling } },
      ]);
      expect(ops.ok, preset).toBe(false);
      expect(ops.diagram).toEqual(cloudFixture(preset));
    }
  });
  it("refuses A3 policies outside the p3-a1 planning revision, as older readers refuse A2", () => {
    const d = cloudFixture("cloud-run");
    d.planning = { revision: "p3" };
    expect(validateDiagram(d).ok).toBe(false);
  });
  it("never accepts a cloud controller under an A1/A2 model revision", () => {
    const a = { ...cloudLesson("ecs-cpu"), modelRevision: "a2" } as unknown as CloudConfig;
    expect(() => checkAutoscaling(r, a)).toThrow();
    const k = { ...kedaLesson("kafka", { node: "t", group: "g" }), modelRevision: "a3" };
    expect(() => checkAutoscaling(r, k)).toThrow();
  });
  it("bounds hostile policy sizes before execution", () => {
    const aca = structuredClone(cloudLesson("aca-event", { binding: { node: "q" } }));
    if (aca.controller.kind !== "aca") throw new Error("aca");
    const trigger = aca.controller.triggers[0];
    aca.controller.triggers = Array.from({ length: 17 }, () => structuredClone(trigger));
    expect(() => checkAutoscaling(r, aca)).toThrow();
    const app = structuredClone(cloudLesson("app-service"));
    if (app.controller.kind !== "appService") throw new Error("app");
    const rule = app.controller.rules[0];
    app.controller.rules = Array.from({ length: 11 }, () => structuredClone(rule));
    expect(() => checkAutoscaling(r, app)).toThrow();
    const ecs = structuredClone(cloudLesson("ecs-step"));
    if (ecs.controller.kind !== "ecs") throw new Error("ecs");
    ecs.controller.stepScaling[0].steps = Array.from({ length: 9 }, (_, i) => ({
      lower: i,
      upper: i + 1,
      adjustment: 1,
    }));
    expect(() => checkAutoscaling(r, ecs)).toThrow();
    expect(
      propsProblem({
        resources: r,
        autoscaling: {
          ...cloudLesson("cloud-run"),
          controller: { ...cloudLesson("cloud-run").controller, maxReplicas: 10_001 },
        },
      }),
    ).toBeDefined();
  });
});
