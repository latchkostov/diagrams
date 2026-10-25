import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ANNOTATION_LIMITS, annotationText } from "../../model/annotations";
import type { AnnotationKind } from "../../model/types";
import { kindLabel } from "../annotations";
import { useSelectOnMount } from "../../components/useSelectOnMount";
import { editKeyAction, refocusAfterEdit } from "../../components/editKeys";
import { lazyComponent } from "../../lib/lazyLoad";
import { keepInPane } from "../keepInPane";

const AnnotationFormatting = lazyComponent(() => import("./AnnotationFormatting").then((m) => m.AnnotationFormatting));

/**
 * Multi-line editor in place of the text, with every editor's keys (editKeys.ts): Enter adds a line (a
 * zone's name is one line, so Enter saves there); Esc, Ctrl/Cmd+Enter, Tab and clicking away save.
 * Reports how far the text overflows.
 */
export function AnnotationEditor({
  id,
  value,
  kind,
  caret,
  onDone,
}: {
  /** The annotation: its editor reports as its name field to the editor's mode (Esc or Enter is naming.done). */
  id: string;
  value: string;
  kind: AnnotationKind;
  caret?: "end";
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
  useSelectOnMount(ref, caret ?? "all");
  // Magnified when zoomed out (a zone: its name chip), it stays inside the canvas.
  useLayoutEffect(() => keepInPane(kind === "zone" ? (ref.current?.parentElement ?? null) : ref.current), [kind]);
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (editKeyAction(e.nativeEvent, { multiline: kind !== "zone" }) !== "save") return;
    e.preventDefault();
    const wrapper = ref.current?.closest(".react-flow__node");
    finish();
    // Keyboard commits return to the canvas object; blur commits leave the new control focused.
    refocusAfterEdit(wrapper);
  };
  return (
    <>
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
        data-name-field={id}
        data-testid="annotation-editor"
      />
      {supportsMarkdown && <AnnotationFormatting textarea={ref} onChange={setV} />}
    </>
  );
}
