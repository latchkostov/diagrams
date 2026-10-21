import { useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../../components/Icon";
import type { EditorApi } from "../../editor/types";
import { RULES } from "../run";
import type { Finding } from "../types";
import { applyFix, ignoreFinding, turnOff } from "./actions";
import { evidenceText } from "../evidenceMerge";
import { useLocale } from "../../i18n";
import { presentFinding, presentRule } from "../presentation";

// One finding, in the Checks card and (compact) at the top of a selected node's or edge's inspector: what's
// wrong, why, what it involves, and its one primary action, the fix. ⋯ has Ignore here, Turn off this check
// and About this check.

export interface RowHost {
  editor: EditorApi;
  /** Select these elements and bring them into view. */
  reveal(ids: readonly string[]): void;
  /** Quick-add downstream of a node: the fix that needs a choice ("Add a consumer…"). */
  choose?(nodeId: string): void;
  hover?(id: string | null): void;
  /** A fix was just applied: the shown findings are stale until the next check (both surfaces disable fixes). */
  applied?(): void;
}

/** The current check's view of the diagram, shared by every row (one index per result). */
export interface RowState {
  /** An element's name as of the check (undefined: gone). */
  name(id: string): string | undefined;
  /** The diagram changed since: fixes wait for the next check. */
  stale: boolean;
}

const ruleOf = (id: string) => {
  const rule = RULES.find((r) => r.id === id);
  return rule ? presentRule(rule) : undefined;
};

const MAX_CHIPS = 5;
const MAX_EVIDENCE = 3;

/**
 * After a fix from a row that had focus: the row goes with the next check, so focus moves on first, to the next
 * finding's head (else the one before), else the scope's fallback (the card's Close; in the inspector, its body),
 * never to the page.
 */
function focusNeighbour(row: HTMLElement) {
  const scope = row.closest<HTMLElement>("[data-check-scope]");
  if (!scope) return;
  const heads = [...scope.querySelectorAll<HTMLElement>("[data-check-head]")].filter((h) => !row.contains(h));
  const after = heads.find((h) => row.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING);
  const target =
    after ??
    heads[heads.length - 1] ??
    scope.querySelector<HTMLElement>("[data-check-fallback]") ??
    row.closest<HTMLElement>("[data-check-fallback-scope]");
  if (!target) return;
  if (target.tabIndex < 0 && !target.hasAttribute("tabindex")) target.tabIndex = -1;
  target.focus();
}

export function FindingRow({
  finding,
  host,
  state,
  compact = false,
  testPrefix = "check",
}: {
  finding: Finding;
  host: RowHost;
  state: RowState;
  /** The inspector's version: no element chips (the selection is one of them). */
  compact?: boolean;
  testPrefix?: string;
}) {
  useLocale();
  const f = presentFinding(finding);
  const [panel, setPanel] = useState<"menu" | "ignore" | "about" | null>(null);
  const [reason, setReason] = useState("");
  const more = useRef<HTMLButtonElement>(null);
  const self = useRef<HTMLDivElement>(null);
  /** Applies the fix (or one of its options); focus inside the row moves on before the row goes. */
  const fixIt = (option?: string) => {
    const row = self.current;
    const focused = !!row && row.contains(document.activeElement);
    if (!applyFix(host.editor, f, option)) return;
    host.applied?.();
    const keepsTarget =
      option === undefined && (f.scalingPlan?.kind === "busyThreads" || f.fix?.planLabel?.kind === "busyThreads");
    if (focused && row && !keepsTarget) focusNeighbour(row);
  };
  const t = (part: string) => `${testPrefix}-${part}-${f.id}`;
  // Names only for the chips drawn, from the check's one index: a loop of 1,500 services costs five lookups.
  const chips: { id: string; name: string }[] = [];
  let unnamed = 0;
  if (!compact)
    for (const id of f.elements) {
      if (chips.length === MAX_CHIPS) {
        unnamed++;
        continue;
      }
      const name = state.name(id);
      if (name) chips.push({ id, name });
    }
  /** Close the ⋯ options (one Esc level), back to the button that opened them. */
  const closePanel = () => {
    setPanel(null);
    requestAnimationFrame(() => more.current?.focus());
  };
  const rule = ruleOf(f.rule);
  const fix = f.fix;
  const confirmIgnore = () => {
    ignoreFinding(host.editor, f, reason);
    setPanel(null);
  };
  const onReasonKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmIgnore();
    }
  };
  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || !panel) return;
    // One level: the options close; the card stays.
    e.preventDefault();
    e.stopPropagation();
    closePanel();
  };
  return (
    // Esc inside the row closes its open options first (one level); hover highlights its markers.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={self}
      className={`check-row is-${f.severity}${compact ? " is-compact" : ""}`}
      role="listitem"
      data-testid={t("row")}
      data-severity={f.severity}
      onMouseEnter={() => host.hover?.(f.id)}
      onMouseLeave={() => host.hover?.(null)}
      onKeyDown={onPanelKey}
      data-panel-open={panel ? "" : undefined}
    >
      <button
        type="button"
        className="check-row-head"
        data-testid={t("select")}
        data-check-head
        title="Select and show what it involves"
        onClick={() => host.reveal(f.elements)}
        onFocus={() => host.hover?.(f.id)}
        onBlur={() => host.hover?.(null)}
      >
        <span className={`check-sev is-${f.severity}`} aria-label={f.severity === "warning" ? "Warning" : "Suggestion"}>
          {f.severity === "warning" ? <Icon name="warning" size={13} /> : <span className="check-dot" />}
        </span>
        <span className="check-row-text">
          <strong>{f.title}</strong>
          <span className="check-msg">{f.message}</span>
        </span>
      </button>
      {f.evidence?.length ? (
        // What the saved simulations showed here (Run simulations): one line each, the first few.
        <ul className="check-evidence" aria-label="In the simulations" data-testid={t("evidence")}>
          {f.evidence.slice(0, MAX_EVIDENCE).map((e, i) => (
            // Two simulations may share a title: their place in the file tells them apart.
            <li key={i}>{evidenceText(e)}</li>
          ))}
          {f.evidence.length > MAX_EVIDENCE && (
            <li className="is-more">
              and {f.evidence.length - MAX_EVIDENCE} more simulation{f.evidence.length - MAX_EVIDENCE === 1 ? "" : "s"}
            </li>
          )}
        </ul>
      ) : null}
      {!compact && (
        <details className="check-why" data-testid={t("why")}>
          <summary>Why</summary>
          <p>{f.rationale}</p>
        </details>
      )}
      {chips.length > 0 && (
        <div className="check-chips" aria-label="Involves">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              className="check-chip"
              data-testid={`${testPrefix}-element-${c.id}`}
              title={`Select ${c.name}`}
              onClick={() => host.reveal([c.id])}
            >
              {c.name}
            </button>
          ))}
          {unnamed > 0 && <span className="check-chip is-more">+{unnamed}</span>}
        </div>
      )}
      <div className="check-actions">
        {fix?.ops ? (
          <button
            type="button"
            className="btn check-fix"
            data-testid={t("fix")}
            // A fix from a check the diagram has moved on from waits for the next one (never applied twice).
            disabled={state.stale}
            title={state.stale ? "Checking your change…" : undefined}
            onClick={() => fixIt()}
          >
            <Icon name="check" size={13} /> {fix.label}
          </button>
        ) : fix ? (
          host.choose ? (
            <button
              type="button"
              className="btn check-fix"
              data-testid={t("choose")}
              title={fix.choice}
              onClick={() => host.choose!(f.target)}
            >
              <Icon name="plus" size={13} /> {fix.label}
            </button>
          ) : (
            <span className="check-choice" data-testid={t("choice")}>
              {fix.choice}
            </span>
          )
        ) : null}
        <button
          type="button"
          className="icon-btn check-more"
          aria-label="More: ignore, turn off, about"
          aria-expanded={panel === "menu"}
          title="Ignore, turn off, about"
          data-testid={t("more")}
          ref={more}
          onClick={() => setPanel(panel === "menu" ? null : "menu")}
        >
          <span aria-hidden>⋯</span>
        </button>
      </div>
      {fix?.ops && fix.options?.length ? (
        // Other ways to make the same fix, one click each (another gateway): secondary to the button.
        <div className="check-alts" role="group" aria-label="Or instead">
          <span className="check-alts-or">or</span>
          {fix.options.map((o, i) => (
            <button
              key={o.label}
              type="button"
              className="check-chip is-option"
              data-testid={t(`fix-option-${i}`)}
              disabled={state.stale}
              title={state.stale ? "Checking your change…" : o.label}
              aria-label={o.label}
              onClick={() => fixIt(finding.fix?.options?.[i]?.label)}
            >
              {o.short}
            </button>
          ))}
        </div>
      ) : null}
      {panel === "menu" && (
        <div className="check-menu" role="group" aria-label="Finding options">
          <button type="button" data-testid={t("ignore")} onClick={() => setPanel("ignore")}>
            Ignore here…
          </button>
          <button
            type="button"
            data-testid={t("turn-off")}
            onClick={() => {
              setPanel(null);
              turnOff(host.editor, f.rule, rule?.name ?? f.rule);
            }}
          >
            Turn off this check
          </button>
          <button type="button" data-testid={t("about")} onClick={() => setPanel("about")}>
            About this check
          </button>
        </div>
      )}
      {panel === "ignore" && (
        <div className="check-ignore">
          <input
            // The reason box opens on purpose, to type: focus it.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            className="insp-input"
            maxLength={200}
            placeholder="Why it's fine here (optional)"
            aria-label="Why it's fine here (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={onReasonKey}
            data-testid={t("ignore-reason")}
          />
          <button type="button" className="btn" data-testid={t("ignore-confirm")} onClick={confirmIgnore}>
            Ignore
          </button>
          <button type="button" className="link-btn" onClick={closePanel} data-testid={t("ignore-cancel")}>
            Cancel
          </button>
        </div>
      )}
      {panel === "about" && rule && (
        <p className="check-about" data-testid={t("about-text")}>
          <strong>{rule.name}.</strong> {rule.about}
        </p>
      )}
    </div>
  );
}
