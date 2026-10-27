import { chartSamples } from "./chartSamples";
import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { chartWindow, groupRunFlags, niceMaximum } from "./runChartMath";
import { RunChart } from "./RunChart";
import { RunHistory } from "./runHistory";
import type { TimelineMarker } from "../sim/types";

it("zooms the chart window on the shared run scale and rounds independent axes", () => {
  expect([0, 9700, 59000].map((t) => chartWindow(t, 60000))).toEqual([12000, 13000, 60000]);
  expect([0, 1.1, 2.1, 3, 6, 201].map(niceMaximum)).toEqual([1, 2, 2.5, 5, 10, 250]);
});
it("keeps pointer clusters in their lane, but merges overlapping coarse targets across lanes", () => {
  const markers: TimelineMarker[] = [
    { kind: "fault", atMs: 1000, label: "Down" },
    { kind: "note", atMs: 1000, label: "Why" },
    { kind: "fault", atMs: 1100, label: "Slow" },
  ];
  const pointer = groupRunFlags(markers, 60000, 320, 14);
  expect(pointer.map((g) => [g.kind, g.markers.length])).toEqual([
    ["fault", 2],
    ["note", 1],
  ]);
  expect(groupRunFlags(markers, 60000, 320, 44, true)).toHaveLength(1);
  expect(pointer.flatMap((g) => g.markers.map((m) => m.index)).sort()).toEqual([0, 1, 2]);
});
it("bounds plotted points while preserving brief peaks of either series", () => {
  const samples = Array.from({ length: 4500 }, (_, i) => ({
    t: i * 200,
    rate: i === 233 ? 1000 : 10,
    queue: i === 2501 ? 9000 : 0,
  }));
  const history = new RunHistory();
  history.sample({ time: 0, inSystem: 0, nodes: {} }, 1);
  history.probe("api");
  for (const sample of samples.slice(1))
    history.sample(
      { time: sample.t, inSystem: 0, nodes: { api: { throughput: sample.rate, backlog: sample.queue } } },
      1,
    );
  const plot = chartSamples(history, "api", 150, samples.at(-1)!.t);
  expect(plot.length).toBeLessThanOrEqual(602);
  expect(Math.max(...plot.map((s) => s.rate))).toBe(1000);
  expect(Math.max(...plot.map((s) => s.queue))).toBe(9000);
  expect(plot.at(-1)).toEqual(samples.at(-1));
});
it("keeps extrema in time-based pixel columns when observations are unevenly spaced", () => {
  const history = new RunHistory();
  history.sample({ time: 0, inSystem: 0, nodes: {} }, 1);
  history.probe("api");
  for (const [time, rate] of [
    [200, 10],
    [400, 1000],
    [600, 0],
    [800, 10],
    [1000, 10],
    [1200, 10],
    [1400, 10],
    [1600, 10],
    [1800, 20],
    [8000, 50],
    [8200, 900],
    [8400, 600],
  ]) {
    history.sample({ time, inSystem: 0, nodes: { api: { throughput: rate, backlog: 0 } } }, 1);
  }
  const plot = chartSamples(history, "api", 2, 10000);
  expect(plot.filter((s) => s.t < 5000).map((s) => s.rate)).toEqual([10, 1000, 0]);
  expect(plot.filter((s) => s.t >= 5000).map((s) => s.rate)).toEqual([50, 900, 600]);
});
it("uses the vitals' now values and the transport's playhead fraction", () => {
  const html = renderToStaticMarkup(
    <RunChart
      history={new RunHistory()}
      node="api"
      name="API"
      time={9700}
      total={60000}
      markers={[]}
      vitals={[
        { key: "rate", label: "Throughput", value: "127/s" },
        { key: "queue", label: "Queue", value: "4.9k" },
      ]}
    />,
  );
  expect(html).toContain('data-testid="run-chart-rate-now">127/s');
  expect(html).toContain('data-testid="run-chart-queue-now">4.9k');
  expect(html).toContain(`data-fraction="${9700 / 60000}"`);
  expect(html).toContain("0–13 s of 60 s");
});
