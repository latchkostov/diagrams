import { useCallback, useLayoutEffect, useMemo, useRef, type FocusEvent, type KeyboardEvent } from "react";
import type { EditorApi } from "../../editor/types";
import { useInteraction } from "../interaction/useInteraction";

/**
 * A name field's keys (a node's Label, Subtitle and new Connection, a connection's or a boundary's Label): what's
 * typed is saved as it's typed, so Enter and Esc are both done. They hand focus back to the thing on the canvas
 * (`flowId`), so the next key acts on it, as after a rename anywhere else. A node's naming (`nodeId`) is done then,
 * or when focus leaves its name fields: a creation step still open on it closes, and `onDone` runs.
 */
export function useNameFields(
  editor: EditorApi,
  kind: "node" | "edge" | "group",
  id: string,
  flowId: string,
  onDone?: () => void,
) {
  const interaction = useInteraction();
  const tag = useRef<string | undefined>(undefined);
  const field = useRef<HTMLInputElement | null>(null);
  useLayoutEffect(
    () => () => {
      const input = field.current;
      const ending = tag.current;
      // StrictMode replays effects while the field stays mounted. Close only after a real removal.
      queueMicrotask(() => {
        if (ending && !input?.isConnected) {
          editor.doneNaming(ending);
          onDone?.();
        }
      });
    },
    [editor, onDone],
  );
  const done = useCallback(() => {
    if (tag.current) editor.doneNaming(tag.current);
    tag.current = undefined;
    onDone?.();
  }, [editor, onDone]);
  const keys = useMemo(
    () => ({
      "data-name-field": flowId,
      onFocus: (e: FocusEvent<HTMLInputElement>) => {
        field.current = e.currentTarget;
        tag.current ??= editor.beginNaming(kind, id);
      },
      onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
        if ((e.key !== "Enter" && e.key !== "Escape") || e.nativeEvent.isComposing) return;
        e.preventDefault();
        e.stopPropagation();
        const field = e.currentTarget;
        field.setSelectionRange(field.value.length, field.value.length);
        // Focus goes back to the named item on the canvas (focus policy, row N1).
        interaction?.dispatch({ type: "naming.done", flowId });
        done();
      },
      onBlur: () =>
        requestAnimationFrame(() => {
          if (document.activeElement?.getAttribute("data-name-field") !== flowId) done();
        }),
    }),
    [flowId, editor, kind, id, interaction, done],
  );
  return useMemo(() => ({ keys, merge: () => ({ merge: tag.current }) }), [keys]);
}
