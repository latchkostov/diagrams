import { expect, it } from "vitest";
import { createMachine, machinePaths } from "../../lib/machine";
import { nudgeSegment, startSegment } from "./segmentKeyboard";
import { routeSegments } from "./segments";
import { routeAnnouncementMachine } from "./useSegmentKeyboard";

const points = [
  { x: 0, y: 0 },
  { x: 123, y: 0 },
  { x: 123, y: 100 },
  { x: 300, y: 100 },
];
it("starts under the label, otherwise on the longest inner segment", () => {
  const segments = routeSegments(points);
  expect(startSegment(segments, null)).toBe(1);
  expect(startSegment(segments, { x: 240, y: 100 })).toBe(2);
});
it("uses the node grid rule, Shift distance and snapping-off steps", () => {
  const s = routeSegments(points)[1];
  const nudge = (sign: 1 | -1, far: boolean, snap: boolean) => nudgeSegment(points, s, sign, far, snap, [24, 24]);
  expect(nudge(1, false, true).distance).toBe(7);
  expect(nudge(-1, false, true).distance).toBe(3);
  expect(nudge(1, true, true).distance).toBe(47);
  expect(nudge(-1, true, true).distance).toBe(53);
  expect(nudge(1, false, false).distance).toBe(1);
  expect(nudge(1, true, false).distance).toBe(10);
});
it("selects the moving middle leg after an end jog and merges aligned segments", () => {
  const straight = [
    { x: 0, y: 0 },
    { x: 300, y: 0 },
  ];
  const jog = nudgeSegment(straight, routeSegments(straight)[0], 1, false, true, [24, 24]);
  expect(jog.index).toBe(2);
  expect(jog.points).toHaveLength(6);
  const merged = nudgeSegment(jog.points, routeSegments(jog.points)[jog.index], -1, false, true, [24, 24]);
  expect(merged.points).toEqual(straight);
});
it("keeps a short first jog from an off-grid port and a one-pixel unsnapped jog", () => {
  const straight = [
    { x: 0, y: 56 },
    { x: 300, y: 56 },
  ];
  const segment = routeSegments(straight)[0];
  for (const snap of [true, false]) {
    const jog = nudgeSegment(straight, segment, 1, false, snap, [24, 24]);
    expect(jog.points).toHaveLength(6);
    expect(jog.points[2].y).toBe(snap ? 60 : 57);
  }
});
it("keeps nudging the same leg when disjoint horizontal legs become aligned", () => {
  const route = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 200, y: 100 },
    { x: 200, y: 10 },
    { x: 300, y: 10 },
    { x: 300, y: 200 },
    { x: 400, y: 200 },
  ];
  const first = nudgeSegment(route, routeSegments(route)[4], -1, false, true, [24, 24]);
  expect(first.index).toBe(4);
  const second = nudgeSegment(first.points, routeSegments(first.points)[first.index], -1, false, true, [24, 24]);
  expect(second.points.slice(0, 4)).toEqual(route.slice(0, 4));
  expect(second.points.slice(4, 6)).toEqual([
    { x: 200, y: -10 },
    { x: 300, y: -10 },
  ]);
});
it("announces only a transition from shaped to automatic, including repeated route events", () => {
  for (const path of machinePaths(routeAnnouncementMachine, { maxDepth: 4 })) {
    const machine = createMachine(routeAnnouncementMachine);
    for (const event of path.events) {
      const before = machine.state.value;
      const result = machine.send(event);
      expect(result.commands).toEqual(before === "shaped" && !event.custom ? ["reset"] : []);
    }
  }
});
