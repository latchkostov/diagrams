import type { EditorApi } from "../../editor/types";
import { diffDiagrams, summarize } from "./apply";
import { threads } from "./threadStore";
import { turnId, type ThreadTurn } from "./thread";
import { observationPorts } from "../../lib/observations";
import { currentObservationSource } from "../../palette/observationSource";

/** The same history operations serve the panel and local tutorial reconstruction. */
export function undoAiTurn(editor: EditorApi, documentId: string, turn: ThreadTurn): boolean {
  if (!turn.historyKey || editor.undoTarget() !== turn.historyKey) return false;
  editor.undo();
  threads.update(documentId, (all) => all.map((t) => (t.id === turn.id ? { ...t, undone: true } : t)));
  const source = currentObservationSource();
  if (source?.documentId === documentId)
    observationPorts.ai.publish({ ...source, kind: "undo", changed: turn.changed });
  return true;
}

export function revertAiTurn(editor: EditorApi, documentId: string, turn: ThreadTurn): boolean {
  if (!turn.after) return false;
  const before = editor.getDiagram();
  const historyKey = `ai:${turnId()}`;
  editor.applyDiagram(turn.after, { merge: historyKey });
  const after = editor.getDiagram();
  const diff = diffDiagrams(before, after);
  const label = turn.revertLabel ?? (turn.request || turn.reply || turn.summary || "");
  threads.append(documentId, {
    kind: "revert",
    request: "",
    revertLabel: label.length > 60 ? `${label.slice(0, 60)}…` : label,
    summary: summarize(diff),
    changed: diff.changed,
    after,
    historyKey,
  });
  return true;
}
