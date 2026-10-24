export interface Finding {
  severity: string;
  confidence: string;
  file: string;
  line: number;
  title: string;
  detail: string;
  suggestion: string;
  previousId?: string | null;
}
export interface Issue extends Finding {
  id: string;
  lenses: string[];
  calibration?: string;
  evidence?: Finding[];
}
export interface Report {
  angle: string;
  report: {
    summary: string;
    findings: Finding[];
    assessments: { id: string; status: string; detail: string }[];
  };
}
export interface State {
  round: number;
  lastReviewedSha: string;
  openP1Ids: string[];
  openP1s: Issue[];
  report?: string;
  context?: string;
}
export interface Scope {
  head: string;
  mode: string;
  files: string[];
  lines: Record<string, number[]>;
}
export interface Plan {
  round: number;
  capped: boolean;
  scope: Scope;
  state?: State | null;
}
export interface Result {
  issues: Issue[];
  resolutions: { id: string; status: string; answers: { angle: string; status: string; detail: string }[] }[];
  excluded: Finding[];
  rawCount: number;
}
export const rank: Record<string, number>;
export function sameIssue(a: Finding, b: Finding): boolean;
export function compare(a: Finding, b: Finding): number;
export function consolidate(reports: Report[], plan: Plan): Result;
export function renderReport(name: string, plan: Plan, result: Result, reports: Report[]): string;
