import { expect, it, vi } from "vitest";
import payment from "../examples/slow-payment-provider.json";
import type { DiagramFile } from "../model/types";
import { LiveController } from "./controller";
import { TroubleTracker } from "./useObservedTrouble";

// A thread-exhaustion callout shows Events until the checks worker confirms a fix: the worker starts when live view
// starts watching (requests that wait), so its download and start-up don't delay the first confirmed fix.

it.each([
  ["p3-w1", 1],
  ["p3-a1", 0],
])("live view readies the verifier when it starts watching (%s)", (revision, warmed) => {
  const d = structuredClone(payment) as DiagramFile;
  d.planning = { ...d.planning, revision: revision as "p3-w1" };
  const controller = new LiveController(d);
  const warm = vi.fn();
  const tracker = new TroubleTracker(controller, async () => undefined, warm);
  expect(warm).not.toHaveBeenCalled();
  const stop = tracker.subscribe(() => {});
  const again = tracker.subscribe(() => {});
  expect(warm).toHaveBeenCalledTimes(warmed);
  stop();
  again();
  controller.dispose();
});
