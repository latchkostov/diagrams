import type { DiagramFile } from "../model/types";
import type { Finding } from "../checks/types";
import { simulationContent } from "../sim/simulationContent";

export type RequestCheckResult =
  | { status: "pending"; done: Promise<Finding[]> }
  | { status: "ready"; findings: Finding[] }
  | { status: "failed"; error: Error };

let provider: ((d: DiagramFile) => Promise<Finding[]>) | undefined;
// One complete result store for workers, local fallback, synchronous rechecks and agents.
const cache = new Map<string, RequestCheckResult>();
export function registerRequestChecks(fn: typeof provider): void {
  provider = fn;
  cache.clear();
}
export const hasRequestCheckProvider = () => !!provider;
export function requestCheckResult(d: DiagramFile): RequestCheckResult | undefined {
  return cache.get(simulationContent(d));
}
export function rememberRequestChecks(d: DiagramFile, findings: Finding[]): void {
  const key = simulationContent(d);
  cache.delete(key);
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  cache.set(key, { status: "ready", findings: findings.filter((f) => !!f.requestFinding) });
}
export function rememberedRequestChecks(d: DiagramFile): Finding[] | undefined {
  const result = requestCheckResult(d);
  return result?.status === "ready" ? result.findings : undefined;
}

/** A miss is pending work, never a successful empty check. Failures remain explicit. */
export function awaitRequestChecks(d: DiagramFile): Promise<Finding[]> {
  const known = requestCheckResult(d);
  if (known?.status === "ready") return Promise.resolve(known.findings);
  if (known?.status === "pending") return known.done;
  if (known?.status === "failed") return Promise.reject(known.error);
  return trackRequestChecks(d, async () => {
    if (provider) return provider(d);
    const [{ requestFindings }, { buildContext }] = await Promise.all([
      import("../checks/requestFindings"),
      import("../checks/context"),
    ]);
    return requestFindings({ ...buildContext(d), local: true });
  });
}

/** Publish readiness before starting work so concurrent readers await the same result. */
export function trackRequestChecks(d: DiagramFile, compute: () => Promise<Finding[]>): Promise<Finding[]> {
  const key = simulationContent(d);
  const done = Promise.resolve()
    .then(compute)
    .then(
      (findings) => {
        rememberRequestChecks(d, findings);
        return findings;
      },
      (cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        cache.set(key, { status: "failed", error });
        throw error;
      },
    );
  cache.set(key, { status: "pending", done });
  return done;
}
