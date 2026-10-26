import { useCallback, useLayoutEffect, useRef } from "react";
import type { EditorApi } from "../../editor/types";
import { bulkStep } from "./editTransactions";

/** A pointer adjustment or focused keyboard burst owns one history transaction. */
export function useEditTransaction(editor: EditorApi, field: string) {
  const tag = useRef<string | undefined>(undefined);
  const begin = useCallback(() => {
    if (tag.current) return;
    tag.current = bulkStep(field).merge;
    editor.beginEdit(tag.current);
  }, [editor, field]);
  const end = useCallback(() => {
    if (tag.current) editor.endEdit(tag.current);
    tag.current = undefined;
  }, [editor]);
  useLayoutEffect(() => end, [end, field]);
  return { begin, end, options: () => ({ merge: tag.current }) };
}
