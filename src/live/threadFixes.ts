import { t } from "../i18n";
import { effectiveCallerPolicy } from "../editor/callerPolicy";
import { notify } from "../interop/ui/toast";
import type { EditorApi } from "../editor/types";
import type { InteractionController } from "../canvas/interaction/controller";
import type { LiveController } from "./controller";
import type { TroubleAction } from "./observedTrouble";

// Applying a verified thread-exhaustion fix (src/live/threadFixPlan.ts) from the trouble callout. It ships in the
// callout's own lazy chunk (src/live/TroubleCallout.tsx imports it and hands it to the click), so the live view never
// downloads it until a callout is on screen, and it is always there, synchronously, when its button is pressed.

export type ThreadFixAction = Extract<TroubleAction, { kind: "free-thread" | "add-timeout" | "scale-threads" }>;

export interface ThreadFixContext {
  editor: EditorApi;
  controller: LiveController;
  interaction: Pick<InteractionController, "dispatch"> | null | undefined;
}

export type ApplyThreadFix = (ctx: ThreadFixContext, action: ThreadFixAction, label: string) => void;

/**
 * One undoable edit: into the running saved simulation (its toast names it) or the diagram. The toast's Undo hands
 * focus back to the canvas after the history commit when the toast held it (focus policy row L3).
 */
export const applyThreadFix: ApplyThreadFix = ({ editor, controller, interaction }, action, label) => {
  const undo = () => {
    const hadFocus = !!document.activeElement?.closest("[data-toast]");
    editor.undo();
    interaction?.dispatch({ type: "callout.closed", hadFocus, undo: true });
  };
  if (action.kind === "free-thread") {
    const effective = effectiveCallerPolicy(editor, action.edge);
    if (!effective?.editable) return;
    effective.set({ wait: "non-blocking" });
    sayThreadFix(undo, t("threads.freeAction"), effective.simulation);
  } else if (action.kind === "scale-threads") {
    const diagram = editor.getDiagram();
    const st = controller.getState();
    const saved = diagram.simulations?.find((s) => s.id === st.simulation?.id);
    if (st.simulation && (!saved || JSON.stringify(st.simulation) !== JSON.stringify(saved))) return;
    if (saved) {
      const next = { ...saved, setup: { ...saved.setup, props: { ...saved.setup?.props } } };
      for (const change of action.changes)
        next.setup.props[change.node] = { ...next.setup.props[change.node], ...change.props };
      editor.updateMeta({ simulations: diagram.simulations!.map((s) => (s.id === saved.id ? next : s)) });
      controller.setBase(next);
    } else {
      editor.applyDiagram({
        ...diagram,
        nodes: diagram.nodes.map((n) => {
          const change = action.changes.find((c) => c.node === n.id);
          return change ? { ...n, props: { ...n.props, ...change.props } } : n;
        }),
      });
    }
    // The words on the button the person pressed, in their language.
    sayThreadFix(undo, label, saved?.title);
  } else {
    const effective = effectiveCallerPolicy(editor, action.edge);
    const edge = editor.getEdge(action.edge);
    if (!effective?.editable || !edge) return;
    effective.set({ deadlineMs: action.deadlineMs });
    const from = editor.getNode(edge.from)?.label || edge.from;
    const to = editor.getNode(edge.to)?.label || edge.to;
    notify(
      effective.simulation
        ? t("threads.addedTimeoutSimulation", { ms: action.deadlineMs, from, to, simulation: effective.simulation })
        : t("threads.addedTimeoutDiagram", { ms: action.deadlineMs, from, to }),
      { action: { label: t("shortcuts.undo"), run: undo, testId: "add-timeout-undo", undoes: true } },
    );
  }
};

function sayThreadFix(undo: () => void, fix: string, simulation?: string): void {
  notify(simulation ? t("threads.fixedSimulation", { fix, simulation }) : t("threads.fixedDiagram", { fix }), {
    action: { label: t("shortcuts.undo"), run: undo, testId: "thread-fix-undo", undoes: true },
  });
}
