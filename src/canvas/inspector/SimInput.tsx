import { useEffect, useRef, useState } from "react";
import { parseEmits } from "../../editor/emits";
import { t } from "../../i18n";
import { formatNumber } from "../../i18n/number";
import { Field } from "./controls";
import { showSim, type SimField } from "./simFields";

export type SimValue = number | string | string[] | Record<string, string> | undefined;

export function SimInput({
  name,
  field,
  value,
  onChange,
}: {
  name: string;
  field: SimField;
  value: unknown;
  onChange: (v: SimValue) => void;
}) {
  const external = showSim(field.kind, value);
  const [draft, setDraft] = useState(external);
  // A number past the field's bound is saved at the bound, and says so while it's typed.
  const [over, setOver] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(external);
  }, [external]);
  return (
    <>
      <Field label={field.label} hint={field.hint}>
        <span className="insp-unit-wrap">
          <input
            className={`insp-input${field.kind === "number" ? " mono" : ""}`}
            type={field.kind === "number" ? "number" : "text"}
            inputMode={field.kind === "number" ? "decimal" : undefined}
            min={field.min}
            max={field.max}
            step={field.step}
            value={draft}
            placeholder={field.placeholder}
            onFocus={() => (focused.current = true)}
            onBlur={() => {
              focused.current = false;
              setDraft(external);
              setOver(false);
            }}
            onChange={(e) => {
              const raw = e.target.value;
              setDraft(raw);
              setOver(field.kind === "number" && field.max !== undefined && Number(raw) > field.max);
              if (field.kind === "text") return onChange(raw || undefined);
              if (field.kind === "list") {
                const items = raw
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean);
                return onChange(items.length ? items : undefined);
              }
              if (field.kind === "map") {
                const parsed = parseEmits(raw);
                if (parsed !== null) onChange(parsed);
                return;
              }
              if (raw.trim() === "") return onChange(undefined);
              const v = Number(raw);
              // Each bound on its own: a value the file format would reject never reaches the diagram.
              if (Number.isFinite(v)) onChange(Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, v)));
            }}
            name={name}
            data-testid={`inspector-field-${name}`}
          />
          {field.unit && <span className="insp-unit">{field.unit}</span>}
        </span>
        {over && field.max !== undefined && (
          <small className="insp-note" role="status" data-testid={`inspector-limit-${name}`}>
            {t("inspector.limit", {
              limit: formatNumber(field.max),
              unit: field.unit && field.unit !== "0–1" ? ` ${field.unit}` : "",
            })}
          </small>
        )}
      </Field>
      {field.note && (
        <p className="insp-note insp-field-note" data-testid={`inspector-note-${name}`}>
          {field.note}
        </p>
      )}
    </>
  );
}
