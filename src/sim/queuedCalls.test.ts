import { expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { createEngine, randomDraws } from "./engine";

it.each(["blocking", "non-blocking"] as const)(
  "reports %s pool queues without changing snapshots or random draws",
  (wait) => {
    const d = waitingFixture();
    d.edges[1].props!.caller = { wait, poolConnections: 1, deadlineMs: 100 };
    const e = createEngine({ seed: 17 });
    e.load(d);
    e.inject("source", 4);
    e.step(50);
    const before = e.snapshot();
    const draws = randomDraws(e);
    expect(e.queuedCalls("call")).toBe(3);
    expect(e.queuedCalls("absent")).toBe(0);
    expect(e.snapshot()).toEqual(before);
    expect(randomDraws(e)).toBe(draws);
    e.step(1000);
    expect(e.queuedCalls("call")).toBe(0);
  },
);
