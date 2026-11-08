import { expect, it } from "vitest";
import { FrameRoutes, displayedRoute, editingRoute, frameLabelHome, sameFrameRoutes } from "./frameRoute";
import { freezeRoute } from "./segments";
import type { EdgeRoute } from "../geometry/router";

const natural: EdgeRoute = {
  path: "M0,0 L100,0 L100,200 L300,200",
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 200 },
    { x: 300, y: 200 },
  ],
  sourceSide: "right",
  targetSide: "left",
  label: null,
  ok: true,
};

it("shares displayed geometry until a router revision or capture clears it", () => {
  const displayed = { ...natural, path: "M0,0 L108,0 L108,200 L300,200" };
  const ldFrameRoutes = new Map([["flow", { natural, displayed }]]);
  expect(displayedRoute({ ldFrameRoutes }, "flow", natural)).toBe(displayed);
  const revised = { ...natural };
  expect(displayedRoute({ ldFrameRoutes }, "flow", revised)).toBe(revised);
  expect(displayedRoute({}, "flow", natural)).toBe(natural);
  expect(sameFrameRoutes(ldFrameRoutes, new Map(ldFrameRoutes))).toBe(true);
  expect(sameFrameRoutes(ldFrameRoutes, new Map())).toBe(false);
});

it("keeps inactive edge subscriptions stable while frame geometry changes", () => {
  const first = { ...natural, path: "M0,0 L108,0 L108,200 L300,200" };
  const second = { ...natural, path: "M0,0 L116,0 L116,200 L300,200" };
  const a = { ldFrameRoutes: new Map([["flow", { natural, displayed: first }]]) };
  const b = { ldFrameRoutes: new Map([["flow", { natural, displayed: second }]]) };
  expect(displayedRoute(a, "flow", natural, false)).toBe(natural);
  expect(displayedRoute(b, "flow", natural, false)).toBe(natural);
  expect(displayedRoute(a, "flow", natural, true)).toBe(first);
  expect(displayedRoute(b, "flow", natural, true)).toBe(second);
});

it("carries captions with the accepted lane, retaining their distance from its segment", () => {
  const displayed = natural.points.map((p, i) => (i === 1 || i === 2 ? { ...p, x: 108 } : p));
  const box = { x: 88, y: 90, width: 30, height: 20 };
  expect(frameLabelHome(box, natural.points, displayed)).toEqual({ ...box, x: 96 });
  expect(frameLabelHome(box, natural.points, natural.points)).toEqual(box);
  const clipped = [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
  ];
  expect(frameLabelHome(box, natural.points, clipped).x).toBeGreaterThan(box.x);
});

it("freezes the displayed complete lane for editing but never saves a pin proxy as a hidden tail", () => {
  const points = natural.points.map((p, i) => (i === 1 || i === 2 ? { ...p, x: 108 } : p));
  const displayed = { ...natural, points };
  const editable = editingRoute(displayed, natural);
  expect(editable).toBe(displayed);
  expect(freezeRoute(editable.points)).toEqual(freezeRoute(points));
  expect(freezeRoute(editable.points)).not.toEqual(freezeRoute(natural.points));
  expect(editingRoute({ ...displayed, frameClipped: true }, natural)).toBe(natural);
});

it("wakes only the observers whose own frame route changed, keeping unchanged entries", () => {
  const routes = new FrameRoutes();
  const other: EdgeRoute = { ...natural, path: "M0,400 L300,400" };
  const lane = { ...natural, path: "M0,0 L108,0 L108,200 L300,200" };
  const woken: string[] = [];
  const stop = ["flow", "other", "missing"].map((id) => routes.subscribe(id, () => woken.push(id)));
  routes.publish(
    new Map([
      ["flow", { natural, displayed: lane }],
      ["other", { natural: other, displayed: other }],
    ]),
  );
  expect(woken.sort()).toEqual(["flow", "other"]);
  const kept = routes.current()!.get("other");
  woken.length = 0;
  // A card edit revises one natural route; the neighbour's equal geometry keeps its entry.
  const revised = { ...natural };
  routes.publish(
    new Map([
      ["flow", { natural: revised, displayed: revised }],
      ["other", { natural: other, displayed: { ...other } }],
    ]),
  );
  expect(woken).toEqual(["flow"]);
  expect(routes.current()!.get("other")).toBe(kept);
  woken.length = 0;
  routes.publish(new Map(routes.current()!));
  expect(woken).toEqual([]);
  routes.publish(undefined);
  expect(woken.sort()).toEqual(["flow", "other"]);
  for (const unsubscribe of stop) unsubscribe();
  woken.length = 0;
  routes.publish(new Map([["flow", { natural, displayed: lane }]]));
  expect(woken).toEqual([]);
});
