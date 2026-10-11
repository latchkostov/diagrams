import { useEffect, useRef, useState } from "react";
import { coerce } from "./controls";
import type { ControlDef, ControlValue } from "./types";

/** One input generated from a control definition (number / boolean / select / text). */
export function ControlField({
  def,
  value,
  onChange,
  testId,
}: {
  def: ControlDef;
  value: ControlValue | undefined;
  onChange: (v: ControlValue) => void;
  testId: string;
}) {
  const id = `lab-control-${def.key}-${testId}`;
  const current = value ?? def.default;

  if (def.type === "boolean") {
    return (
      <label className="lab-control lab-control-bool" htmlFor={id} title={def.hint}>
        <span>{def.label}</span>
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={!!current}
          onChange={(e) => onChange(e.target.checked)}
          name={def.key}
          data-testid={testId}
        />
      </label>
    );
  }

  if (def.type === "select") {
    return (
      <div className="lab-control" title={def.hint}>
        <label htmlFor={id}>{def.label}</label>
        <span className="select">
          <select
            id={id}
            value={String(current)}
            onChange={(e) => onChange(e.target.value)}
            name={def.key}
            data-testid={testId}
          >
            {def.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </span>
      </div>
    );
  }

  return <DraftInput def={def} id={id} value={current} onChange={onChange} testId={testId} />;
}

/** Text / number input that commits after a short pause, on Enter or on blur, so heavy presets don't rebuild per keystroke. */
function DraftInput({
  def,
  id,
  value,
  onChange,
  testId,
}: {
  def: ControlDef & { type: "number" | "text" };
  id: string;
  value: ControlValue;
  onChange: (v: ControlValue) => void;
  testId: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => setDraft(String(value)), [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const commit = (raw: string) => {
    clearTimeout(timer.current);
    const v = coerce(def, raw);
    if (v !== value) onChange(v);
    else setDraft(String(value));
  };

  return (
    <div className="lab-control" title={def.hint}>
      <label htmlFor={id}>{def.label}</label>
      <div className="field">
        <input
          id={id}
          type={def.type === "number" ? "number" : "text"}
          inputMode={def.type === "number" ? "decimal" : undefined}
          min={def.type === "number" ? def.min : undefined}
          max={def.type === "number" ? def.max : undefined}
          step={def.type === "number" ? (def.step ?? 1) : undefined}
          placeholder={def.type === "text" ? def.placeholder : undefined}
          value={draft}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => commit(raw), 400);
          }}
          onKeyDown={(e) => e.key === "Enter" && commit((e.target as HTMLInputElement).value)}
          onBlur={(e) => commit(e.target.value)}
          name={def.key}
          data-testid={testId}
        />
      </div>
    </div>
  );
}
