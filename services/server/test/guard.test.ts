import { expect, it, onTestFinished, vi } from "vitest";
import { FakeClock } from "../../../src/collab/clock";
import { EpochChain } from "../../../src/collab/epochs";
import { RoomGuard } from "../src/collab/guard";

it("idle waits for all queued and in-flight jobs, including a failed job", async () => {
  const guard = new RoomGuard("root", "room", new FakeClock());
  await guard.idle();
  const gate = () => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => (release = resolve));
    return { promise, release };
  };
  const first = gate();
  const second = gate();
  const startedSecond = gate();
  const spy = vi
    .spyOn(EpochChain.prototype, "add")
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(async () => {
      startedSecond.release();
      await second.promise;
      throw new Error("failed check");
    });
  onTestFinished(() => spy.mockRestore());
  guard.seat("peer", vi.fn(), vi.fn(), vi.fn());
  guard.push("peer", 1, { starts: [], logs: [] }, 10);
  guard.push("peer", 2, { starts: [], logs: [] }, 20);
  const resolved = vi.fn();
  const idle = Promise.all([guard.idle(), guard.idle()]).then(resolved);
  await Promise.resolve();
  await Promise.resolve();
  expect(guard.load()).toEqual({ jobs: 2, bytes: 30 });
  expect(resolved).not.toHaveBeenCalled();
  first.release();
  await startedSecond.promise;
  expect(guard.load()).toEqual({ jobs: 1, bytes: 20 });
  expect(resolved).not.toHaveBeenCalled();
  second.release();
  await idle;
  expect(resolved).toHaveBeenCalledOnce();
  expect(guard.load()).toEqual({ jobs: 0, bytes: 0 });
  await guard.idle();
});
