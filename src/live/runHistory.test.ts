import { describe, expect, it } from "vitest";
import { RunHistory, HISTORY_CAPACITY } from "./runHistory";
import { LiveController } from "./controller";
import type { DiagramFile } from "../model/types";

const snapshot = (time: number) => ({
  time,
  inSystem: time / 20,
  nodes: { api: { throughput: time / 10, backlog: time / 100 }, unseen: { throughput: 2, backlog: 3 } },
});
describe("run observations", () => {
  it("records five buckets per simulated second and allocates only probed nodes", () => {
    const history = new RunHistory();
    history.sample(snapshot(0), 1);
    history.probe("api");
    for (let time = 25; time <= 1000; time += 25) history.sample(snapshot(time), 1);
    expect(history.samples("api").map((s) => s.t)).toEqual([200, 400, 600, 800, 1000]);
    expect(history.trackedNodes).toBe(1);
    expect(history.samples("unseen")).toEqual([]);
    expect(history.inFlight().at(-1)).toEqual({ t: 1000, value: 50 });
  });
  it("caps observations and forgets probes on generation, rewind and explicit reset", () => {
    const history = new RunHistory();
    history.sample(snapshot(0), 1);
    history.probe("api");
    for (let i = 1; i <= HISTORY_CAPACITY + 20; i++) history.sample(snapshot(i * 200), 1);
    expect(history.samples("api")).toHaveLength(HISTORY_CAPACITY);
    expect(history.inFlight()).toHaveLength(HISTORY_CAPACITY);
    expect(history.samples("api")[0].t).toBe(4200);
    history.sample(snapshot(0), 2);
    expect(history.samples("api")).toEqual([]);
    history.probe("api");
    history.sample(snapshot(200), 2);
    expect(history.samples("api")).toHaveLength(1);
    history.sample(snapshot(0), 2);
    expect(history.trackedNodes).toBe(0);
    history.probe("api");
    history.sample(snapshot(200), 2);
    history.reset();
    expect(history.trackedNodes).toBe(0);
  });
  it("restart, forward seek and simulation switching reset the controller's run history", () => {
    const diagram: DiagramFile = {
      format: "diagrams/v2",
      title: "History",
      nodes: [{ id: "api", stencil: "generic.service", label: "API", x: 0, y: 0 }],
      edges: [],
    };
    const c = new LiveController(diagram);
    const sim = { id: "run", title: "Run", durationMs: 2000, traffic: [] };
    c.selectSimulation(sim);
    c.runHistory.probe("api");
    c.seek(500);
    expect(c.runHistory.trackedNodes).toBe(0);
    c.runHistory.probe("api");
    c.restart();
    expect(c.runHistory.trackedNodes).toBe(0);
    c.runHistory.probe("api");
    c.selectSimulation({ ...sim, id: "other" });
    expect(c.runHistory.trackedNodes).toBe(0);
    c.dispose();
  });
});
