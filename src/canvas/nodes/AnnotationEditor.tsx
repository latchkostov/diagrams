import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ANNOTATION_LIMITS, annotationText } from "../../model/annotations";
import type { AnnotationKind } from "../../model/types";
import { kindLabel } from "../annotations";
import { useSelectOnMount } from "../../components/useSelectOnMount";
import { editKeyAction, refocusAfterEdit } from "../../components/editKeys";
import { handleMarkdownKeyDown } from "../../components/markdown/markdownKeys";
import { keepInPane } from "../keepInPane";

/**
 * Multi-line editor in place of the text, with every editor's keys (editKeys.ts): Enter adds a line (a
 * zone's name is one line, so Enter saves there); Esc, Ctrl/Cmd+Enter, Tab and clicking away save.
 * Reports how far the text overflows.
 */
export function AnnotationEditor({
  value,
  kind,
  onDone,
}: {
  value: string;
  kind: AnnotationKind;
  /** The text, and how many pixels it overflows the box by (0 when it fits). */
  onDone: (text: string | null, overflow: number) => void;
}) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const supportsMarkdown = kind === "note" || kind === "text";
  const finish = () => {
    if (done.current) return;
    done.current = true;
    const el = ref.current;
    onDone(v, el ? Math.max(0, el.scrollHeight - el.clientHeight) : 0);
  };
  useSelectOnMount(ref);
  // Magnified when zoomed out (a zone: its name chip), it stays inside the canvas.
  useLayoutEffect(() => keepInPane(kind === "zone" ? (ref.current?.parentElement ?? null) : ref.current), [kind]);
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (supportsMarkdown && ref.current) {
      if (handleMarkdownKeyDown(e, ref.current, v, setV)) {
        return;
      }
    }
    if (editKeyAction(e.nativeEvent, { multiline: kind !== "zone" }) !== "save") return;
    e.preventDefault();
    const wrapper = ref.current?.closest(".react-flow__node");
    finish();
    // Keyboard commits return to the canvas object; blur commits leave the new control focused.
    refocusAfterEdit(wrapper);
  };
  return (
    <textarea
      ref={ref}
      className="ann-editor nodrag nopan nowheel"
      value={v}
      maxLength={ANNOTATION_LIMITS.maxAnnotationText}
      rows={kind === "zone" ? 1 : undefined}
      onChange={(e) => setV(annotationText(e.target.value))}
      onKeyDown={onKey}
      onBlur={finish}
      onDoubleClick={(e) => e.stopPropagation()}
      placeholder={kind === "zone" ? "Zone name" : "Write something"}
      aria-label={`${kindLabel[kind]} text`}
      name="annotation-text"
      spellCheck
      data-markdown-input={supportsMarkdown ? "" : undefined}
      data-testid="annotation-editor"
    />
  );
}
