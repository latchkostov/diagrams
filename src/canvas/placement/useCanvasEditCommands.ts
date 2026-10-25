import { useCallback, useLayoutEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { InteractionController, Placing } from "../interaction";
import { flushSync } from "react-dom";
import type { EditorApi, NewNode, XYBox } from "../../editor/types";
import type { useHistory } from "../../editor/useHistory";
import type { AnnotationKind, AnnotationShape } from "../../model/types";
import { notify } from "../../interop/ui/toast";
import { t as tr } from "../../i18n";
import type { InlineEdit, RenameTarget } from "../DiagramContext";
import { GROUP_PREFIX } from "../types";
import { captureTypeAhead } from "../typeAhead";
import type { useRevealSelection } from "../camera";

export function useCanvasNaming(
  canOpenInspector: boolean,
  editor: EditorApi,
  openInspector: (field?: string, caret?: "end", target?: string) => void,
  setEditing: Dispatch<SetStateAction<InlineEdit | null>>,
  setNaming: Dispatch<SetStateAction<{ node: string; edge: string } | null>>,
  renameRef: RefObject<(t: RenameTarget) => void>,
  history: ReturnType<typeof useHistory>,
  controller: Placing & Pick<InteractionController, "dispatch">,
  revealSelection: ReturnType<typeof useRevealSelection>["revealSelection"],
) {
  /**
   * Names a node, connection or boundary in the inspector (the owner's decision, 2026-10-13: no renaming in
   * place): it's selected alone, the inspector opens, and its Label takes focus with all of it selected, so
   * typing replaces it. A name typed before the field could take it is written and the caret goes after it.
   */
  const renameIn = useCallback(
    (t: RenameTarget) => {
      if (!canOpenInspector) return;
      setEditing(null);
      editor.select(
        t.kind === "node" ? { nodeIds: [t.id] } : t.kind === "edge" ? { edgeIds: [t.id] } : { groupIds: [t.id] },
      );
      setNaming(t.kind === "node" && t.edge ? { node: t.id, edge: t.edge } : null);
      const typed = t.kind === "node" && t.text !== undefined;
      if (typed) editor.updateNode(t.id, { label: t.text }, { merge: editor.creating(t.id) });
      openInspector(
        t.kind === "node" && t.field === "sublabel" ? "sublabel" : "label",
        typed ? "end" : undefined,
        t.kind === "group" ? GROUP_PREFIX + t.id : t.id,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- state setters are stable; preserve CanvasView's original dependencies
    [canOpenInspector, editor, openInspector],
  );
  useLayoutEffect(() => {
    renameRef.current = renameIn;
  });

  /**
   * A node made by quick-add (a dropped connection, Alt+arrow, the "+", a double-click on the canvas) or
   * Alt+Shift+arrow: in view, then its name in the inspector, selected (decision 3), so typing names it. Keys
   * typed meanwhile are kept for it (React Flow measures the card before showing it).
   */
  const endCreation = history.end;
  const pickNamed = useCallback(
    (make: () => NewNode | null, fallback: string) => {
      // Hold what's typed from now until the label editor can take it.
      let annotation = false;
      // Enter/Esc ends naming even before measurement. Keep the buffered result for the reveal callback,
      // but release keyboard ownership now so the next canvas shortcut can act on the new selection.
      const typing = captureTypeAhead(
        () => annotation,
        () => void typing.stop(),
      );
      controller.placing();
      const made = make();
      if (!made) return void typing.stop();
      annotation = made.annotation ?? !!editor.getAnnotation(made.id);
      revealSelection(
        () => {
          const typed = typing.stop();
          const isAnn = annotation;
          if (typed.done === "escape" && !isAnn) return endCreation(made.merge);
          if (typed.done) {
            if (typed.text !== null) {
              if (isAnn) editor.updateAnnotation(made.id, { text: typed.text }, { merge: made.merge });
              else editor.updateNode(made.id, { label: typed.text.trim() || fallback }, { merge: made.merge });
            }
            endCreation(made.merge);
            if (isAnn) controller.dispatch({ type: "naming.done", flowId: made.id });
            return;
          }
          // In this same task: a key arriving before the field has focus would reach the canvas instead.
          flushSync(() =>
            editor.startEditing({
              kind: isAnn ? "annotation" : "node",
              id: made.id,
              text: typed.text ?? undefined,
              ...(isAnn ? { merge: made.merge } : { edge: made.edge ?? undefined }),
            }),
          );
        },
        90,
        "placement",
        () => void typing.stop(),
      );
    },
    [editor, revealSelection, endCreation, controller],
  );

  /** For the editor's `nameNew` (menus and Ctrl+K: Insert node on an edge). */
  const nameNew = useRef(pickNamed);
  useLayoutEffect(() => {
    nameNew.current = pickNamed;
  });
  return [renameIn, pickNamed, nameNew] as const;
}

export function usePlacementSettling(editor: EditorApi) {
  /** Text isn't a routing obstacle: one that grew over a node or edge moves clear (undoable, said so). */
  const settleText = useCallback(
    (id: string, before: XYBox) => {
      // Once the edit (and any growth it caused) has rendered.
      setTimeout(() => {
        const hit = editor.keepTextClear(id, before);
        if (hit)
          notify(hit === "node" ? tr("chrome.movedTheTextOffANode") : tr("chrome.movedTheTextOffAnEdge"), {
            action: {
              get label() {
                return tr("ai.undo");
              },
              run: editor.undo,
              testId: "text-moved-undo",
              undoes: true,
            },
          });
      }, 60);
    },
    [editor],
  );
  /** A boundary resized by hand adopts the nodes now inside it and releases those outside (D12), and says so. */
  const boundaryResized = useCallback(
    (groupId: string) =>
      // Once the resize's last size has landed.
      requestAnimationFrame(() => {
        const { adopted, released } = editor.adoptAfterResize(groupId);
        if (!adopted.length && !released.length) return;
        const name = editor.getGroup(groupId)?.label || tr("chrome.theBoundary");
        const text = !released.length
          ? tr("chrome.addedValueOtherValueNodesToValue", { count: adopted.length, name })
          : !adopted.length
            ? tr("chrome.tookValueOtherValueNodesOutOfValue", { count: released.length, name })
            : tr("chrome.addedValueOtherValueNodesToValueAndTookValue", {
                count: adopted.length,
                name,
                released: released.length,
              });
        notify(text, {
          action: {
            get label() {
              return tr("ai.undo");
            },
            run: editor.undo,
            testId: "membership-undo",
            undoes: true,
          },
        });
      }),
    [editor],
  );
  return [settleText, boundaryResized] as const;
}

export function useAddFromPalette(editor: EditorApi, live: boolean, controller: Placing) {
  // With exactly one node selected, a rail click adds after it, connected, as Ctrl+K does (decision 4).
  // Live view adds a node by itself, as before: nothing gets wired mid-run.
  const addFromPalette = useCallback(
    (id: string) => {
      controller.placing();
      void (live ? editor.addNode(id) : editor.addStencil(id));
    },
    [editor, live, controller],
  );
  return addFromPalette;
}

export function useAnnotateFromPalette(editor: EditorApi, controller: Placing) {
  const annotateFromPalette = useCallback(
    (kind: AnnotationKind, shape?: AnnotationShape) => {
      controller.placing();
      void editor.addAnnotation(kind, { shape });
    },
    [editor, controller],
  );
  return annotateFromPalette;
}
