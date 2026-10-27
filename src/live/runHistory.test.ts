import { chartSamples } from "./chartSamples";
import { describe, expect, it } from "vitest";
import { RunHistory, HISTORY_CAPACITY } from "./runHistory";
import { LiveController } from "./controller";
import type { DiagramFile } from "../model/types";

const snapshot = (time: number) => ({
  time,
  inSystem: time / 20,
  nodes: { api: { throughput: time / 10, backlog: time / 100 }, unseen: { throughput: 2, backlog: 3 } },
});
// Decode the public ring view only in tests; production plotting materializes selected extrema.
const observations = (history: RunHistory, id: string) => {
  const series = history.series(id);
  if (!series) return [];
  return Array.from({ length: series.to - series.from }, (_, i) => {
    const slot = (series.from + i) % HISTORY_CAPACITY;
    return { t: series.times[slot], rate: series.values[slot * 2], queue: series.values[slot * 2 + 1] };
  });
};
const inFlight = (history: RunHistory) => {
  const series = history.series()!;
  return Array.from({ length: series.to - series.from }, (_, i) => {
    const slot = (series.from + i) % HISTORY_CAPACITY;
    return { t: series.times[slot], value: series.values[slot] };
  });
};

describe("run observations", () => {
  it("decimates by time column, preserving both series' spikes, troughs and endpoints across a wrapped ring", () => {
    const history = new RunHistory();
    history.sample(snapshot(0), 1);
    history.probe("api");
    for (let i = 1; i <= HISTORY_CAPACITY + 20; i++) {
      history.sample(
        {
          time: i * 200,
          inSystem: 0,
          nodes: {
            api: {
              throughput: i === 233 ? 1000 : i === 235 ? 0 : 10,
              backlog: i === 2501 ? 9000 : i === 2503 ? 0 : 2,
            },
          },
        },
        1,
      );
    }
    const raw = observations(history, "api");
    const end = (HISTORY_CAPACITY + 20) * 200;
    const plot = chartSamples(history, "api", 30, end);
    expect(plot.length).toBeLessThanOrEqual(4 * 30 + 2);
    expect(plot.map((s) => s.t)).toEqual([...new Set(plot.map((s) => s.t))].sort((a, b) => a - b));
    for (const i of [233, 235, 2501, 2503]) expect(plot).toContainEqual(raw.find((s) => s.t === i * 200));
    expect(plot[0]).toEqual(raw[0]);
    expect(plot.at(-1)).toEqual(raw.at(-1));
    const cropped = chartSamples(history, "api", 1, 240 * 200);
    expect(cropped).toHaveLength(4);
    expect(cropped.at(-1)?.t).toBe(240 * 200);
    expect(chartSamples(history, "unseen", 30, end)).toEqual([]);
  });
  it("versions only new observations and resets, including a reset at the same sequence", () => {
    const history = new RunHistory();
    history.sample(snapshot(0), 1);
    const version = history.version;
    history.sample(snapshot(50), 1);
    expect(history.version).toBe(version);
    history.sample(snapshot(200), 1);
    expect(history.version).toBeGreaterThan(version);
    const sampled = history.version;
    history.reset();
    expect(history.version).toBeGreaterThan(sampled);
  });
  it("records five buckets per simulated second and allocates only probed nodes", () => {
    const history = new RunHistory();
    history.sample(snapshot(0), 1);
    history.probe("api");
    for (let time = 25; time <= 1000; time += 25) history.sample(snapshot(time), 1);
    expect(observations(history, "api").map((s) => s.t)).toEqual([200, 400, 600, 800, 1000]);
    expect(history.trackedNodes).toBe(1);
    expect(observations(history, "unseen")).toEqual([]);
    expect(inFlight(history).at(-1)).toEqual({ t: 1000, value: 50 });
  });
  it("caps observations and forgets probes on generation, rewind and explicit reset", () => {
    const history = new RunHistory();
    history.sample(snapshot(0), 1);
    history.probe("api");
    for (let i = 1; i <= HISTORY_CAPACITY + 20; i++) history.sample(snapshot(i * 200), 1);
    expect(observations(history, "api")).toHaveLength(HISTORY_CAPACITY);
    expect(inFlight(history)).toHaveLength(HISTORY_CAPACITY);
    expect(observations(history, "api")[0].t).toBe(4200);
    history.sample(snapshot(0), 2);
    expect(observations(history, "api")).toEqual([]);
    history.probe("api");
    history.sample(snapshot(200), 2);
    expect(observations(history, "api")).toHaveLength(1);
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
