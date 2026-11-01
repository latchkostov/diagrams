import { isDependency } from "../model/relations";
import type { EditorApi } from "../editor/types";
import { planTurn } from "../ai/ui/apply";
import { parseReply } from "../ai/ui/reply";
import { commitPlan } from "../ai/ui/commitTurn";
import { threads } from "../ai/ui/threadStore";
import { undoAiTurn, revertAiTurn } from "../ai/ui/historyActions";
import { workerReply, renameReply } from "./catalog/agentReplies";

export function resetAgentPractice(documentId: string) {
  threads.set(documentId, []);
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
      // Reconstruct the supplied addition on the learner's current base, so Undo never consumes their later edit.
      const current = editor.getDiagram();
      const added = new Set(
        turn.after?.nodes.filter((n) => n.stencil === "service.go" && turn.changed.includes(n.id)).map((n) => n.id),
      );
      const baseline = {
        ...current,
        nodes: current.nodes.filter((n) => !added.has(n.id)),
        edges: current.edges.filter((e) => !added.has(e.from) && !added.has(e.to)),
      };
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
            { op: "connect", from: "api", to: existing.id, kind: "async" },
          ],
        })
      : action === "add"
        ? workerReply
        : renameReply;
  let plan = planTurn(current, parseReply(reply));
  if (plan.ok && !plan.hasChanges && action === "add" && existing) {
    // An equivalent learner edit still needs a real turn, with its existing identity and properties intact.
    editor.applyDiagram({
      ...current,
      nodes: current.nodes.filter((n) => n.id !== existing.id),
      edges: current.edges.filter((e) => e.from !== existing.id && e.to !== existing.id),
    });
    plan = planTurn(editor.getDiagram(), parseReply(JSON.stringify(current)));
  }
  if (!plan.ok || !plan.hasChanges) throw new Error("Practice reply refused");
  threads.append(documentId, commitPlan(editor, plan, { request: "", engine: "paste" }));
}
