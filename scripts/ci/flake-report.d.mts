interface Run {
  databaseId: number;
  headBranch: string;
  headSha: string;
  conclusion: string;
  attempt: number;
  createdAt: string;
  status: string;
}
interface Job {
  id: number;
  runId: number;
  attempt: number;
  name: string;
  conclusion: string;
  started_at: string;
  completed_at: string;
}
export interface Snapshot {
  repo: string;
  runs: Run[];
  jobs: Job[];
  logs: Record<number, string>;
  budgetSeconds: number;
  unavailable: string[];
}
export function failedTests(log: string): { id: string; project: string; file: string; title: string }[];
export function renderReport(snapshot: Snapshot): string;
