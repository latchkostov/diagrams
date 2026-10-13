import { applyOps } from "../../ai/ops";
import type { EditorApi } from "../../editor/types";
import type { CheckIgnore, DiagramChecks } from "../../model/types";
import { notify } from "../../interop/ui/toast";
import { runChecks } from "../run";
import type { CheckRuleId, Finding } from "../types";

// What a person does with a finding, each one undo step: apply its fix (the same ops agents send through
// edit_diagram, applied by the ops core), ignore it here (with an optional reason) or turn its check off for
// this diagram, and bring either back. Ignores and turned-off checks live in the file (`checks`).

let seq = 0;

/**
 * Applies a finding's fix as one undo step, with a toast that says what changed and offers Undo. The finding is
 * checked again first, on the diagram as it is now (its rule only): a finding that no longer holds isn't fixed
 * (a second click adds no second queue), and the fix applied is the one worked out now (a capacity fix sizes from
 * today's replicas, not the ones the cached check saw). `option` picks one of the fix's other options by its label.
 */
export function applyFix(editor: EditorApi, finding: Finding, option?: string): boolean {
  if (!finding.fix?.ops) return false;
  const current = editor.getDiagram();
  const fresh = runChecks(current, { rules: [finding.rule] }).findings.find((f) => f.id === finding.id);
  // One of the fix's other options, by its words (the same option worked out now).
  const chosen = option === undefined ? undefined : fresh?.fix?.options?.find((o) => o.label === option);
  const ops = option === undefined ? fresh?.fix?.ops : chosen?.ops;
  if (!ops) {
    notify("Nothing to fix: the diagram already changed.", { kind: "info" });
    return false;
  }
  const result = applyOps(current, ops);
  if (!result.ok) {
    notify(`Couldn't apply the fix: ${result.errors[0]?.error ?? "the diagram changed"}`, { kind: "error" });
    return false;
  }
  const diff = editor.applyDiagram(result.diagram, { merge: `check:fix:${++seq}` });
  if (!diff.hasChanges) return false;
  const added = diff.added.nodes.map((id) => result.diagram.nodes.find((n) => n.id === id)?.label).filter(Boolean);
  const text = added.length ? `Added ${added.join(", ")}` : `${chosen?.label ?? fresh!.fix!.label}: done`;
  notify(text, {
    kind: "success",
    action: { label: "Undo", run: () => editor.undo(), testId: "check-fix-undo", undoes: true },
  });
  return true;
}

const checksOf = (editor: EditorApi): DiagramChecks => editor.getDiagram().checks ?? {};

function save(editor: EditorApi, next: DiagramChecks, text: string) {
  const checks: DiagramChecks = {
    ...(next.off?.length ? { off: next.off } : {}),
    ...(next.ignore?.length ? { ignore: next.ignore } : {}),
  };
  // Each its own undo step: a tag of its own flushes whatever edit was pending before it.
  editor.updateMeta({ checks: checks.off || checks.ignore ? checks : undefined }, { merge: `check:settings:${++seq}` });
  notify(text, { action: { label: "Undo", run: () => editor.undo(), testId: "check-settings-undo", undoes: true } });
}

export function ignoreFinding(editor: EditorApi, finding: Finding, reason: string) {
  const c = checksOf(editor);
  const entry: CheckIgnore = {
    rule: finding.rule,
    target: finding.target,
    ...(reason.trim() ? { reason: reason.trim().slice(0, 200) } : {}),
  };
  const ignore = [...(c.ignore ?? []).filter((i) => !(i.rule === entry.rule && i.target === entry.target)), entry];
  save(editor, { ...c, ignore }, "Ignored here. It's kept in the file.");
}

export function unignore(editor: EditorApi, rule: string, target: string) {
  const c = checksOf(editor);
  save(
    editor,
    { ...c, ignore: (c.ignore ?? []).filter((i) => !(i.rule === rule && i.target === target)) },
    "Shown again",
  );
}

export function turnOff(editor: EditorApi, rule: CheckRuleId, name: string) {
  const c = checksOf(editor);
  save(editor, { ...c, off: [...new Set([...(c.off ?? []), rule])] }, `“${name}” is off for this diagram`);
}

export function turnOn(editor: EditorApi, rule: string, name: string) {
  const c = checksOf(editor);
  save(editor, { ...c, off: (c.off ?? []).filter((r) => r !== rule) }, `“${name}” is on again`);
}
