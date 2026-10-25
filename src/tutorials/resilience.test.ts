import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LiveController } from "../live/controller";
import type { DiagramFile } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { holds, resolveSubjects, type SandboxView } from "./checks";
import { healthChecks } from "./catalog/healthChecks";
import { deadLetters } from "./catalog/deadLetters";
import { loadShedding } from "./catalog/loadShedding";
import type { Tutorial } from "./types";

const initial = (tutorial: Tutorial): DiagramFile =>
  typeof tutorial.start === "function"
    ? tutorial.start()
    : (JSON.parse(readFileSync(`src/examples/${tutorial.start.example}.json`, "utf8")) as DiagramFile);

function run(tutorial: Tutorial, id: string) {
  const diagram = initial(tutorial);
  const controller = new LiveController(diagram, { roleOf: stencilRole });
  controller.selectSimulation(diagram.simulations!.find((s) => s.id === id)!);
  controller.setPlaying(true);
  const subjects = resolveSubjects(tutorial, diagram);
  const view = (): SandboxView => ({
    diagram,
    live: true,
    session: controller.getState(),
    processed: (id) => controller.getState().snapshot.nodes[id]?.processed ?? 0,
  });
  const advance = (frames: number) => {
    for (let i = 0; i < frames; i++) {
      controller.advance(250);
      controller.publish();
    }
  };
  const met = (id: string, subject?: string) =>
    holds(
      tutorial.steps.find((s) => s.id === id)!.check,
      { ...view(), readout: subject ? { kind: "node", id: subjects[subject]! } : null },
      subjects,
    );
  return { diagram, controller, subjects, view, advance, met };
}

describe("resilience lessons use real seeded readings", () => {
  it("observes zone loss, then waits through the protected outage rather than accepting its initial zero", () => {
    const without = run(healthChecks, "no-health-checks");
    expect(without.met("watch-loss")).toBe(false);
    without.advance(36);
    expect(without.met("watch-loss")).toBe(true);
    expect(without.met("watch-protection")).toBe(false);

    const withChecks = run(healthChecks, "health-checks");
    expect(withChecks.met("watch-protection")).toBe(false);
    // Healthy work and zero losses midway through the outage still do not prove the whole run.
    withChecks.advance(24);
    expect(withChecks.met("watch-protection")).toBe(false);
    withChecks.advance(12);
    expect(withChecks.met("watch-protection")).toBe(true);

    const view = withChecks.view();
    const apiB = withChecks.subjects.apiB!;
    // A perturbed run with excess losses must fail even after enough healthy work has completed.
    const lossy: SandboxView = {
      ...view,
      session: {
        ...view.session!,
        snapshot: {
          ...view.session!.snapshot,
          nodes: { ...view.session!.snapshot.nodes, [apiB]: { ...view.session!.snapshot.nodes[apiB], dropped: 10 } },
        },
      },
    };
    expect(holds(healthChecks.steps[3].check, lossy, withChecks.subjects)).toBe(false);
  });

  it("the poison run produces dead letters at the command queue before the delivery-limit edit", () => {
    const s = run(deadLetters, "poison");
    expect(s.met("watch-dead-letter")).toBe(false);
    s.advance(40);
    expect(s.met("watch-dead-letter")).toBe(true);
    expect(s.met("max-deliveries")).toBe(false);
    const commands = s.diagram.nodes.find((n) => n.id === s.subjects.commands)!;
    commands.props = { ...commands.props, maxDeliveryCount: 3 };
    expect(s.met("max-deliveries")).toBe(true);
  });

  it("the seeded spike builds an API backlog behind the slow dependency", () => {
    const s = run(loadShedding, "spike");
    expect(s.met("watch-backlog")).toBe(false);
    s.controller.inject(s.subjects.client!, 100, { spreadMs: 1500 });
    s.advance(8);
    expect(s.met("watch-backlog")).toBe(false);
    expect(s.met("watch-backlog", "api")).toBe(true);
  });
});
