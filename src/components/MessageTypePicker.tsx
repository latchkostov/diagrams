import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Dropdown } from "./Dropdown";
import { t } from "../i18n";
import { Field } from "../canvas/inspector/fields";
import { acceptsType } from "../sim/topology";
/** At most this many choices render in one picker. */
export const MAX_CHOICES = 100;

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
  updating = false,
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
  /** Upstream choices still describe the previous forwarding snapshot. */
  updating?: boolean;
}) {
  const focusDraft = useCallback((input: HTMLInputElement | null) => input?.focus(), []);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const hintId = useId();
  const root = useRef<HTMLDivElement>(null);
  const wasAdding = useRef(false);
  useEffect(() => {
    if (!adding && wasAdding.current) root.current?.querySelector<HTMLButtonElement>("button")?.focus();
    wasAdding.current = adding;
  }, [adding]);
  // Rendering is bounded: imported vocabularies and filters can be large. Past the limit, at most MAX_CHOICES selected
  // types render first and at most MAX_CHOICES unselected ones follow. Further selections are counted and cleared
  // together (Pass all); further choices stay reachable through Add a type.
  const all = [...new Set([...choices, ...value])];
  const selected = new Set(value);
  const pinned = [...selected].slice(0, MAX_CHOICES);
  const moreSelected = selected.size - pinned.length;
  const options =
    all.length > MAX_CHOICES ? [...pinned, ...all.filter((type) => !selected.has(type)).slice(0, MAX_CHOICES)] : all;
  const hidden = all.length - options.length - moreSelected;
  const offered = new Set(choices);
  // Deselecting a chip can remove it (nothing upstream sends it, or past the limit), focus included: continue at a
  // neighbour.
  const removedChip = useRef<{ type: string; index: number; recovered?: HTMLButtonElement }>(undefined);
  useLayoutEffect(() => {
    const removed = removedChip.current;
    if (!removed) return;
    if (options.includes(removed.type)) {
      // Still listed once deselected: nothing to recover.
      if (!selected.has(removed.type) && !updating) removedChip.current = undefined;
      return;
    }
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected && active !== removed.recovered) {
      removedChip.current = undefined;
      return;
    }
    const chips = root.current?.querySelectorAll<HTMLButtonElement>(".message-type-chips button");
    const next = chips?.[Math.min(removed.index, chips.length - 1)];
    const destination = next ?? root.current?.querySelector<HTMLButtonElement>(`[data-testid="inspector-${name}-add"]`);
    destination?.focus();
    // Recover immediately, then follow the same neighbour once deferred upstream choices arrive. A user's
    // intervening focus move wins. Without this, the temporary neighbour can leave focus one chip too far back.
    if (updating) removed.recovered = destination ?? undefined;
    else removedChip.current = undefined;
  });
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
                aria-pressed={selected.has(type)}
                data-testid={`inspector-${name}-option-${i}`}
                onClick={() => {
                  if (selected.has(type)) removedChip.current = { type, index: i };
                  onChange(selected.has(type) ? value.filter((v) => v !== type) : [...value, type]);
                }}
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
            {moreSelected > 0 && (
              <>
                <small className="insp-note" data-testid={`inspector-${name}-more-selected`}>
                  +{t("inspector.selectedCount", { count: moreSelected })}
                </small>
                <button
                  type="button"
                  className="insp-link"
                  data-testid={`inspector-${name}-clear-all`}
                  onClick={() => onChange([])}
                >
                  {t("messageTypes.passAll")}
                </button>
              </>
            )}
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
                identity: type,
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
        {hidden > 0 && (
          <small className="insp-note" data-testid={`inspector-${name}-more`}>
            +{t("importReport.more", { count: hidden })} · {t("messageTypes.addType")}
          </small>
        )}
        {value
          .slice(0, MAX_CHOICES)
          .some(
            (type) =>
              !(wildcard && type === "*") &&
              !offered.has(type) &&
              !(multiple && type.endsWith("*") && choices.some((choice) => acceptsType([type], choice))),
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
              ref={focusDraft}
              className="insp-input"
              aria-label={t("inspector.messageType")}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // An IME confirms or cancels its candidate with these keys: never the draft.
                if (event.nativeEvent.isComposing) return;
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
