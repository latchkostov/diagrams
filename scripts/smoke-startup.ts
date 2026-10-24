import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const docker = promisify(execFile);

/** The probe runs after issuing the browser command, while its acknowledgement can still be pending. */
export type StartupProbe = (phase: "browser" | "context") => Promise<void>;

export async function duringStartup<T extends { close(): Promise<void> }>(
  phase: "browser" | "context",
  start: () => Promise<T>,
  probe?: StartupProbe,
): Promise<T> {
  const [resource, evidence] = await Promise.allSettled([start(), probe?.(phase)]);
  if (resource.status === "rejected") throw resource.reason;
  if (evidence.status === "rejected") {
    await resource.value.close();
    throw evidence.reason;
  }
  return resource.value;
}
/** Async Docker calls overlap the pending protocol command without blocking Node's event loop. */
export async function startupChurn(phase: "browser" | "context") {
  const network = `ld-startup-churn-${randomUUID()}`;
  try {
    await docker("docker", ["network", "create", network], { timeout: 30_000 });
    console.log(`Startup network churn: ${phase} ${network}`);
  } finally {
    await docker("docker", ["network", "rm", network], { timeout: 30_000 });
  }
}
