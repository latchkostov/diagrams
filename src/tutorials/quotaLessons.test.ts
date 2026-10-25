import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { LiveController } from "../live/controller";
import { stencilRole } from "../stencils/roles";
import { allTutorials, findTutorial } from "./catalog";
import { rateLimit } from "./catalog/rateLimit";
import { sharedApiQuotas } from "./catalog/sharedApiQuotas";
import { backlogLag } from "./catalog/backlogLag";
import { holds, resolveSubjects } from "./checks";
import { patchProps } from "./paths";

it("releases separate inline, shared-budget and backlog lessons", () => {
  for (const lesson of [rateLimit, sharedApiQuotas, backlogLag]) {
    expect(findTutorial(lesson.id)).toBe(lesson);
    expect(allTutorials).toContain(lesson);
  }
  expect(sharedApiQuotas.start).toEqual({ example: "shared-api-quotas" });
  expect(backlogLag.steps.find((step) => step.id === "add-consumer")!.solution).toEqual([
    { click: "trouble-add-consumer" },
  ]);
});

it("requires a real quota edit before running partner traffic and preserves other API settings", () => {
  if (typeof rateLimit.start !== "function") throw new Error("Expected inline sandbox");
  const diagram = rateLimit.start();
  const subjects = resolveSubjects(rateLimit, diagram);
  const step = rateLimit.steps[0];
  expect(step.id).toBe("quota-10");
  expect(step.solution).toContainEqual({ fill: "inspector-field-rate-limit", text: "10" });
  const view = { diagram, live: false, processed: () => 0 };
  expect(holds(step.check, view, subjects)).toBe(false);
  const node = diagram.nodes.find((n) => n.id === subjects.limiter)!;
  node.props = { ...node.props, api: { ...(node.props!.api as object), maxInFlight: 37 } };
  const demo = step.demo[0];
  if (demo.kind !== "patch") throw new Error("Expected quota patch");
  node.props = { ...node.props, ...patchProps(node.props, demo.patches) };
  expect(node.props.api).toMatchObject({ maxInFlight: 37 });
  expect(holds(step.check, view, subjects)).toBe(true);
  expect(patchProps(node.props, demo.patches)).toBeNull();
});

it("shared budgets refuse the burst and the smaller batch really completes without refusals", () => {
  const tutorial = sharedApiQuotas;
  const diagram = JSON.parse(readFileSync("src/examples/shared-api-quotas.json", "utf8")) as DiagramFile;
  const subjects = resolveSubjects(tutorial, diagram);
  const controller = new LiveController(diagram, { roleOf: stencilRole });
  const met = (step: string, subject: string) =>
    holds(
      tutorial.steps.find((s) => s.id === step)!.check,
      {
        diagram,
        live: true,
        session: controller.getState(),
        processed: (id) => controller.getState().snapshot.nodes[id]?.processed ?? 0,
        readout: { kind: "node", id: subjects[subject]! },
      },
      subjects,
    );
  const play = () => {
    for (let frame = 0; frame < 40; frame++) controller.advance(250);
    controller.publish();
  };
  try {
    controller.selectSimulation(diagram.simulations!.find((s) => s.id === "launch-burst")!);
    controller.setPlaying(true);
    expect(met("shared-refusals", "answer")).toBe(false);
    play();
    expect(met("shared-refusals", "answer")).toBe(true);
    expect(met("local-refusals", "payments")).toBe(true);
    controller.selectSimulation(diagram.simulations!.find((s) => s.id === "within-budget")!);
    controller.setPlaying(true);
    expect(met("served", "answer")).toBe(false);
    play();
    expect(met("served", "answer")).toBe(true);
  } finally {
    controller.dispose();
  }
});
