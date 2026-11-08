import type { DiagramFile } from "../model/types";
import type { Finding } from "../checks/types";
import type { CheckRuleId } from "../model/checks";
import { revisionAtLeast } from "../model/revisions";
import { simulationContent } from "../sim/simulationContent";
import { registerRequestChecks, requestCheckGeneration, requestCheckProvider } from "./requestCheckProvider";
import type { RequestCheckOptions } from "./requestCheckProvider";

const keyOf = (d: DiagramFile, target?: string) =>
  target === undefined ? simulationContent(d) : `target:${JSON.stringify([simulationContent(d), target])}`;

export type RequestCheckResult =
  | { status: "pending"; done: Promise<Finding[]> }
  | { status: "ready"; findings: Finding[] }
  | { status: "failed"; error: Error };

/** The rules whose findings come from request checks (src/checks/requestFindings.ts). */
const WAIT_RULES = ["blocked-threads", "scaling-blind", "call-timeout"] as const;
export const REQUEST_RULES = [
  ...WAIT_RULES,
  "retry-backoff",
  "retry-budget",
  "retry-idempotency",
  "retry-layers",
  "call-breaker",
  "queue-limit",
  "retry-storm",
  "cache-stampede",
  "cache-cold-start",
  "cache-ttl-short",
  "cache-method",
] as const satisfies readonly CheckRuleId[];

/**
 * Whether a run of `rules` (default: all) on `d` reads request findings: the same test runChecks applies. Capacity
 * reads them only through these rules (it defers to their findings), so a capacity-only run never waits.
 */
export function requestChecksNeeded(d: DiagramFile, rules?: readonly string[]): boolean {
  if (!revisionAtLeast(d.planning?.revision, "p3-w1")) return false;
  const off = d.checks?.off ?? [];
  const active = revisionAtLeast(d.planning?.revision, "p3-w2") ? REQUEST_RULES : WAIT_RULES;
  return active.some((id) => (!rules || rules.includes(id)) && !off.includes(id));
}

// One complete result store for workers, local fallback, synchronous rechecks and agents.
const rawCache = new Map<string, RequestCheckResult>();
/** The newest attempt started for each content still working: only it settles that content's entry. */
const latest = new Map<string, number>();
const readers = new WeakMap<Promise<Finding[]>, { controller: AbortController; count: number }>();

function read(done: Promise<Finding[]>, signal?: AbortSignal): Promise<Finding[]> {
  const shared = readers.get(done);
  if (!shared) return done;
  shared.count++;
  return new Promise((resolve, reject) => {
    let active = true;
    const release = () => {
      if (!active) return false;
      active = false;
      signal?.removeEventListener("abort", cancel);
      shared.count--;
      return true;
    };
    const cancel = () => {
      if (!release()) return;
      reject(signal?.reason);
      if (!shared.count) shared.controller.abort();
    };
    signal?.addEventListener("abort", cancel, { once: true });
    done.then(
      (findings) => {
        if (release()) resolve(findings);
      },
      (error: unknown) => {
        if (release()) reject(error);
      },
    );
  });
}
let attempts = 0;
let seen = requestCheckGeneration();
/** The store, emptied when another provider was registered since it was last read. */
function entries() {
  if (seen !== requestCheckGeneration()) {
    seen = requestCheckGeneration();
    rawCache.clear();
    latest.clear();
  }
  return rawCache;
}
export { registerRequestChecks };
export const hasRequestCheckProvider = () => !!requestCheckProvider();
export function requestCheckResult(d: DiagramFile, target?: string): RequestCheckResult | undefined {
  return entries().get(keyOf(d, target));
}
function store(key: string, result: RequestCheckResult) {
  entries().delete(key);
  if (entries().size >= 8) entries().delete(entries().keys().next().value!);
  entries().set(key, result);
}
export function rememberRequestChecks(d: DiagramFile, findings: Finding[], target?: string): void {
  store(keyOf(d, target), {
    status: "ready",
    findings: findings.filter(
      (f) => !!f.requestFinding || !!f.resilienceFinding || !!f.cacheFinding || !!f.omitted || !!f.unchecked,
    ),
  });
}
export function rememberedRequestChecks(d: DiagramFile, target?: string): Finding[] | undefined {
  const result = requestCheckResult(d, target);
  return result?.status === "ready" ? result.findings : undefined;
}

/**
 * The request findings for `d`, once ready. A miss is pending work, never a successful empty check. A failure is
 * reported to everyone waiting on that attempt; a later call starts a new one.
 */
export function awaitRequestChecks(d: DiagramFile, options: RequestCheckOptions = {}): Promise<Finding[]> {
  if (options.signal?.aborted) return Promise.reject(options.signal.reason);
  if (options.target !== undefined) {
    const whole = requestCheckResult(d);
    if (whole?.status === "ready" && !whole.findings.some((f) => f.omitted || f.unchecked))
      return Promise.resolve(whole.findings.filter((f) => f.elements.includes(options.target!)));
  }
  const known = requestCheckResult(d, options.target);
  if (known?.status === "ready") return Promise.resolve(known.findings);
  if (known?.status === "pending") return read(known.done, options.signal);
  const controller = new AbortController();
  const done = trackRequestChecks(
    d,
    async () => {
      controller.signal.throwIfAborted();
      const provider = requestCheckProvider();
      if (provider) return provider(d, { target: options.target, signal: controller.signal });
      const [{ requestFindings }, { buildContext }] = await Promise.all([
        import("../checks/requestFindings"),
        import("../checks/context"),
      ]);
      const ctx = buildContext(d);
      ctx.local = true;
      ctx.requestTarget = options.target;
      controller.signal.throwIfAborted();
      return requestFindings(ctx);
    },
    options.target,
  );
  readers.set(done, { controller, count: 0 });
  return read(done, options.signal);
}

/**
 * Publish readiness before starting work so concurrent readers await the same result. Content that's already ready
 * stays ready while it's worked out again (the same content gives the same findings), and an attempt only settles the
 * entry it published: a slower, older attempt never overwrites a newer one.
 */
export function trackRequestChecks(
  d: DiagramFile,
  compute: () => Promise<Finding[]>,
  target?: string,
): Promise<Finding[]> {
  const key = keyOf(d, target);
  const known = entries().get(key);
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
        const current = entries().get(key);
        // The newest attempt publishes; an older one only fills a gap (nothing there, or a newer failure).
        if (settle() || !current || current.status === "failed") rememberRequestChecks(d, findings, target);
        return findings;
      },
      (cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        if (settle() && pending && entries().get(key) === pending) store(key, { status: "failed", error });
        throw error;
      },
    );
  if (known?.status !== "ready") store(key, (pending = { status: "pending", done }));
  return done;
}
