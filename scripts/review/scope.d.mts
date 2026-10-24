import type { Scope } from "./triage.mjs";
export function git(root: string, ...args: string[]): string;
export function reviewFiles(root: string, range: { base: string; head: string }): string[];
export function changedLines(patch: string, previous?: number[], include?: boolean): number[];
export function reviewScope(
  root: string,
  options?: { since?: string; full?: boolean; audit?: boolean; baseRef?: string },
): Scope & {
  base: string;
  since?: string;
  range?: string;
  commits?: string[];
  patch: string;
};
