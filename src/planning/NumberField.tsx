import { useId, useState, type Ref, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { formatNumber } from "../i18n/format";
import { t } from "../i18n";

/** A draft-preserving numeric field: invalid input stays local with feedback; valid values commit on blur. */
export function NumberField({
  inputRef,
  name,
  label,
  value,
  change,
  min = 0,
  max = 600_000,
  integer = false,
  optional = false,
  unitToggle,
}: {
  inputRef?: Ref<HTMLInputElement>;
  name: string;
  label: string;
  value: number | undefined;
  change: (value: number | undefined) => boolean | undefined;
  min?: number;
  max?: number;
  integer?: boolean;
  optional?: boolean;
  unitToggle?: ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [badInput, setBadInput] = useState(false);
  const feedback = useId();
  const commitInput = (input: HTMLInputElement) => {
    if (input.validity.badInput || badInput) {
      setInvalid(true);
    } else if (optional && input.value === "") {
      if (value !== undefined && change(undefined) === false) {
        setInvalid(true);
        return;
      }
      setDraft(null);
      setInvalid(false);
    } else if (input.validity.valid && input.value !== "" && Number.isFinite(input.valueAsNumber)) {
      if (!Object.is(value, input.valueAsNumber) && change(input.valueAsNumber) === false) {
        setInvalid(true);
        return;
      }
      setDraft(null);
      setInvalid(false);
    } else setInvalid(true);
  };
  return (
    <div className="insp-field">
      <label className="insp-label" htmlFor={`${feedback}-input`}>
        {label}
      </label>
      <span className={`insp-unit-wrap${unitToggle ? " has-unit-toggle" : ""}`}>
        <input
          id={`${feedback}-input`}
          ref={inputRef}
          className="insp-input mono"
          aria-label={label}
          data-testid={`autoscaling-${name}`}
          type="number"
          min={min}
          max={max}
          step={integer ? 1 : "any"}
          value={draft ?? value ?? ""}
          aria-invalid={invalid}
          aria-describedby={invalid ? feedback : undefined}
          onFocus={() => {
            if (draft === null) setDraft(value === undefined ? "" : String(value));
          }}
          onBlur={(e) => commitInput(e.currentTarget)}
          onKeyDown={(e) => {
            // The window Save shortcut snapshots the document later in this same event.
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") flushSync(() => commitInput(e.currentTarget));
          }}
          placeholder={t("admission.unknownShort")}
          onChange={(e) => {
            setDraft(e.currentTarget.value);
            setBadInput(e.currentTarget.validity.badInput);
            setInvalid(false);
          }}
        />
        {unitToggle}
      </span>
      {invalid && (
        <small id={feedback} role="status" data-testid={`autoscaling-limit-${name}`} className="insp-note">
          {t("admission.invalidNumber", {
            min: formatNumber(min),
            max: formatNumber(max),
            step: "",
            value: value === undefined ? t("admission.unknownShort") : formatNumber(value),
          })}
        </small>
      )}
    </div>
  );
}
