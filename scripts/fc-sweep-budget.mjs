import os from "node:os";
import { join } from "node:path";
import console from "node:console";
import { acquireBudget } from "./gate/budget.mjs";
import { workerCount } from "./gate/logic.mjs";

/** Reserve every spawned worker before the sweep can begin, and release on every exit. */
export async function withSweepBudget({ root, jobs, count, branch }, run, reserve = acquireBudget) {
  const release = await reserve(
    join(os.tmpdir(), "livediagrams-gate-budget-v1"),
    {
      capacity: workerCount(os.availableParallelism(), os.totalmem()),
      slots: Math.min(jobs, count),
      worktree: root,
      branch,
      command: `fc-sweep --jobs ${jobs}`,
    },
    { maxWait: 1, waiting: (message) => console.log(message) },
  );
  try {
    return await run();
  } finally {
    await release();
  }
}
