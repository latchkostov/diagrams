import { isDependency } from "../model/relations";
import type { EditorApi } from "../editor/types";
import { planTurn } from "../ai/ui/apply";
import { parseReply } from "../ai/ui/reply";
import { commitPlan } from "../ai/ui/commitTurn";
import { threads } from "../ai/ui/threadStore";
import { undoAiTurn, revertAiTurn, observeAiUndo } from "../ai/ui/historyActions";
import { workerReply, renameReply } from "./catalog/agentReplies";

export function resetAgentPractice(documentId: string) {
  threads.set(documentId, []);
}

/** Reverse only the fields and identities touched by this turn, retaining later learner work. */
function reverseItems<T extends { id: string }>(current: T[], before: T[], after: T[]): T[] {
  const previous = new Map(before.map((item) => [item.id, item]));
  const applied = new Map(after.map((item) => [item.id, item]));
  const added = new Set(after.filter((item) => !previous.has(item.id)).map((item) => item.id));
  const present = new Set(current.map((item) => item.id));
  const reverted = current
    .filter((item) => !added.has(item.id))
    .map((item) => {
      const old = previous.get(item.id);
      const next = applied.get(item.id);
      if (!old || !next) return item;
      const result = { ...item };
      for (const key of new Set([...Object.keys(old), ...Object.keys(next)]) as Set<keyof T>) {
        if (JSON.stringify(old[key]) !== JSON.stringify(next[key])) {
          if (key in old) result[key] = old[key];
          else Reflect.deleteProperty(result, key);
        }
      }
      return result;
    });
  return [...reverted, ...before.filter((item) => !applied.has(item.id) && !present.has(item.id))];
}

/** Reconstructs genuine parsed turns and history, including Undo-reachable checkpoints. */
export function agentPractice(editor: EditorApi, documentId: string, action: "add" | "rename" | "undo" | "revert") {
  if (action === "undo" || action === "revert") {
    const turns = threads.get(documentId);
    const turn =
      action === "undo"
        ? turns.at(-1)
        : [...turns]
            .reverse()
            .find(
              (t) =>
                t.kind === "change" &&
                !t.undone &&
                t.after?.nodes.some((n) => n.stencil === "service.go" && n.label === "Status worker"),
            );
    if (turn && action === "undo" && turn.historyKey !== editor.undoTarget()) {
      // Reconstruct the actual delta on the current base, so Undo never consumes a later learner edit.
      const current = editor.getDiagram();
      if (!turn.before || !turn.after) throw new Error("Practice checkpoint unavailable");
      const nodes = reverseItems(current.nodes, turn.before.nodes, turn.after.nodes);
      // Shape annotations are connectable too, so an unrelated connection to one must survive the inverse.
      const remaining = new Set([
        ...nodes.map((n) => n.id),
        ...(current.annotations ?? []).filter((a) => a.kind === "shape").map((a) => a.id),
      ]);
      const baseline = {
        ...current,
        nodes,
        edges: reverseItems(current.edges, turn.before.edges, turn.after.edges).filter(
          (e) => remaining.has(e.from) && remaining.has(e.to),
        ),
      };
      const inverse = planTurn(current, parseReply(JSON.stringify(baseline)));
      if (inverse.ok && !inverse.hasChanges) {
        // The toolbar already reversed this turn (or Apply was equivalent). No history edit is needed.
        observeAiUndo(documentId, turn);
        return;
      }
      editor.applyDiagram(baseline);
      const plan = planTurn(editor.getDiagram(), parseReply(JSON.stringify(current)));
      if (!plan.ok || !plan.hasChanges) throw new Error("Practice checkpoint refused");
      threads.append(documentId, commitPlan(editor, plan, { request: "", engine: "paste" }));
      const rebuilt = threads.get(documentId).at(-1)!;
      if (!undoAiTurn(editor, documentId, rebuilt)) throw new Error("Practice history unavailable");
      return;
    }
    if (!turn || !(action === "undo" ? undoAiTurn(editor, documentId, turn) : revertAiTurn(editor, documentId, turn)))
      throw new Error("Practice history unavailable");
    return;
  }
  const current = editor.getDiagram();
  const workers = current.nodes.filter((n) => n.stencil === "service.go");
  const existing =
    workers.find((n) => current.edges.some((e) => e.from === "api" && e.to === n.id && !isDependency(e))) ?? workers[0];
  const reply =
    action === "add" && existing
      ? JSON.stringify({
          layout: "none",
          ops: [
            // Public fixture label must match the supplied local reply.
            // eslint-disable-next-line local/no-literal-ui-text
            { op: "update", target: existing.id, label: "Status worker" },
            ...(current.edges.some((e) => e.from === "api" && e.to === existing.id && !isDependency(e))
              ? []
              : [{ op: "connect", from: "api", to: existing.id, kind: "async" }]),
          ],
        })
      : action === "add"
        ? workerReply
        : renameReply;
  const plan = planTurn(current, parseReply(reply));
  if (!plan.ok || (!plan.hasChanges && !(action === "add" && existing))) throw new Error("Practice reply refused");
  const record = commitPlan(editor, plan, { request: "", engine: "paste" });
  // An equivalent reply still reviewed this worker. Retain its identity as evidence without fabricating an edit.
  threads.append(documentId, !plan.hasChanges && existing ? { ...record, changed: [existing.id] } : record);
}
