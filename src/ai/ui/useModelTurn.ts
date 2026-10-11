// A turn with the connected model: the engine chunk loads on the first request, the model's words stream
// in, and its tool calls land on the diagram as one undo step when it finishes. A local-only diagram never
// reaches the model: checked before loading, before every call and before applying.

import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorApi } from "../../editor/types";
import { diagramDiff } from "../../model/diagramDiff";
import { paletteHost } from "../../palette/host";
import { isLocalOnly } from "../../lib/localOnly";
import { LOCAL_ONLY_MESSAGE, describeForAi } from "../privacy";
import { connection } from "../engine/settings";
import { showApplied } from "./feedback";
import { sameContent, type ThreadTurn } from "./thread";

export interface ModelRequest {
  request: string;
  intent: "change" | "explain";
  /** Extra lines for the model (the selected elements, live numbers). */
  context?: string;
  history: { role: "user" | "assistant"; text: string }[];
}

export interface ModelTurnDone {
  turn: Omit<ThreadTurn, "id" | "at">;
  /** Simulations the turn added or replaced (live view plays the first). */
  simulations: string[];
}

const editorNow = (): EditorApi | null => paletteHost.get().canvas?.editor ?? null;
const STOPS: Record<string, string> = {
  length: "The answer was cut off at the model's length limit.",
  refused: "The model declined this request.",
  steps: "The model was still working after several tool calls, so it was stopped there.",
};

let mergeSeq = 0;

export function useModelTurn(onDone: (done: ModelTurnDone) => void) {
  const [running, setRunning] = useState<{ request: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const stop = useCallback(() => abort.current?.abort(), []);

  const send = useCallback(
    async ({ request, intent, context, history }: ModelRequest): Promise<boolean> => {
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
      setRunning({ request, text: "" });
      const start = editor.getDiagram();
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
        const engineName = conn.provider;
        if (!result.changed || intent === "explain") {
          onDone({ turn: { kind: "explain", request, reply, changed: [], engine: engineName }, simulations: [] });
          return true;
        }
        const now = editorNow();
        if (!now || !stillAllowed() || !sameContent(now.getDiagram(), start))
          throw new Error("The diagram changed while the AI was working, so nothing was applied. Ask again.");
        now.applyDiagram(result.next, { merge: `ai:model:${++mergeSeq}` });
        const after = now.getDiagram();
        const diff = diagramDiff(start, after);
        const changed = [...diff.added.ids, ...diff.updated.ids];
        // A scenario alone reads like the paste flow's: "Added simulation “Storm”".
        const onlySim = diff.added.count + diff.updated.count === 1 && !diff.removed.count && !diff.metaChanged;
        const sim =
          onlySim &&
          after.simulations?.find((x) => x.id === [...diff.added.simulations, ...diff.updated.simulations][0]);
        const summary = sim ? `${diff.added.count ? "Added" : "Updated"} simulation “${sim.title}”` : diff.summary;
        showApplied(summary, changed, now);
        onDone({
          turn: { kind: "change", request, reply, summary, changed, after, engine: engineName },
          simulations: [...diff.added.simulations, ...diff.updated.simulations],
        });
        return true;
      } catch (err) {
        if (controller.signal.aborted) setError("Stopped. Nothing was applied.");
        else {
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

  return { running, error, setError, send, stop };
}
