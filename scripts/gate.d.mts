import type { Config } from "./gate/logic.mjs";
import type { runSteps } from "./gate/run.mjs";
import type { linuxRun } from "./gate/linux.mjs";
export function runGate(
  config: Config,
  dependencies?: {
    root?: string;
    stampDir?: string;
    git?: (args: string[], cwd: string) => Promise<string>;
    acquireLock?: (...args: unknown[]) => Promise<() => Promise<void>>;
    doctor?: (root: string, config: Config) => Promise<boolean>;
    probePorts?: (base: number) => Promise<number>;
    pickPorts?: () => Promise<number>;
    runSteps?: typeof runSteps;
    linuxRun?: typeof linuxRun;
  },
  signal?: AbortSignal,
): Promise<number>;
