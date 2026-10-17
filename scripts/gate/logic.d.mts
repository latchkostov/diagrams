export interface Config {
  command: string;
  specs: string[];
  linux: boolean;
  docker: boolean;
  repeat: number;
  only: string[];
  ports?: number;
  workers?: number;
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
export function workerCount(cpus: number, memory: number): number;
export function lockPort(common: string, platform: string): number;
export function checkTree(status: string, before: string, after?: string): void;
export function playwrightCounts(report: unknown): BrowserCounts;
export function plan(config: Config, changed?: string[]): Step[][];
export function canStamp(config: Config): boolean;
export const INTERNAL_ENV: Record<string, string>;
export const LOCKED_ENV: Record<string, string>;
