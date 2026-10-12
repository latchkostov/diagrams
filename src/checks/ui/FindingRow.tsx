import { useState, type KeyboardEvent } from "react";
import { Icon } from "../../components/Icon";
import type { EditorApi } from "../../editor/types";
import { RULES } from "../run";
import type { Finding } from "../types";
import { applyFix, elementName, ignoreFinding, turnOff } from "./actions";

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
}

const ruleOf = (id: string) => RULES.find((r) => r.id === id);

const MAX_CHIPS = 5;

export function FindingRow({
  finding: f,
  host,
  compact = false,
  testPrefix = "check",
}: {
  finding: Finding;
  host: RowHost;
  /** The inspector's version: no element chips (the selection is one of them). */
  compact?: boolean;
  testPrefix?: string;
}) {
  const [panel, setPanel] = useState<"menu" | "ignore" | "about" | null>(null);
  const [reason, setReason] = useState("");
  const t = (part: string) => `${testPrefix}-${part}-${f.id}`;
  const chips = compact
    ? []
    : f.elements
        .map((id) => ({ id, name: elementName(host.editor, id) }))
        .filter((c): c is { id: string; name: string } => !!c.name);
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
    } else if (e.key === "Escape") {
      e.stopPropagation();
      setPanel(null);
    }
  };
  return (
    <div
      className={`check-row is-${f.severity}${compact ? " is-compact" : ""}`}
      role="listitem"
      data-testid={t("row")}
      data-severity={f.severity}
      onMouseEnter={() => host.hover?.(f.id)}
      onMouseLeave={() => host.hover?.(null)}
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
      {!compact && (
        <details className="check-why" data-testid={t("why")}>
          <summary>Why</summary>
          <p>{f.rationale}</p>
        </details>
      )}
      {chips.length > 0 && (
        <div className="check-chips" aria-label="Involves">
          {chips.slice(0, MAX_CHIPS).map((c) => (
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
          {chips.length > MAX_CHIPS && <span className="check-chip is-more">+{chips.length - MAX_CHIPS}</span>}
        </div>
      )}
      <div className="check-actions">
        {fix?.ops ? (
          <button
            type="button"
            className="btn check-fix"
            data-testid={t("fix")}
            onClick={() => applyFix(host.editor, f)}
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
          onClick={() => setPanel(panel === "menu" ? null : "menu")}
        >
          <span aria-hidden>⋯</span>
        </button>
      </div>
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
          <button type="button" className="link-btn" onClick={() => setPanel(null)} data-testid={t("ignore-cancel")}>
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
