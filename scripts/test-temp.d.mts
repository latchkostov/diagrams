export const removalOptions: { recursive: true; force: true; maxRetries: number; retryDelay: number };
export function createTempRun(
  kind: "vitest" | "parity" | "gate",
  options?: { root?: string; systemTemp?: string; now?: number },
): {
  directory: string;
  env: Record<"TMP" | "TEMP" | "TMPDIR" | "LIVEDIAGRAMS_SYSTEM_TEMP", string>;
  dispose(options?: { checkOwned?: boolean }): void;
};
