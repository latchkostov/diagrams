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
