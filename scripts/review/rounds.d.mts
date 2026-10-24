import type { State, Scope, Issue } from "./triage.mjs";
export const ANGLES: string[];
export function roundPlan(
  state?: State | null,
  options?: { angles?: string; allowRound4?: boolean; full?: boolean; audit?: boolean; pr?: string },
): { round: number; angles: string[]; capped: boolean };
export function nextState(
  plan: { round: number; context?: string },
  scope: Scope,
  issues: Issue[],
  report: string,
): State;
