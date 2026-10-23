import { expect, it, vi } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import * as topology from "../sim/topology";
import { readoutDiagram } from "./readoutDiagram";

it("compiles once across counter publications and shares running policies across readouts", () => {
  const saved = waitingFixture();
  const compile = vi.spyOn(topology, "compileTopology");
  const running = {
    id: "free",
    title: "Free threads",
    durationMs: 10000,
    traffic: [],
    setup: { edges: { call: { caller: { wait: "non-blocking" as const, poolConnections: 12 } } } },
  };
  try {
    const first = readoutDiagram(saved, running);
    for (let publication = 0; publication < 80; publication++) {
      expect(readoutDiagram(saved, running)).toBe(first);
    }
    expect(compile).toHaveBeenCalledTimes(1);
    expect(first.diagram.edges.find((e) => e.id === "call")?.props?.caller).toEqual({
      wait: "non-blocking",
      poolConnections: 12,
    });
    expect(saved.edges.find((e) => e.id === "call")?.props?.caller).toBeUndefined();
    expect(readoutDiagram(saved).diagram).toBe(saved);
    expect(compile).toHaveBeenCalledTimes(2);
    const edited = { ...saved, title: "Edited" };
    expect(readoutDiagram(edited, running)).not.toBe(first);
    expect(compile).toHaveBeenCalledTimes(3);
  } finally {
    compile.mockRestore();
  }
});
