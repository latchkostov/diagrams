interface JobsReport {
  jobs: {
    name: string;
    status: string;
    conclusion: string | null;
    started_at: string;
    completed_at: string;
  }[];
}
export function ciTimings(report: JobsReport): { name: string; seconds: number }[];
export function compareTimings(before: JobsReport, after: JobsReport): string;
