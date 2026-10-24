import type { State } from "./triage.mjs";
export function readState(file: string): State | null;
export function replaceState(
  file: string,
  expected: State | null,
  replacement: () => State | Promise<State>,
  waiting?: () => void,
): Promise<void>;
