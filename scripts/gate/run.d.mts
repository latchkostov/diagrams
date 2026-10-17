import type { Config, BrowserCounts } from "./logic.mjs";
export interface CommandOptions {
  cwd: string;
  env: Record<string, string>;
  log: string;
}
export interface Row {
  name: string;
  ok: boolean;
  seconds: number;
  counts?: unknown;
}
export interface Summary {
  rows: Row[];
  reports: (BrowserCounts & { name: string })[];
  failures: number;
  workers: number;
  seconds: number;
  totalSeconds?: number;
}
export function runSteps(
  root: string,
  config: Config,
  changed: string[],
  directory: string,
  extraEnv?: Record<string, string>,
  execute?: (args: string[], options: CommandOptions) => Promise<{ code: number; text: string }>,
): Promise<Summary>;
export function printSummary(sha: string, summary: Summary): string;
