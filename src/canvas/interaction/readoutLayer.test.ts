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
