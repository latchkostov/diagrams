import { useEffect, useId, useRef, useState } from "react";
import { Dropdown } from "./Dropdown";
import { t } from "../i18n";
import { Field } from "../canvas/inspector/fields";
import { acceptsType } from "../sim/topology";
/** Native buttons keep chips reachable with Tab, Space and Enter; arrows walk the choices too. */
export function TypePicker({
  name,
  label,
  choices,
  value,
  onChange,
  multiple = false,
  hint,
  placeholder,
  wildcard = false,
}: {
  name: string;
  label: string;
  choices: readonly string[];
  value: readonly string[];
  onChange: (types: string[]) => void;
  multiple?: boolean;
  hint?: string;
  placeholder?: string;
  wildcard?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const hintId = useId();
  const root = useRef<HTMLDivElement>(null);
  const wasAdding = useRef(false);
  useEffect(() => {
    if (!adding && wasAdding.current) root.current?.querySelector<HTMLButtonElement>("button")?.focus();
    wasAdding.current = adding;
  }, [adding]);
  const options = [...new Set([...choices, ...value])];
  const add = () => {
    const type = draft.trim();
    if (!type) return;
    onChange(multiple ? [...new Set([...value, type])] : [type]);
    setDraft("");
    setAdding(false);
  };
  return (
    <div ref={root} className="message-type-picker">
      <Field label={label} group>
        {multiple ? (
          <div
            className="message-type-chips"
            role="group"
            aria-label={label}
            aria-describedby={hint ? hintId : undefined}
          >
            {options.map((type, i) => (
              <button
                key={type}
                type="button"
                className="message-type-chip"
                aria-pressed={value.includes(type)}
                data-testid={`inspector-${name}-option-${i}`}
                onClick={() => onChange(value.includes(type) ? value.filter((v) => v !== type) : [...value, type])}
                onKeyDown={(event) => {
                  const direction =
                    event.key === "ArrowRight" || event.key === "ArrowDown"
                      ? 1
                      : event.key === "ArrowLeft" || event.key === "ArrowUp"
                        ? -1
                        : 0;
                  if (!direction) return;
                  event.preventDefault();
                  const buttons = event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>("button");
                  buttons[(i + direction + buttons.length) % buttons.length]?.focus();
                }}
              >
                {type}
              </button>
            ))}
            {!options.length && <small className="insp-note">{t("messageTypes.noUpstream")}</small>}
          </div>
        ) : (
          <Dropdown
            value={value.length ? String(options.indexOf(value[0])) : "keep"}
            onChange={(next) => {
              if (next === "new") setAdding(true);
              else onChange(next === "keep" ? [] : [options[Number(next)]]);
            }}
            items={[
              { value: "keep", label: placeholder ?? t("inspector.unchanged") },
              ...options.map((type, i) => ({
                value: String(i),
                label: wildcard && type === "*" ? t("messageTypes.anyType") : type,
              })),
              { value: "new", label: t("messageTypes.addType") },
            ]}
            aria-label={label}
            testId={`inspector-field-${name}`}
          />
        )}
        {hint && (
          <small className="insp-note" id={hintId}>
            {hint}
          </small>
        )}
        {value.some(
          (type) =>
            !(wildcard && type === "*") &&
            !choices.some((choice) => (multiple ? acceptsType([type], choice) : choice === type)),
        ) && (
          <small className="insp-note" role="status" data-testid={`inspector-${name}-unknown`}>
            {t("messageTypes.notSent")}
          </small>
        )}
        {multiple && !adding && (
          <button
            type="button"
            className="insp-link"
            data-testid={`inspector-${name}-add`}
            onClick={() => setAdding(true)}
          >
            {t("messageTypes.addType")}
          </button>
        )}
        {adding && (
          <div className="message-type-add">
            <input
              ref={(input) => input?.focus()}
              className="insp-input"
              aria-label={t("inspector.messageType")}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setAdding(false);
                }
              }}
              data-testid={`inspector-${name}-new`}
            />
            <button
              type="button"
              className="insp-link"
              disabled={!draft.trim()}
              onClick={add}
              data-testid={`inspector-${name}-confirm`}
            >
              {t("messageTypes.add")}
            </button>
            <button
              type="button"
              className="insp-link"
              onClick={() => setAdding(false)}
              data-testid={`inspector-${name}-cancel`}
            >
              {t("common.cancel")}
            </button>
          </div>
        )}
      </Field>
    </div>
  );
}
