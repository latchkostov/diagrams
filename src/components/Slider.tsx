import "./slider.css";
import { useState } from "react";

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  showInput?: boolean;
  disabled?: boolean;
  className?: string;
  testId?: string;
  name?: string;
}

/** Reusable numeric slider with an optional direct editable numeric input. */
export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  showInput = true,
  disabled = false,
  className = "",
  testId,
  name,
}: SliderProps) {
  const current = Math.min(max, Math.max(min, Math.round(value)));
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const v = Math.round(Number(draft));
    setDraft(null);
    if (Number.isFinite(v) && v !== current) {
      onChange(Math.max(min, Math.min(max, v)));
    }
  };

  return (
    <div className={`slider-control ${className}`.trim()} data-testid={testId}>
      <input
        type="range"
        className="slider-range"
        min={min}
        max={max}
        step={step}
        value={current}
        disabled={disabled}
        aria-label={label}
        title={label}
        name={name}
        onChange={(e) => {
          setDraft(null);
          onChange(Number(e.target.value));
        }}
        data-testid={testId ? `${testId}-slider` : undefined}
      />
      {showInput && (
        <input
          className="slider-input mono"
          inputMode="numeric"
          value={draft ?? String(current)}
          disabled={disabled}
          aria-label={label}
          title={label}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setDraft(null);
          }}
          data-testid={testId ? `${testId}-input` : undefined}
        />
      )}
    </div>
  );
}
