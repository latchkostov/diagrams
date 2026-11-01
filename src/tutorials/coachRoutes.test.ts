import { expect, it } from "vitest";
import { allTutorials } from "./catalog";
import { withCoachRoutes } from "./coachRoutes";
import { quickAdd } from "./catalog/quickAdd";

it("provides precise pointer and keyboard routes for every taught grow chip, dot and reconnect control", () => {
  for (const tutorial of allTutorials)
    for (const step of tutorial.steps) {
      if (!step.targets.some((t) => /^(handle-|grow-chip-|reconnect-)/.test(t.testId))) continue;
      expect(
        step.coach?.routes.map((r) => r.kind),
        `${tutorial.id}/${step.id}`,
      ).toEqual(["pointer", "keyboard"]);
      const [pointer, keyboard] = step.coach!.routes;
      expect(pointer.targets.some((t) => /^(handle-|grow-chip-|reconnect-)/.test(t.testId))).toBe(true);
      expect(keyboard.targets.some((t) => /^(node-|edge-)/.test(t.testId))).toBe(true);
      expect(keyboard.summary()).not.toBe(pointer.summary());
      expect(keyboard.targets.map((target) => target.tip())).not.toEqual(pointer.targets.map((target) => target.tip()));
      expect(keyboard.targets.some((target) => target.tip() !== step.goal())).toBe(true);
    }
});

it("retains the full requirements in generated grow, connect, side and reconnect routes", () => {
  for (const [id, stepId, required] of [
    ["dots-and-sides", "connect", ["Service A", "right dot"]],
    ["dots-and-sides", "side", ["Service A", "top"]],
    ["dots-and-sides", "reconnect", ["Service B", "Bookings query", "Request", "source side"]],
    ["api-gateway", "add-users", ["Service", "gateway", "Users"]],
  ] as const) {
    const step = allTutorials.find((tutorial) => tutorial.id === id)!.steps.find((step) => step.id === stepId)!;
    for (const route of step.coach!.routes) {
      expect(route.summary()).toContain(step.goal());
      for (const name of required) expect(route.summary()).toContain(name);
    }
  }
});
it("keeps display routes optional: checks, demos and both real UI solutions retain their identities", () => {
  const source = quickAdd.steps[1];
  const step = { ...source, coach: undefined, targets: [{ testId: "grow-chip-{app}", tip: source.goal }] };
  const tutorial = { ...quickAdd, steps: [step] };
  const routed = withCoachRoutes(tutorial);
  expect(routed.steps[0].coach?.routes).toHaveLength(2);
  expect(step.check).toBe(source.check);
  expect(step.demo).toBe(source.demo);
  expect(step.solution).toBe(source.solution);
  expect(step.keyboardSolution).toBe(source.keyboardSolution);
});
