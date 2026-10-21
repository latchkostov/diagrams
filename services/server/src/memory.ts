import process from "node:process";
import type { ServerConfig } from "./config";

export class MemoryBudgetError extends Error {
  constructor() {
    super("LD_TOTAL_BUFFER_BYTES exceeds 25% of detected memory limit; lower the budget or raise the container limit");
  }
}

/** Node/libuv detects cgroup v1/v2 limits; zero means unavailable or unconstrained. */
export function validateMemoryBudget(
  config: Pick<ServerConfig, "totalBufferBytes">,
  limit = process.constrainedMemory(),
): void {
  if (limit > 0 && config.totalBufferBytes > Math.floor(limit / 4)) throw new MemoryBudgetError();
}
