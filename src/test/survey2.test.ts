import { expect, it } from "vitest";
import { surveyMemory } from "../../tests/bench/ui/survey2Checks";

it("clears observer history before every Live heap reading, including the baseline", async () => {
  const calls: string[] = [];
  let history = [1, 2, 3];
  const probe = {
    async mark() {
      calls.push("mark");
      history = [];
    },
    async heap() {
      calls.push("gc");
      expect(history).toEqual([]);
      return 100;
    },
    async domCounters() {
      calls.push("dom");
      return { documents: 1, nodes: 2, jsEventListeners: 3 };
    },
  };
  for (let reading = 0; reading < 3; reading++) {
    expect(await surveyMemory(probe)).toEqual({ heap: 100, documents: 1, nodes: 2, jsEventListeners: 3 });
    history.push(reading);
  }
  expect(calls).toEqual(Array.from({ length: 3 }, () => ["mark", "gc", "dom"]).flat());
});
