import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorApi } from "../../editor/types";
import { paletteHost } from "../../palette/host";
import { canUseOnDevice } from "../../lib/localOnly";
import { aiOffMessage } from "../privacy";
import { planTurn } from "../ui/apply";
import { commitPlan, type TurnRecord } from "../ui/commitTurn";
import { resolveScope } from "../ui/context";
import { sameContent } from "../ui/thread";
import { isAbort, runOnDevice, TIMED_OUT, type OnDeviceStatus } from "./pipeline";
import type { ModelSession } from "./promptApi";
import { primedSession } from "./session";

// One on-device request's life: read the diagram (after the privacy check), wait for the model, ask,
// and commit only if the diagram is still the one asked about, still in the editor and still allowed to
// reach AI. Leaving the editor, another diagram or a local-only switch cancels a request in flight.

export const FAILED = "Couldn't apply that. Try rephrasing.";
export const CHANGED = "The diagram changed while the model was thinking. Send it again.";
const TOO_BIG = "This diagram is too big for the on-device model. Select the part to change and try again.";
const SLOW = "The on-device model took too long to answer. Try again, or ask for a smaller change.";

/** The editor, when this diagram may be read and changed by the model now; null otherwise. */
function editable(documentId: string | undefined): EditorApi | null {
  const canvas = paletteHost.get().canvas;
  if (!canvas || canvas.documentId !== documentId || canvas.live || !canUseOnDevice(canvas)) return null;
  return canvas.editor;
}

/** Waits for `promise`, or rejects at once when `signal` aborts (the work itself may finish later). */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

export function useOnDeviceRequest({
  documentId,
  blocked,
  onTurn,
}: {
  documentId: string | undefined;
  /** Live view or a local-only diagram: no request starts, and one in flight is cancelled. */
  blocked: boolean;
  onTurn: (turn: TurnRecord) => void;
}) {
  const [status, setStatus] = useState<OnDeviceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const cancel = useCallback(() => abort.current?.abort(), []);
  // Unmounting (another diagram, the panel closed) or a blocked editor cancels what's in flight.
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (blocked) abort.current?.abort();
  }, [blocked]);

  /** Sends one request; true when it became a turn. */
  const send = async (text: string): Promise<boolean> => {
    const request = text.trim();
    if (!request || abort.current) return false;
    setError(null);
    // Provenance first: a local-only diagram is never read for the model.
    const ed = editable(documentId);
    if (!ed) {
      const canvas = paletteHost.get().canvas;
      if (!canUseOnDevice(canvas)) setError(aiOffMessage(canvas));
      return false;
    }
    const diagram = ed.getDiagram();
    const sel = ed.getSelection();
    const scope = resolveScope(diagram, [...sel.nodeIds, ...sel.edgeIds, ...sel.groupIds]);
    const controller = new AbortController();
    const { signal } = controller;
    abort.current = controller;
    setStatus("thinking");
    let session: ModelSession | null = null;
    let base: ModelSession | null = null;
    try {
      base = await untilAborted(primedSession(), signal);
      if (base.clone) {
        const cloning = base.clone({ signal });
        // A clone that finishes after a cancel is freed, not leaked.
        void cloning.then((s) => signal.aborted && s.destroy()).catch(() => undefined);
        session = await untilAborted(cloning, signal);
      } else session = base;
      // Provenance again, right before inference: pasted content can make the diagram local-only.
      if (!editable(documentId)) controller.abort();
      signal.throwIfAborted();
      const primed = base;
      const result = await runOnDevice({
        session,
        // After a transient Prompt API error: one more clone of the primed session.
        freshSession: primed.clone ? () => primed.clone!({ signal }) : undefined,
        diagram,
        request,
        scope,
        signal,
        onStatus: setStatus,
      });
      signal.throwIfAborted();
      if (!result.ok) {
        setError(result.tooBig ? TOO_BIG : result.error === TIMED_OUT ? SLOW : FAILED);
        return false;
      }
      // Commit only into the same diagram, still in the editor, still allowed to reach AI, and with the
      // content it was asked about (a move meanwhile is fine: the plan is made on the diagram as it is).
      const now = editable(documentId);
      if (!now) return false;
      const latest = now.getDiagram();
      if (!sameContent(latest, diagram)) {
        setError(CHANGED);
        return false;
      }
      const plan = planTurn(latest, { ok: true, kind: "ops", ops: result.ops });
      if (!plan.ok || !plan.hasChanges) {
        setError(FAILED);
        return false;
      }
      onTurn(commitPlan(now, plan, { request: request.slice(0, 400), engine: "on-device", reply: result.summary }));
      return true;
    } catch (err) {
      if (!isAbort(err) && !signal.aborted) setError(FAILED);
      return false;
    } finally {
      if (session && session !== base) session.destroy();
      if (abort.current === controller) abort.current = null;
      setStatus(null);
    }
  };

  return { status, busy: status !== null, error, setError, send, cancel };
}
