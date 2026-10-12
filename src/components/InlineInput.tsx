import { useRef, useState } from "react";
import { useSelectOnMount } from "./useSelectOnMount";

/**
 * Single-line inline editor: Enter / blur commits, Esc cancels. Used for edge and group labels
 * (node cards have their own two-field editor).
 */
export function InlineInput({
  value,
  onDone,
  placeholder,
  className,
  testId,
}: {
  value: string;
  /** Receives the new text, or null when cancelled. */
  onDone: (next: string | null) => void;
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
        if (e.key === "Enter") finish(v);
        if (e.key === "Escape") finish(null);
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
