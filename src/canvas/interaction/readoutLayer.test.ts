import { expect, it } from "vitest";
import { createReadoutLayer } from "./readoutLayer";
import type { FocusEvent } from "./types";

it("reports focus separately from the closing summary's pin state", () => {
  const events: FocusEvent[] = [];
  const layer = createReadoutLayer(
    { menu: null, dispatch: (e) => events.push(e) },
    {
      stop: () => null,
      shown: () => true,
      holds: () => true,
    },
  );
  layer.point({ kind: "node", id: "caller" });
  layer.close("escape");
  expect(events).toEqual([
    { type: "readout.closed", target: { kind: "node", id: "caller", pinned: false }, hadFocus: true, reason: "escape" },
  ]);
});

it.each(["node", "edge"] as const)(
  "closes a deleted pinned %s through the controller and does not restore its pin on undo",
  (kind) => {
    const events: FocusEvent[] = [];
    const layer = createReadoutLayer(
      { menu: null, dispatch: (e) => events.push(e) },
      {
        stop: () => null,
        shown: () => true,
        holds: () => false,
      },
    );
    const target = { kind, id: "target" };
    const ids = new Set([target.id]);
    const reconcile = () => layer.reconcile((t) => ids.has(t.id));
    reconcile();
    layer.pin(target);
    ids.delete(target.id);
    reconcile();
    expect(layer.get()).toBeNull();
    expect(events).toEqual([
      { type: "readout.closed", target: { ...target, pinned: true }, hadFocus: false, reason: "remote" },
    ]);
    ids.add(target.id);
    reconcile();
    expect(layer.get()).toBeNull();
    layer.point(target);
    expect(layer.get()).toEqual({ ...target, pinned: false });
  },
);

it("preserves a focused summary across pointer changes until focus leaves", () => {
  let focused = false;
  const layer = createReadoutLayer(
    { menu: null, dispatch: () => {} },
    {
      stop: () => null,
      shown: () => true,
      holds: () => focused,
    },
  );
  const owner = { kind: "node" as const, id: "owner" };
  const other = { kind: "edge" as const, id: "other" };
  layer.point(owner);
  focused = true;
  layer.point(other);
  layer.point(null);
  expect(layer.get()).toEqual({ ...owner, pinned: false });
  focused = false;
  layer.point(other);
  expect(layer.get()).toEqual({ ...other, pinned: false });
});

it("remembers focused ownership across the DOM commit that deletes the target", () => {
  const events: FocusEvent[] = [];
  const layer = createReadoutLayer(
    { menu: null, dispatch: (e) => events.push(e) },
    {
      stop: () => null,
      shown: () => true,
      holds: () => false,
    },
  );
  const target = { kind: "edge" as const, id: "removed" };
  layer.pin(target);
  layer.recordFocus(target);
  layer.reconcile(() => false);
  expect(events).toEqual([
    { type: "readout.closed", target: { ...target, pinned: true }, hadFocus: true, reason: "remote" },
  ]);
});

it("rejects unreadable targets for pointer, pin and reverse traversal", () => {
  const events: FocusEvent[] = [];
  const layer = createReadoutLayer(
    { menu: null, dispatch: (e) => events.push(e) },
    {
      stop: () => null,
      shown: () => false,
      holds: () => false,
    },
  );
  const readable = { kind: "node" as const, id: "service" };
  layer.reconcile((t) => t.id === readable.id);
  for (const id of ["annotation", "unsupported", "removed"]) {
    const target = { kind: "node" as const, id };
    layer.point(target);
    layer.pin(target);
    expect(layer.get()).toBeNull();
    layer.point(readable);
    layer.retrace(target);
    expect(layer.get()?.id).toBe(readable.id);
    layer.close("outside");
  }
  expect(events.filter((e) => e.type === "readout.entered")).toEqual([]);
});

it("shares placed-card visibility with keyboard ownership", () => {
  let shown = false;
  const layer = createReadoutLayer(
    { menu: null, dispatch: () => {} },
    {
      stop: () => null,
      shown: () => shown,
      holds: () => false,
    },
  );
  const target = { kind: "node" as const, id: "caller" };
  layer.point(target);
  expect(layer.visible(target)).toBe(false);
  expect(layer.enter(target)).toBe(false);
  shown = true;
  expect(layer.visible(target)).toBe(true);
  expect(layer.enter(target)).toBe(true);
});

it("reverses from the pending logical card while the DOM still focuses a later node", () => {
  const events: FocusEvent[] = [];
  const layer = createReadoutLayer(
    { menu: null, dispatch: (e) => events.push(e) },
    {
      stop: () => null,
      shown: () => true,
      holds: () => false,
    },
  );
  const target = { kind: "node" as const, id: "caller" };
  layer.point({ kind: "node", id: "partner" });
  layer.retrace(target);
  const destinations: string[] = [];
  expect(
    layer.tab(
      null,
      true,
      {
        has: () => true,
        go: (t) => {
          destinations.push(t.id);
          return true;
        },
        after: () => "partner",
      },
      target,
    ),
  ).toBe(true);
  expect(destinations).toEqual(["caller"]);
});
