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
