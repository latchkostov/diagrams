import type { Config } from "./logic.mjs";
import type { Summary } from "./run.mjs";
type Executor = (
  bin: string,
  args: string[],
  options?: Record<string, unknown>,
) => Promise<{ code: number; text: string }>;
export function linuxRun(
  root: string,
  config: Config,
  changed: string[],
  directory: string,
  sha: string,
  execute?: { command: Executor; required: Executor },
): Promise<Summary>;
