import "./slider.css";
import { useState } from "react";

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
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
  onEditStart,
  onEditEnd,
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
  const normalize = (v: number) => {
    const snapped = min + Math.round((v - min) / step) * step;
    return Math.min(max, Math.max(min, Number(snapped.toPrecision(12))));
  };
  const current = normalize(value);
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const v = Number(draft);
    setDraft(null);
    if (draft.trim() && Number.isFinite(v) && normalize(v) !== current) {
      onEditStart?.();
      onChange(normalize(v));
      onEditEnd?.();
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
          onEditStart?.();
          onChange(Number(e.target.value));
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onEditStart?.();
        }}
        onPointerUp={() => onEditEnd?.()}
        onPointerCancel={() => onEditEnd?.()}
        onLostPointerCapture={() => onEditEnd?.()}
        onBlur={() => onEditEnd?.()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") onEditEnd?.();
        }}
        data-testid={testId ? `${testId}-slider` : undefined}
      />
      {showInput && (
        <input
          className="slider-input mono"
          inputMode="decimal"
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
