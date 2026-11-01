// The way a pasted reply (the AI panel's Advanced flow) lands on the diagram, like an agent's change: one
// applyDiagram under a tag of its own (so the thread can tell when Undo would reverse exactly this
// turn), the toast with Undo and the highlight, and the turn's record for the conversation.

import type { EditorApi } from "../../editor/types";
import type { TurnPlan } from "./apply";
import { showApplied } from "./feedback";
import { turnId, type ThreadTurn } from "./thread";

export type TurnRecord = Omit<ThreadTurn, "id" | "at">;

export function commitPlan(
  editor: EditorApi,
  plan: Extract<TurnPlan, { ok: true }>,
  record: Pick<ThreadTurn, "request" | "engine"> & Partial<Pick<ThreadTurn, "reply" | "scope">>,
): TurnRecord {
  const historyKey = `ai:${turnId()}`;
  const before = editor.getDiagram();
  editor.applyDiagram(plan.next, { merge: historyKey });
  showApplied(plan.summary, plan.changed, editor, { turnUndo: true, reveal: true });
  return {
    kind: "change",
    ...record,
    summary: plan.summary,
    changed: plan.changed,
    ...(plan.choices.length ? { choices: plan.choices } : {}),
    ...(plan.warnings.length ? { warnings: plan.warnings } : {}),
    after: editor.getDiagram(),
    before,
    historyKey,
  };
}
