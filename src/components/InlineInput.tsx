import { useRef, useState } from "react";
import { useSelectOnMount } from "./useSelectOnMount";
import { editKeyAction, refocusAfterEdit } from "./editKeys";

/**
 * Single-line inline editor for edge and boundary labels (node cards have their own two-field editor), and
 * for renaming in a dialog. On the canvas the keys are every editor's (`editKeys.ts`): Enter, Tab, Esc and a
 * click away all save. In a dialog (`dialog`) Esc cancels, as dialogs do, and Tab moves on as usual.
 */
export function InlineInput({
  value,
  onDone,
  placeholder,
  className,
  testId,
  returnFocus,
  dialog = false,
}: {
  value: string;
  /** Receives the new text (null: cancelled, in a dialog only). */
  onDone: (next: string | null) => void;
  /** A dialog's field rather than the canvas's: Esc cancels. */
  dialog?: boolean;
  /** What gets focus back after a save from the keyboard (the edge or node edited). */
  returnFocus?: () => Element | null;
  placeholder?: string;
  className?: string;
  testId?: string;
}) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  useSelectOnMount(ref);
  return (
    <input
      ref={ref}
      className={`inline-input nodrag nopan nowheel ${className ?? ""}`}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (dialog) {
          if (e.key === "Enter") finish(v);
          if (e.key === "Escape") finish(null);
          return;
        }
        if (editKeyAction(e.nativeEvent) !== "save") return;
        e.preventDefault();
        const back = returnFocus?.();
        finish(v);
        refocusAfterEdit(back);
      }}
      onBlur={() => finish(v)}
      onDoubleClick={(e) => e.stopPropagation()}
      placeholder={placeholder}
      aria-label={placeholder ?? "Label"}
      name="inline-label"
      data-testid={testId}
      size={Math.max(8, v.length + 1)}
    />
  );
}
