import type { DiagramFile } from "../model/types";
import type { Finding } from "../checks/types";
import type { CheckRuleId } from "../model/checks";
import { revisionAtLeast } from "../model/revisions";
import { simulationContent } from "../sim/simulationContent";

export type RequestCheckResult =
  | { status: "pending"; done: Promise<Finding[]> }
  | { status: "ready"; findings: Finding[] }
  | { status: "failed"; error: Error };

/** The rules whose findings come from request checks (src/checks/requestFindings.ts). */
export const REQUEST_RULES = [
  "blocked-threads",
  "scaling-blind",
  "call-timeout",
] as const satisfies readonly CheckRuleId[];

/**
 * Whether a run of `rules` (default: all) on `d` reads request findings: the same test runChecks applies. Capacity
 * reads them only through these rules (it defers to their findings), so a capacity-only run never waits.
 */
export function requestChecksNeeded(d: DiagramFile, rules?: readonly string[]): boolean {
  if (!revisionAtLeast(d.planning?.revision, "p3-w1")) return false;
  const off = d.checks?.off ?? [];
  return REQUEST_RULES.some((id) => (!rules || rules.includes(id)) && !off.includes(id));
}

let provider: ((d: DiagramFile) => Promise<Finding[]>) | undefined;
// One complete result store for workers, local fallback, synchronous rechecks and agents.
const cache = new Map<string, RequestCheckResult>();
/** The newest attempt started for each content still working: only it settles that content's entry. */
const latest = new Map<string, number>();
let attempts = 0;
export function registerRequestChecks(fn: typeof provider): void {
  provider = fn;
  cache.clear();
  latest.clear();
}
export const hasRequestCheckProvider = () => !!provider;
export function requestCheckResult(d: DiagramFile): RequestCheckResult | undefined {
  return cache.get(simulationContent(d));
}
function store(key: string, result: RequestCheckResult) {
  cache.delete(key);
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
}
export function rememberRequestChecks(d: DiagramFile, findings: Finding[]): void {
  store(simulationContent(d), { status: "ready", findings: findings.filter((f) => !!f.requestFinding || !!f.omitted) });
}
export function rememberedRequestChecks(d: DiagramFile): Finding[] | undefined {
  const result = requestCheckResult(d);
  return result?.status === "ready" ? result.findings : undefined;
}

/**
 * The request findings for `d`, once ready. A miss is pending work, never a successful empty check. A failure is
 * reported to everyone waiting on that attempt; a later call starts a new one.
 */
export function awaitRequestChecks(d: DiagramFile): Promise<Finding[]> {
  const known = requestCheckResult(d);
  if (known?.status === "ready") return Promise.resolve(known.findings);
  if (known?.status === "pending") return known.done;
  return trackRequestChecks(d, async () => {
    if (provider) return provider(d);
    const [{ requestFindings }, { buildContext }] = await Promise.all([
      import("../checks/requestFindings"),
      import("../checks/context"),
    ]);
    const ctx = buildContext(d);
    ctx.local = true;
    return requestFindings(ctx);
  });
}

/**
 * Publish readiness before starting work so concurrent readers await the same result. Content that's already ready
 * stays ready while it's worked out again (the same content gives the same findings), and an attempt only settles the
 * entry it published: a slower, older attempt never overwrites a newer one.
 */
export function trackRequestChecks(d: DiagramFile, compute: () => Promise<Finding[]>): Promise<Finding[]> {
  const key = simulationContent(d);
  const known = cache.get(key);
  const mine = ++attempts;
  latest.set(key, mine);
  let pending: RequestCheckResult | undefined;
  const settle = () => {
    const newest = latest.get(key) === mine;
    if (newest) latest.delete(key);
    return newest;
  };
  const done = Promise.resolve()
    .then(compute)
    .then(
      (findings) => {
        const current = cache.get(key);
        // The newest attempt publishes; an older one only fills a gap (nothing there, or a newer failure).
        if (settle() || !current || current.status === "failed") rememberRequestChecks(d, findings);
        return findings;
      },
      (cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        if (settle() && pending && cache.get(key) === pending) store(key, { status: "failed", error });
        throw error;
      },
    );
  if (known?.status !== "ready") store(key, (pending = { status: "pending", done }));
  return done;
}
