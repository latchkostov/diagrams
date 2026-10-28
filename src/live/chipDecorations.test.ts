// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { Decorator, loadChipInk } from "./decorations";
import { LiveController } from "./controller";
import retryStorm from "../examples/retry-storm.json";
import type { DiagramFile } from "../model/types";
import { HealthWindow } from "./healthWindow";
import { rateLevel, rollup } from "./chipInk";
import { opGrowth } from "../test/opCounter";

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

it("uses real traffic units at every sampling scale and sums each merged component once", async () => {
  await loadChipInk();
  const snapshot = new LiveController(retryStorm as DiagramFile).snapshot();
  const run = (n: number, scale = 1) => {
    const root = document.createElement("div");
    root.innerHTML = Array.from(
      { length: n },
      (_, i) => `<g class="react-flow__edge" data-id="e${i}"><g data-chip-group="trunk"></g></g>`,
    ).join("");
    const edges = Object.fromEntries(
      Array.from({ length: n }, (_, i) => [
        `e${i}`,
        { ...Object.values(snapshot.edges)[0], id: `e${i}`, delivered: 1000 / scale },
      ]),
    );
    const decorator = new Decorator(root);
    const snap = { ...snapshot, nodes: {}, edges, time: 1000, scale };
    const apply = () => decorator.apply({ snapshot: snap, health: snap, spotlight: null });
    apply();
    return { root, apply };
  };
  for (const scale of [1, 20, 100]) {
    const { root } = run(2, scale);
    expect([...root.children].map((el) => el.getAttribute("data-live-rate"))).toEqual(["4", "4"]);
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
