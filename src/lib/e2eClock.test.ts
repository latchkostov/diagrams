import { expect, it } from "vitest";
import { pauseClocks } from "../../scripts/e2e-clock";

it("pauses at the leading context frame, even when the invoking tab lags", async () => {
  const paused: number[] = [];
  await pauseClocks(
    async () => [100, 200, 150],
    async (time) => {
      if (time < 200) throw new Error("Cannot fast-forward to the past");
      paused.push(time);
    },
  );
  expect(paused).toEqual([200]);
});

it("resamples clocks after a moving clock has been stopped by the first rejection", async () => {
  const calls: number[] = [];
  await pauseClocks(
    async () => (calls.length ? [200, 300] : [100, 200]),
    async (time) => {
      calls.push(time);
      if (time < 300) throw new Error("Cannot fast-forward to the past");
    },
  );
  expect(calls).toEqual([200, 300]);
  await expect(
    pauseClocks(
      async () => [1],
      async () => {
        throw new Error("page closed");
      },
    ),
  ).rejects.toThrow("page closed");
});
