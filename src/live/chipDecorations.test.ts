// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { Decorator, loadChipInk } from "./decorations";
import { LiveController } from "./controller";
import retryStorm from "../examples/retry-storm.json";
import type { DiagramFile } from "../model/types";
import { HealthWindow } from "./healthWindow";
import { rateLevel, rollup } from "./chipInk";
import { opGrowth } from "../test/opCounter";
import { chipEdges } from "../canvas/chipEdges";
import { chipEdge } from "../canvas/nodes/ChipNode";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

it("emphasizes the positive upper quartile, including empty rates and ties", () => {
  const snapshot = new LiveController(retryStorm as DiagramFile).snapshot();
  for (const [rates, threshold] of [
    [[], Infinity],
    [[0, 0], Infinity],
    [[4], 4],
    [[0, 4, 1, 3, 2], 4],
    [[1, 3, 3, 3, 5], 3],
  ] as const) {
    const root = document.createElement("div");
    root.innerHTML = rates.map((_, i) => `<g class="react-flow__edge" data-id="e${i}"></g>`).join("");
    const edges = Object.fromEntries(
      rates.map((rate, i) => [`e${i}`, { ...Object.values(snapshot.edges)[0], id: `e${i}`, delivered: rate }]),
    );
    const snap = { ...snapshot, nodes: {}, edges, time: 1000 };
    new Decorator(root).apply({ snapshot: snap, health: snap, spotlight: null });
    expect([...root.children].map((edge) => edge.hasAttribute("data-live-main"))).toEqual(
      rates.map((rate) => rate >= threshold),
    );
  }
});

it("weights a merged trunk by the sum of its current rates, with bounded stable buckets", () => {
  expect(rateLevel(100)).toBe(3);
  expect(rateLevel(10)).toBe(2);
  expect(rateLevel(0)).toBe(0);
  expect(rateLevel(1e12)).toBe(5);
});

it.each([
  [0, 0, ""],
  [0, 1, "1 stressed"],
  [1, 0, "1 failing"],
  [1, 1, "1 failing · 1 stressed"],
] as const)("omits zero trouble counts (%i failing, %i stressed)", (failing, stressed, text) => {
  const pill = document.createElement("span");
  pill.dataset.testid = "zone-trouble-services";
  pill.textContent = "previous trouble";
  rollup([pill], new Map([["services", [failing, stressed]]]));
  expect(pill.textContent).toBe(text);
  expect(pill.hasAttribute("data-failing")).toBe(!!failing);
});

it("weights only shared sections by their members' rates at every sampling scale", async () => {
  await loadChipInk();
  const snapshot = new LiveController(retryStorm as DiagramFile).snapshot();
  const run = (n: number, scale = 1) => {
    const root = document.createElement("div");
    const routes = new Map(
      Array.from({ length: n }, (_, i) => [
        `e${i}`,
        {
          points: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: i % 2 ? -100 : 100 },
            { x: 400, y: i % 2 ? -100 : 100 },
          ],
        },
      ]),
    );
    routes.set("unrelated", {
      points: [
        { x: 0, y: 400 },
        { x: 400, y: 400 },
      ],
    });
    const { paths, shared, lanes } = chipEdges(routes, 0.4);
    root.innerHTML = renderToStaticMarkup(
      createElement(
        "svg",
        null,
        [...routes.keys()].map((id) =>
          createElement(
            "g",
            { key: id, className: "react-flow__edge", "data-id": id },
            chipEdge(id, paths.get(id)!, null, false, lanes.get(id)!, null, shared.get(id)),
          ),
        ),
      ),
    );
    const edges = Object.fromEntries(
      [...routes.keys()].map((id) => [id, { ...Object.values(snapshot.edges)[0], id, delivered: 60 / scale }]),
    );
    const decorator = new Decorator(root);
    const snap = { ...snapshot, nodes: {}, edges, time: 1000, scale };
    const apply = () => decorator.apply({ snapshot: snap, health: snap, spotlight: null });
    apply();
    return { root, apply };
  };
  for (const scale of [1, 20, 100]) {
    const { root } = run(2, scale);
    expect([...root.querySelectorAll(".react-flow__edge")].map((el) => el.getAttribute("data-live-rate"))).toEqual([
      "2",
      "2",
      "2",
    ]);
    const sections = [...root.querySelectorAll("[data-chip-members]")];
    expect(sections).toHaveLength(1);
    expect(sections[0].getAttribute("d")).toBe("M0,0 L200,0");
    expect(sections[0].getAttribute("data-live-rate")).toBe("3");
  }
  const small = run(250),
    large = run(2000);
  expect(opGrowth(small.apply, large.apply)).toBeLessThanOrEqual(24);
});

it("rolls current failures and paused nodes up once per zone, clears on recovery and leaving Live", async () => {
  await loadChipInk();
  const root = document.createElement("div");
  root.innerHTML =
    '<div class="react-flow__node-diagram" data-id="payments"></div><div class="react-flow__node-diagram" data-id="orders"></div><span class="chip-trouble" data-testid="zone-trouble-services"></span><g class="react-flow__edge" data-id="orders--payments"></g>';
  const decorator = new Decorator(root);
  const zones = new Map([
    ["payments", ["services"]],
    ["orders", ["services"]],
  ]);
  const controller = new LiveController(retryStorm as DiagramFile);
  const snapshot = controller.snapshot();
  const payments = snapshot.nodes.payments;
  const orders = snapshot.nodes.orders;
  const history = new HealthWindow();
  const apply = (time: number, failed: number, paused: boolean) => {
    const snap = {
      ...snapshot,
      time,
      nodes: {
        ...snapshot.nodes,
        payments: { ...payments, failed },
        orders: { ...orders, status: paused ? ("paused" as const) : ("up" as const) },
      },
    };
    history.observe(snap, 1);
    decorator.apply({ snapshot: snap, health: snap, spotlight: null, zones });
  };
  apply(125, 0, false);
  const pill = root.querySelector(".chip-trouble")!;
  expect(pill.textContent).toBe("");
  apply(250, 1, true);
  expect(pill.textContent).toBe("1 failing · 1 stressed");
  expect(pill.hasAttribute("data-failing")).toBe(true);
  expect(root.firstElementChild?.getAttribute("data-live-trouble")).toBe("failing");
  apply(11000, 1, true);
  expect(pill.textContent).toBe("1 stressed");
  expect(pill.hasAttribute("data-failing")).toBe(false);
  apply(11125, 1, false);
  expect(pill.textContent).toBe("");
  decorator.clear();
  expect(root.querySelector("[data-live-trouble]")).toBeNull();
});
