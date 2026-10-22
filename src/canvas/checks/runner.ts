import type { DiagramFile } from "../../model/types";
import type { CheckResult, Finding } from "../../checks/types";
import type { CheckRequest, CheckResponse } from "../../checks/worker";
import type { ScalingPlan } from "../../sim/scalingPlanner";
import { rememberPlans } from "../../lib/scenarioPlanner";
import { loadOnce } from "../../lib/lazyLoad";
import type { ThreadFixRequest } from "../../live/threadFixPlan";
import type { TroubleAction } from "../../live/observedTrouble";

// Runs the checks for the canvas: in a worker (src/checks/worker.ts) so the main thread only copies the
// diagram, or, where workers aren't available, by loading the engine (a lazy chunk) and running it here.
// Either way the engine never ships in the startup JavaScript or the canvas's own chunk.

type Pending = { resolve: (r: CheckResponse) => void; reject: (e: Error) => void };

let worker: Worker | null | undefined;
let seq = 0;
const pending = new Map<number, Pending>();

function failAll(message: string) {
  for (const p of pending.values()) p.reject(new Error(message));
  pending.clear();
}

/**
 * Starts the checks worker ahead of its first request (fetching and evaluating its script takes a while on a slow
 * machine): live view does when its callouts may need a verified fix. A no-op where there are no workers.
 */
export function warmChecksWorker(): void {
  if (typeof Worker === "function") getWorker();
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL("../../checks/worker.ts", import.meta.url), { type: "module", name: "checks" });
    worker.onmessage = (e: MessageEvent<CheckResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if ("error" in e.data) p.reject(new Error(e.data.error));
      else p.resolve(e.data);
    };
    worker.onerror = (e) => {
      e.preventDefault();
      // A worker that can't load (an old browser, a blocked script) hands over to the main-thread engine.
      worker?.terminate();
      worker = null;
      failAll(e.message || "the checks worker failed to load");
    };
  } catch {
    worker = null;
  }
  return worker;
}

/**
 * Provider for awaitRequestChecks: request findings only, in the checks worker (else here, the same function), with no
 * other rule run and scenario sizing only if a blocked caller's verified fix reads it.
 */
export async function requestChecksOffThread(diagram: DiagramFile): Promise<Finding[]> {
  const w = typeof Worker === "function" ? getWorker() : null;
  if (w) {
    const id = ++seq;
    const request: CheckRequest = { id, diagram, requests: true };
    try {
      const response = await new Promise<CheckResponse>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage(request);
      });
      if ("requestsOnly" in response) {
        if (response.plans) rememberPlans(diagram, response.plans);
        return response.requestsOnly;
      }
    } catch {
      // Fall through: the worker failed; the main thread works them out.
    }
  }
  const { executeRequestChecks } = await import("../../checks/execute");
  const { requests, plans } = executeRequestChecks(diagram);
  if (plans) rememberPlans(diagram, plans);
  return requests;
}

/**
 * No speculative callout fixes, and no reruns on the UI thread. The caller keeps at most one in flight
 * (src/live/useObservedTrouble.ts); a failed worker resolves to no fix.
 */
export async function threadFixOffThread(threadFix: ThreadFixRequest): Promise<TroubleAction | undefined> {
  const w = typeof Worker === "function" ? getWorker() : null;
  if (!w) return;
  const id = ++seq;
  try {
    const response = await new Promise<CheckResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      // The context's diagram is the request's: one copy crosses to the worker.
      w.postMessage({ id, diagram: threadFix.context.origin.diagram, threadFix } satisfies CheckRequest);
    });
    return "threadFix" in response ? response.threadFix : undefined;
  } catch {
    return;
  }
}

/** A failed download is forgotten, so the next check downloads it again. */
const loadRequestStore = loadOnce(() => import("../../lib/requestCheckCache"));

/**
 * The checks for `diagram`. Rejects only if the engine itself can't load. The request-check store is a chunk of its
 * own, loaded with the first check (never at startup or with the canvas): agents and fixes read it later.
 */
export async function runChecksOffThread(diagram: DiagramFile): Promise<CheckResult> {
  const { trackRequestChecks } = await loadRequestStore();
  let completed!: { result: CheckResult; requests: Finding[] };
  await trackRequestChecks(diagram, async () => {
    completed = await computeChecksOffThread(diagram);
    return completed.requests;
  });
  return completed.result;
}

async function computeChecksOffThread(diagram: DiagramFile): Promise<{ result: CheckResult; requests: Finding[] }> {
  const w = typeof Worker === "function" ? getWorker() : null;
  if (w) {
    const id = ++seq;
    const request: CheckRequest = { id, diagram };
    try {
      const response = await new Promise<CheckResponse>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage(request);
      });
      if ("result" in response) {
        if (response.plans) rememberPlans(diagram, response.plans);
        if (!response.requests) throw new Error("The checks worker returned no request-check result");
        return { result: response.result, requests: response.requests };
      }
    } catch {
      // Fall through: the worker failed; the main thread runs this one.
    }
  }
  // No worker (an old browser, a blocked script): this thread does all the checking, scenario sizing included.
  // The worker's own path (one context, scenario sizing only when a check reads it), then its plans remembered.
  const { executeChecks } = await import("../../checks/execute");
  const { result, requests, plans } = executeChecks(diagram);
  if (plans) rememberPlans(diagram, plans);
  return { result, requests };
}

/** Scenario sizing for live playback: the checks worker's planner (memoized with the capacity check's). */
export async function planOffThread(diagram: DiagramFile): Promise<ScalingPlan[]> {
  const w = typeof Worker === "function" ? getWorker() : null;
  if (w) {
    const id = ++seq;
    const request: CheckRequest = { id, diagram, plan: true };
    try {
      const response = await new Promise<CheckResponse>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage(request);
      });
      if ("plans" in response && response.plans) return response.plans;
    } catch {
      // Fall through to the main thread.
    }
  }
  const { planScaling } = await import("../../sim/scalingPlanner");
  const plans = planScaling(diagram);
  rememberPlans(diagram, plans);
  return plans;
}
