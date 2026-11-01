import { expect, it, vi } from "vitest";
import { publishDockObservation } from "./dockObservation";
import { observationPorts, type ProductObservations } from "../lib/observations";

it("publishes each changed dock fact and document identity once, ignoring repeated camera updates", () => {
  const listener = vi.fn();
  const off = observationPorts.dock.subscribe(listener);
  let event: ProductObservations["dock"] = {
    documentId: "dock-regression",
    identity: {},
    tab: "closed",
    snap: "peek",
    live: false,
    presenting: false,
    view: "overview",
  };
  try {
    publishDockObservation(event);
    for (let i = 0; i < 16; i++) publishDockObservation({ ...event });
    expect(listener).toHaveBeenCalledTimes(1);
    const changes: Partial<typeof event>[] = [
      { tab: "properties" },
      { snap: "half" },
      { live: true },
      { presenting: true },
      { view: "custom" },
      { identity: {} },
      { documentId: "another-dock" },
    ];
    for (const [index, change] of changes.entries()) {
      event = { ...event, ...change };
      publishDockObservation(event);
      publishDockObservation({ ...event });
      expect(listener).toHaveBeenCalledTimes(index + 2);
      expect(listener).toHaveBeenLastCalledWith(event);
    }
  } finally {
    off();
  }
});
