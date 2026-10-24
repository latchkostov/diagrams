import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import type { DiagramFile } from "../../model/types";
import { stencilRole } from "../../stencils/roles";
import { LiveController } from "../controller";
import { buildScript, frameAt, stepStop } from "./script";
import { SlowMotion } from "./session";

it("publishes camera commands before rendering and preserves a paused snapshot on ignored clock ticks", () => {
  const diagram = JSON.parse(readFileSync("src/examples/kafka-order-pipeline.json", "utf8")) as DiagramFile;
  const controller = new LiveController(diagram);
  const stencils = new Map(diagram.nodes.map((n) => [n.id, n.stencil]));
  const slow = new SlowMotion(controller, {
    code: { buildScript, frameAt, stepStop },
    build: (trace) => buildScript({ trace, diagram, roleOf: (id) => stencilRole(stencils.get(id) ?? "") }),
    schedule: (work) => {
      work();
      return () => {};
    },
  });
  const commands = vi.fn();
  slow.cameraCommand = commands;
  try {
    controller.setTraffic(true);
    controller.setPlaying(true);
    slow.start({ kind: "next" });
    expect(slow.machineState).toBe("playing");
    expect(commands.mock.calls.map(([c]) => c)).toEqual([
      { type: "camera", on: true },
      { type: "camera", on: true, take: true },
    ]);
    slow.pause();
    slow.step(1);
    slow.step(1);
    slow.step(1);
    const paused = slow.getState();
    expect(paused.real).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) slow.advance(16, 1);
    expect(slow.getState()).toBe(paused);
    slow.escape();
    expect(commands).toHaveBeenLastCalledWith({ type: "camera", on: false, restore: true });
  } finally {
    slow.dispose();
    controller.dispose();
  }
});
