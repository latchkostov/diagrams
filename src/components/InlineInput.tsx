import { useRef, useState } from "react";
import { useSelectOnMount } from "./useSelectOnMount";

/**
 * Single-line rename field in a dialog (Your diagrams). It opens with all of its text selected, so typing
 * replaces it. Enter saves, Esc cancels, as dialogs do, and a click away saves.
 */
export function InlineInput({
  value,
  onDone,
  placeholder,
  testId,
}: {
  value: string;
  /** Receives the new text (null: cancelled). */
  onDone: (next: string | null) => void;
  placeholder?: string;
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
      className="inline-input"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(v);
        if (e.key === "Escape") finish(null);
      }}
      onBlur={() => finish(v)}
      placeholder={placeholder}
      aria-label={placeholder ?? "Label"}
      name="inline-label"
      data-testid={testId}
      size={Math.max(8, v.length + 1)}
    />
  );
}
