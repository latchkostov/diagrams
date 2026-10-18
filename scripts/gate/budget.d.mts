export interface Request {
  capacity: number;
  slots: number;
  worktree: string;
  branch: string;
  command: string;
}
export interface Entry extends Request {
  id: string;
  pid: number;
  port: number;
  started: string;
  state: "waiting" | "running";
  sequence: number;
}
export const BUSY_EXIT: number;
export const BUSY_MESSAGE: string;
export class BusyError extends Error {
  exitCode: number;
}
export function waitingMessage(entries: Entry[], capacity: number, now?: number): string;
export function acquireBudget(
  directory: string,
  request: Request,
  options?: {
    signal?: AbortSignal;
    waiting?: (message: string) => void;
    maxWait?: number;
    now?: () => number;
    sleep?: (ms: number, value: undefined, options: { signal: AbortSignal }) => Promise<unknown>;
  },
): Promise<() => Promise<void>>;
