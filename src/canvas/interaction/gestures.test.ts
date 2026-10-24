import { describe, expect, it } from "vitest";
import { gestures, initialGestures, gestureTargetRemoved } from "./gestures";
import type { GesturePreview, GestureEndReason } from "./types";

const preview: GesturePreview = { kind: "edge.end", edge: "a-b", end: "target", at: { x: 1, y: 2 }, over: null };
const start = () => gestures(initialGestures(), { type: "gesture.start", kind: preview.kind, preview, via: "mouse" });

describe("gestures: G1–G7 and K1–K2", () => {
  it("G1 starts with a monotonic sequence; G2 supersedes without committing", () => {
    const first = start();
    expect(first.started?.seq).toBe(1);
    expect(first.ended).toBeNull();
    const second = gestures(first.state, { type: "gesture.start", kind: preview.kind, preview, via: "touch" });
    expect(second.started).toMatchObject({ seq: 2, via: "touch" });
    expect(second.ended).toMatchObject({ seq: 1, reason: "superseded", commit: false });
  });
  it("G3 updates the active preview; G4 ignores stale moves", () => {
    const first = start();
    const moved = { ...preview, at: { x: 8, y: 9 } };
    const next = gestures(first.state, { type: "gesture.move", seq: 1, preview: moved });
    expect(next.state.active?.preview).toBe(moved);
    expect(gestures(next.state, { type: "gesture.move", seq: 0, preview }).state).toBe(next.state);
  });
  it.each<GestureEndReason>(["drop", "escape", "cancel", "blur", "remote", "unmount", "superseded"])(
    "G5/G6 ends %s, commits only a drop",
    (reason) => {
      const t = gestures(start().state, { type: "gesture.end", seq: 1, reason });
      expect(t.state.active).toBeNull();
      expect(t.ended).toMatchObject({ reason, commit: reason === "drop", preview });
    },
  );
  it("G7 ignores stale endings and endings with no active gesture", () => {
    const s = start().state;
    expect(gestures(s, { type: "gesture.end", seq: 0, reason: "drop" }).state).toBe(s);
    const empty = initialGestures();
    expect(gestures(empty, { type: "gesture.end", seq: 1, reason: "drop" }).state).toBe(empty);
  });
  it("K1 wraps the sole edge's segment; K2 retains it only for that selection", () => {
    const step = { type: "segment.step", edge: "a-b", k: 0, alone: true } as const;
    const first = gestures(initialGestures(), step).state;
    expect(first.keyboardSegment).toEqual({ edge: "a-b", k: 0 });
    expect(gestures(first, { ...step, k: 2 }).state.keyboardSegment?.k).toBe(2);
    expect(gestures(first, { ...step, alone: false }).state).toBe(first);
    expect(gestures(first, { type: "selection.committed", alone: "a-b" }).state).toBe(first);
    expect(gestures(first, { type: "selection.committed" }).state.keyboardSegment).toBeUndefined();
  });
  it("remote deletion checks a gesture's edge, origin nodes and hovered node", () => {
    expect(gestureTargetRemoved(preview, new Set(), new Set())).toBe(true);
    expect(gestureTargetRemoved(preview, new Set(), new Set(["a-b"]))).toBe(false);
    expect(gestureTargetRemoved({ kind: "connect", from: "a", over: { node: "b" } }, new Set(["a"]), new Set())).toBe(
      true,
    );
    expect(
      gestureTargetRemoved({ kind: "node.drag", origins: new Map([["a", { x: 0, y: 0 }]]) }, new Set(), new Set()),
    ).toBe(true);
  });
});
