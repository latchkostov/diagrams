// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { Decorator, loadChipInk } from "./decorations";
import { LiveController } from "./controller";
import retryStorm from "../examples/retry-storm.json";
import type { DiagramFile } from "../model/types";
import { HealthWindow } from "./healthWindow";
import { rateLevel } from "./chipInk";

it("weights a merged trunk by the sum of its current rates, with bounded stable buckets", () => {
  const edge = document.createElement("div");
  edge.innerHTML = '<g data-chip-lanes=\'["a","b"]\'></g>';
  expect(
    rateLevel(
      edge,
      "a",
      new Map([
        ["a", 10],
        ["b", 90],
      ]),
    ),
  ).toBe(3);
  edge.innerHTML = "";
  expect(rateLevel(edge, "a", new Map([["a", 10]]))).toBe(2);
  expect(rateLevel(edge, "a", new Map())).toBe(0);
  expect(rateLevel(edge, "a", new Map([["a", 1e12]]))).toBe(5);
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
  expect(pill.textContent).toBe("0 failing · 1 stressed");
  expect(pill.hasAttribute("data-failing")).toBe(false);
  apply(11125, 1, false);
  expect(pill.textContent).toBe("");
  decorator.clear();
  expect(root.querySelector("[data-live-trouble]")).toBeNull();
});
