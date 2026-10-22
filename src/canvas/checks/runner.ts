import type { DiagramFile } from "../../model/types";
import type { CheckResult, Finding } from "../../checks/types";
import type { CheckRequest, CheckResponse } from "../../checks/worker";
import type { ScalingPlan } from "../../sim/scalingPlanner";
import { rememberPlans } from "../../lib/scenarioPlanner";
import { trackRequestChecks } from "../../lib/requestCheckCache";
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

const loadEngine = () => import("../../checks/run");

/** Provider for awaitRequestChecks: the same transport and fallback as background checks. */
export async function requestChecksOffThread(diagram: DiagramFile): Promise<Finding[]> {
  return (await computeChecksOffThread(diagram)).requests;
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

/** The checks for `diagram`. Rejects only if the engine itself can't load. */
export async function runChecksOffThread(diagram: DiagramFile): Promise<CheckResult> {
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
  const [{ runChecks }, { planScaling }, { requestFindings }, { buildContext }] = await Promise.all([
    loadEngine(),
    import("../../sim/scalingPlanner"),
    import("../../checks/requestFindings"),
    import("../../checks/context"),
  ]);
  if (!diagram.checks?.off?.includes("capacity")) rememberPlans(diagram, planScaling(diagram));
  const requests = requestFindings({ ...buildContext(diagram), local: true });
  return { result: runChecks(diagram, { local: true }), requests };
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
