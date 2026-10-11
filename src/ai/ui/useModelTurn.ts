// A turn with the connected model: the engine chunk loads on the first request, the model's words stream
// in, and its tool calls land on the diagram as one undo step when it finishes. The model works on a
// draft; what lands is its recorded steps, planned on the diagram as it is by then (the same plan and
// commit as a pasted reply), so an edit made meanwhile is never overwritten. A local-only diagram never
// reaches the model: checked before loading, before every call and before applying.

import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorApi } from "../../editor/types";
import { paletteHost } from "../../palette/host";
import { isLocalOnly } from "../../lib/localOnly";
import { LOCAL_ONLY_MESSAGE, describeForAi } from "../privacy";
import { connection } from "../engine/settings";
import { planSteps } from "./apply";
import { commitPlan, type TurnRecord } from "./commitTurn";
import type { ThreadTurn } from "./thread";

export interface ModelRequest {
  request: string;
  intent: "change" | "explain";
  /** Extra lines for the model (the selected elements, live numbers). */
  context?: string;
  history: { role: "user" | "assistant"; text: string }[];
  /** The selection the request is about (recorded on the turn). */
  scope?: ThreadTurn["scope"];
}

export interface ModelTurnDone {
  turn: TurnRecord;
  /** The simulation the turn added or replaced (live view plays it). */
  simulationId?: string;
}

export const CHANGED_MEANWHILE =
  "The diagram changed while the AI was working, and its changes no longer fit it. Nothing was applied.";

/** A full-document fingerprint: any edit at all, a move included, changes it. */
const fingerprint = (editor: EditorApi) => JSON.stringify(editor.getDiagram());

const editorNow = (): EditorApi | null => paletteHost.get().canvas?.editor ?? null;
const STOPS: Record<string, string> = {
  length: "The answer was cut off at the model's length limit.",
  refused: "The model declined this request.",
  steps: "The model was still working after several tool calls, so it was stopped there.",
};

export function useModelTurn(onDone: (done: ModelTurnDone) => void) {
  const [running, setRunning] = useState<{ request: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The request that failed, for Retry. */
  const [failed, setFailed] = useState<ModelRequest | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const stop = useCallback(() => abort.current?.abort(), []);

  const send = useCallback(
    async (req: ModelRequest): Promise<boolean> => {
      const { request, intent, context, history, scope } = req;
      const conn = connection.get();
      const editor = editorNow();
      const canvas = paletteHost.get().canvas;
      if (!conn || !editor || abort.current) return false;
      if (isLocalOnly(canvas)) {
        setError(LOCAL_ONLY_MESSAGE);
        return false;
      }
      const documentId = canvas?.documentId;
      const stillAllowed = () => {
        const now = paletteHost.get().canvas;
        return !!now && now.documentId === documentId && !isLocalOnly(now);
      };
      const controller = new AbortController();
      abort.current = controller;
      setError(null);
      setFailed(null);
      setRunning({ request, text: "" });
      const start = editor.getDiagram();
      const startKey = fingerprint(editor);
      try {
        const engine = await import("../engine");
        const result = await engine.runAgentTurn({
          adapter: engine.adapters[conn.provider],
          key: conn.key,
          model: conn.model,
          intent,
          diagram: start,
          describe: describeForAi(editor, canvas),
          context,
          request,
          history,
          canUseAi: stillAllowed,
          signal: controller.signal,
          onText: (delta) => setRunning((r) => (r ? { ...r, text: r.text + delta } : r)),
        });
        const note = STOPS[result.stop];
        const reply = [result.text, note].filter(Boolean).join("\n\n") || "Done.";
        const answer = (): ModelTurnDone => ({
          turn: { kind: "explain", request, reply, changed: [], engine: conn.provider, ...(scope ? { scope } : {}) },
        });
        if (!result.steps.length || intent === "explain") {
          onDone(answer());
          return true;
        }
        const now = editorNow();
        if (!now || !stillAllowed())
          throw new Error("The diagram closed while the AI was working. Nothing was applied.");
        // Edited meanwhile (a move counts): the steps are replayed on the diagram as it is now, if they
        // still apply; a full re-layout would undo those edits, so it never replays over them.
        const moved = fingerprint(now) !== startKey;
        const relayout = result.steps.some((st) => st.kind === "file" || (st.kind === "ops" && st.layout === "full"));
        const plan = moved && relayout ? null : planSteps(now.getDiagram(), result.steps);
        if (!plan || !plan.ok) {
          setFailed(req);
          setError(moved ? CHANGED_MEANWHILE : `Nothing was applied. ${plan?.ok === false ? plan.error.error : ""}`);
          return false;
        }
        if (!plan.hasChanges) {
          onDone(answer());
          return true;
        }
        const turn = commitPlan(now, plan, {
          request,
          engine: conn.provider,
          reply: moved
            ? `${reply}

(Applied on top of the edits you made meanwhile.)`
            : reply,
          ...(scope ? { scope } : {}),
        });
        onDone({ turn, ...(plan.simulationId ? { simulationId: plan.simulationId } : {}) });
        return true;
      } catch (err) {
        if (controller.signal.aborted) setError("Stopped. Nothing was applied.");
        else {
          setFailed(req);
          const { redact } = await import("../engine/http");
          setError(redact(err instanceof Error ? err.message : String(err), conn.key));
        }
        return false;
      } finally {
        abort.current = null;
        setRunning(null);
      }
    },
    [onDone],
  );

  const retry = useCallback(() => {
    if (failed) void send(failed);
  }, [failed, send]);

  return { running, error, setError, send, stop, canRetry: !!failed && !running, retry };
}
