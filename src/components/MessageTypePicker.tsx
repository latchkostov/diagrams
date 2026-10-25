import { useCallback, useId, useLayoutEffect, useReducer, useRef, useState } from "react";
import { Dropdown } from "./Dropdown";
import { t } from "../i18n";
import { Field } from "../canvas/inspector/fields";
import { acceptsType } from "../sim/topology";
import { useInteractionOrLocal } from "../canvas/interaction";
import { machineStep } from "../lib/machine";
import { messagePickerMode } from "./messagePickerMode";
import { MAX_CHOICES, selectMessageChoices } from "./messageChoices";

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
  const { controller } = useInteractionOrLocal();
  const focusDraft = useCallback(
    (input: HTMLInputElement | null) => {
      if (input) controller.dispatch({ type: "inspector.control", target: input });
    },
    [controller],
  );
  const [mode, send] = useReducer(
    (state: typeof messagePickerMode.initial, event: (typeof messagePickerMode.events)[number]) =>
      machineStep(messagePickerMode, state, event).state,
    messagePickerMode.initial,
  );
  const adding = mode.value === "adding";
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const hintId = useId();
  const root = useRef<HTMLDivElement>(null);
  const finish = () => {
    send({ type: "finish" });
    const target = root.current?.querySelector<HTMLButtonElement>("button");
    if (target) controller.dispatch({ type: "inspector.rule", target });
  };
  // Rendering is bounded: imported vocabularies and filters can be large. Past the limit, at most MAX_CHOICES selected
  // types render first and at most MAX_CHOICES unselected ones follow. Search reaches every selected type.
  const bounded = selectMessageChoices(choices, value, multiple ? search : "");
  const { all, selected, options, hiddenSelectionCount: moreSelected } = bounded;
  const hidden = bounded.matchingSelectedOverflow + bounded.matchingUnselectedOverflow;
  const offered = new Set(choices);
  // Deselecting a chip can remove it (nothing upstream sends it, or past the limit), focus included: continue at a
  // neighbour.
  const removedChip = useRef<{ type?: string; index: number; recovered?: HTMLButtonElement }>(undefined);
  useLayoutEffect(() => {
    const removed = removedChip.current;
    if (!removed) return;
    if (removed.type !== undefined && options.includes(removed.type)) {
      // Still listed once deselected: nothing to recover.
      if (!selected.has(removed.type) && !updating) removedChip.current = undefined;
      return;
    }
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected && active !== removed.recovered) {
      removedChip.current = undefined;
      return;
    }
    const chips = root.current?.querySelectorAll<HTMLButtonElement>("button.message-type-chip");
    const next = chips?.[Math.min(removed.index, chips.length - 1)];
    const destination = next ?? root.current?.querySelector<HTMLButtonElement>(`[data-testid="inspector-${name}-add"]`);
    if (destination) controller.dispatch({ type: "inspector.rule", target: destination });
    // Recover immediately, then follow the same neighbour once deferred upstream choices arrive. A user's
    // intervening focus move wins. Without this, the temporary neighbour can leave focus one chip too far back.
    if (updating) removed.recovered = destination ?? undefined;
    else removedChip.current = undefined;
  });
  useLayoutEffect(() => controller.rendered());
  const add = () => {
    const type = draft.trim();
    if (!type) return;
    onChange(multiple ? [...new Set([...value, type])] : [type]);
    setDraft("");
    finish();
  };
  return (
    <div ref={root} className="message-type-picker">
      <Field label={label} group>
        {multiple && all.length > MAX_CHOICES && (
          <>
            <input
              className="insp-input"
              aria-label={t("messageTypes.searchOnlyPass")}
              placeholder={t("messageTypes.search")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              data-testid={`inspector-${name}-search`}
            />
            <small
              className="sr-only"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              data-testid={`inspector-${name}-search-status`}
            >
              {options.length
                ? t("messageTypes.searchResults", { count: options.length + hidden })
                : t("menu.noMatches")}
            </small>
          </>
        )}
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
                  const target = buttons[(i + direction + buttons.length) % buttons.length];
                  if (target) controller.dispatch({ type: "inspector.control", target });
                }}
              >
                {type}
              </button>
            ))}
            {!options.length && (
              <small className="insp-note" data-testid={`inspector-${name}-empty`}>
                {all.length ? t("menu.noMatches") : t("messageTypes.noUpstream")}
              </small>
            )}
            {moreSelected > 0 && (
              <>
                <small className="insp-note" data-testid={`inspector-${name}-more-selected`}>
                  +{t("inspector.selectedCount", { count: moreSelected })}
                </small>
                <button
                  type="button"
                  className="insp-link"
                  data-testid={`inspector-${name}-clear-all`}
                  onClick={() => {
                    removedChip.current = { index: 0 };
                    setSearch("");
                    onChange([]);
                  }}
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
              if (next === "new") send({ type: "add" });
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
        {multiple && (
          <button
            type="button"
            className="insp-link"
            data-testid={`inspector-${name}-add`}
            hidden={adding}
            onClick={() => send({ type: "add" })}
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
                  finish();
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
            <button type="button" className="insp-link" onClick={finish} data-testid={`inspector-${name}-cancel`}>
              {t("common.cancel")}
            </button>
          </div>
        )}
      </Field>
    </div>
  );
}
