// The checks off the main thread: the canvas posts the diagram after edits pause, and this worker runs the
// rules (capacity's fixed point can take a few hundred milliseconds on a big diagram with a feedback loop),
// so typing and dragging never wait on them. Same engine, same result as the main-thread fallback.

import type { DiagramFile } from "../model/types";
import "../sim/cache/cacheRuntime";
import type { CheckResult, Finding } from "./types";
import { executeChecks, executeRequestChecks } from "./execute";
import { planScaling, type ScalingPlan } from "../sim/scalingPlanner";
import { confirmedThreadFix, type ThreadFixRequest } from "../live/threadFixPlan";
import { confirmedResilienceFix } from "../live/resilienceFixPlan";
import { confirmedCacheFix } from "../live/cacheFixPlan";
import type { TroubleAction } from "../live/observedTrouble";

interface CheckWork {
  id: number;
  diagram: DiagramFile;
  /** Scenario sizing only (live playback): the same memoized planner the capacity check uses. */
  plan?: true;
  /** Request findings only (an agent's check or a fix waiting on them): no other rule runs. */
  requests?: true;
  /** Optional targeted output; old whole-diagram requests retain their original shape and behavior. */
  target?: string;
  threadFix?: ThreadFixRequest;
}
export type CheckRequest = CheckWork | { id: number; cancel: true };
export type CheckResponse =
  | { id: number; threadFix: TroubleAction | undefined }
  | {
      id: number;
      result: CheckResult;
      plans?: ScalingPlan[];
      /** Absent: none worked out (no enabled rule reads them). */ requests?: Finding[];
    }
  | { id: number; plans: ScalingPlan[] }
  | { id: number; requestsOnly: Finding[]; plans?: ScalingPlan[]; target?: string }
  | { id: number; error: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<CheckRequest>) => void) | null;
  postMessage(message: CheckResponse): void;
}
const scope = self as unknown as WorkerScope;
const queuedTargets = new Map<number, ReturnType<typeof setTimeout>>();

scope.onmessage = (e) => {
  if ("cancel" in e.data) {
    clearTimeout(queuedTargets.get(e.data.id));
    queuedTargets.delete(e.data.id);
    return;
  }
  if (e.data.requests && e.data.target !== undefined) {
    const request = e.data;
    queuedTargets.set(
      request.id,
      setTimeout(() => {
        queuedTargets.delete(request.id);
        execute(request);
      }, 0),
    );
    return;
  }
  execute(e.data);
};

function execute(request: CheckWork) {
  const e = { data: request };
  const { id, diagram, plan } = e.data;
  try {
    if (e.data.threadFix) {
      const request = e.data.threadFix;
      scope.postMessage({
        id,
        threadFix:
          request.trouble.action.kind === "cache"
            ? confirmedCacheFix({
                context: request.context,
                node: request.trouble.action.node,
                rule: request.trouble.action.rule,
                item: request.trouble.action.item,
                edge: request.trouble.action.edge,
                time: request.time,
              })
            : request.trouble.action.kind === "resilience"
              ? confirmedResilienceFix({
                  context: request.context,
                  edge: request.trouble.action.edge,
                  time: request.time,
                })
              : confirmedThreadFix(request),
      });
    } else if (plan) scope.postMessage({ id, plans: planScaling(diagram) });
    else if (e.data.requests) {
      const { requests, plans } = executeRequestChecks(diagram, e.data.target);
      scope.postMessage({
        id,
        requestsOnly: requests,
        plans,
        ...(e.data.target === undefined ? {} : { target: e.data.target }),
      });
    } else {
      // Scenario sizing goes back with the result when a check read it, for main-thread readers. A diagram with
      // capacity turned off (and no blocked caller's verified fix) plans nothing.
      const { result, requests, plans } = executeChecks(diagram);
      scope.postMessage({ id, result, plans, requests });
    }
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
}
