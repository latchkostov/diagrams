import { expect, it, vi } from "vitest";
import process from "node:process";
import { tmpdir } from "node:os";
import { withSweepBudget } from "../../scripts/fc-sweep-budget.mjs";

it("the sweep budget accepts caller metadata without a Git checkout", async () => {
  const reserve = vi.fn(async () => Object.assign(async () => {}, { ports: 6500 }));
  const options = { root: tmpdir(), jobs: 1, count: 1, branch: "snapshot" };
  await expect(withSweepBudget(options, async () => "complete", reserve)).resolves.toBe("complete");
  expect(reserve).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ branch: "snapshot", worktree: tmpdir() }),
    expect.any(Object),
  );
});

it.each([false, true])(
  "the seed sweep waits for shared capacity and releases it on exit (failure=%s)",
  async (failure) => {
    type Lease = (() => Promise<void>) & { ports: number };
    let grant!: (release: Lease) => void;
    const reservation = new Promise<Lease>((accept) => {
      grant = accept;
    });
    const reserve = vi.fn(() => reservation);
    const release = Object.assign(
      vi.fn(async () => {}),
      { ports: 6500 },
    );
    let finish!: () => void;
    const completion = new Promise<void>((accept) => {
      finish = accept;
    });
    let started!: () => void;
    const running = new Promise<void>((accept) => {
      started = accept;
    });
    const run = vi.fn(async () => {
      started();
      await completion;
      if (failure) throw new Error("seed failed");
      return "complete";
    });
    const pending = withSweepBudget({ root: process.cwd(), jobs: 3, count: 10, branch: "fixture" }, run, reserve);
    const observed = failure
      ? expect(pending).rejects.toThrow("seed failed")
      : expect(pending).resolves.toBe("complete");
    expect(reserve).toHaveBeenCalledWith(
      expect.stringContaining("livediagrams-gate-budget-v1"),
      expect.objectContaining({ slots: 3, worktree: process.cwd(), branch: "fixture" }),
      expect.objectContaining({ maxWait: 1 }),
    );
    expect(run).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    grant(release);
    await running;
    expect(release).not.toHaveBeenCalled();
    finish();
    await observed;
    expect(run).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  },
);
