export interface Config {
  command: string;
  specs: string[];
  linux: boolean;
  docker: boolean;
  repeat: number;
  only: string[];
  ports?: number;
  workers?: number;
  cpus?: number;
  memory?: string;
  maxWait?: number;
  shard?: { current: number; total: number };
}
export interface Step {
  name: string;
  args: string[];
  env: Record<string, string>;
}
export interface Counts {
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
}
export interface BrowserCounts extends Counts {
  errors: number;
  projects: Record<string, Counts>;
}
export const CATEGORIES: string[];
export const GIB: number;
export function gitFiles(output: string): string[];
export function options(argv: string[]): Config;
export function positive(value: unknown, name: string): number;
export function validatePorts(base: number): number;
export function workerCount(cpus: number, memory: number, caps?: Pick<Config, "cpus" | "memory">): number;
export function resourceRequest(config: Config, capacity: number): { workers: number; cpus: number; slots: number };
export function admit<T extends { state: string; slots: number; sequence: number }>(
  entries: T[],
  capacity: number,
): T[];
export function lockPort(common: string, platform: string): number;
export function checkTree(status: string, before: string, after?: string): void;
export function playwrightCounts(report: unknown): BrowserCounts;
export function plan(config: Config, changed?: string[], root?: string): Step[][];
export function canStamp(config: Config): boolean;
