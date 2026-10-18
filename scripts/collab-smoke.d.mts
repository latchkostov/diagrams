export interface SmokeResult {
  ok: boolean;
  stage: string;
  class?: "tracker-unreachable" | "ice-nat" | "app-error";
  connectMs?: number;
  syncMs?: { creatorToJoiner?: number; joinerToCreator?: number };
  pair?: { local?: string; remote?: string; protocol?: string };
  trackers?: Record<string, { opened: number; framesReceived: number }>;
  connectivity?: { creator?: string; joiner?: string };
  errors?: string[];
  message?: string;
}
export const ALERT_AFTER: number;
export function readResult(path: string): SmokeResult;
export function ensure(path: string): void;
export function summary(result: SmokeResult): string;
export function streak(results: readonly SmokeResult[]): number;
export function previous(dir: string): SmokeResult[];
export function trend(nights: readonly SmokeResult[]): string;
