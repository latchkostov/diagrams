import type { Config } from "./gate/logic.mjs";
import type { runSteps } from "./gate/run.mjs";
import type { linuxRun } from "./gate/linux.mjs";
import type { acquireBudget } from "./gate/budget.mjs";
export function runGate(
  config: Config,
  dependencies?: {
    root?: string;
    stampDir?: string;
    git?: (args: string[], cwd: string) => Promise<string>;
    acquireBudget?: typeof acquireBudget;
    doctor?: (root: string, config: Config) => Promise<boolean>;
    runSteps?: typeof runSteps;
    linuxRun?: typeof linuxRun;
  },
  signal?: AbortSignal,
): Promise<number>;
