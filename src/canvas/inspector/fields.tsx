import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { t } from "../../i18n";
import { ANNOTATION_LIMITS } from "../../model/annotations";
import { sideLabel } from "./sideLabel";
import type { Side } from "../../model/types";

const SIDES: Side[] = ["top", "right", "bottom", "left"];

/** A value kept in the file that can't change the run where it is: said in a muted line, with a way to remove it. */
export function InertNote({ name, text, onRemove }: { name: string; text: string; onRemove: () => void }) {
  return (
    <p className="insp-note insp-inert" data-testid={`inspector-inert-${name}`}>
      {text}{" "}
      <button
        type="button"
        className="insp-link"
        onClick={(event) => {
          // Removing the note removes this button too. Keep keyboard focus in its surviving section.
          if (document.activeElement === event.currentTarget) {
            const section = event.currentTarget.closest("section");
            const target =
              section?.querySelector<HTMLElement>(":scope > h3 > button[aria-expanded]") ??
              section?.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled)");
            target?.focus();
          }
          onRemove();
        }}
        data-testid={`inspector-inert-${name}-remove`}
      >
        {t("inspector.remove")}
      </button>
    </p>
  );
}

/** A pixel size: free typing, applied on Enter or blur (never below `min`). */
export function SizeInput({
  label,
  value,
  min,
  testId,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  testId: string;
  onCommit: (v: number) => void;
}) {
  const shown = String(Math.round(value));
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const raw = Number(draft);
    const v = Math.max(min, Math.min(ANNOTATION_LIMITS.maxAnnotationSize, Math.round(raw)));
    setDraft(null);
    if (Number.isFinite(raw) && v !== value) onCommit(v);
  };
  return (
    <input
      className="insp-input mono"
      inputMode="numeric"
      value={draft ?? shown}
      aria-label={label}
      title={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(null);
      }}
      name={testId}
      data-testid={testId}
    />
  );
}

import { Slider } from "../../components/Slider";
export { Slider, type SliderProps } from "../../components/Slider";
/** @deprecated Use Slider from src/components/Slider */
export const SliderInput = Slider;

/** The node id as a copy chip: click copies it. */
export function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className="copy-chip insp-id"
      onClick={() =>
        void navigator.clipboard
          ?.writeText(id)
          .then(() => setCopied(true))
          .catch(() => {})
      }
      title={t("inspector.copyId")}
      aria-label={t("inspector.copyIdValue", { id })}
      data-testid="inspector-copy-id"
    >
      <Icon name={copied ? "check" : "hash"} size={12} />
      <span className="mono">{copied ? t("inspector.copied") : id}</span>
    </button>
  );
}

export function Section({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="insp-section">
      {title && (
        <h3>
          {title}
          {aside}
        </h3>
      )}
      <div className="insp-section-body">{children}</div>
    </section>
  );
}

/** Labelled row. `group` renders a div (for button groups — a <label> would forward clicks). */
export function Field({
  label,
  hint,
  group,
  children,
  testId,
}: {
  label: string;
  hint?: string;
  group?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  const Tag = group ? "div" : "label";
  return (
    <Tag className="insp-field" title={hint} data-testid={testId}>
      <span className="insp-label">{label}</span>
      {children}
    </Tag>
  );
}

/**
 * A radio group drawn as a segmented control: named by `label`, one Tab stop (the checked option), and the arrow keys,
 * Home and End move the choice, as the WAI-ARIA radio group pattern says.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  testId,
  label,
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  testId: string;
  label: string;
}) {
  const current = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const select = (next: T) => {
    if (next !== value) onChange(next);
  };
  const move = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = options.length - 1;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? index === last
          ? 0
          : index + 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? index === 0
            ? last
            : index - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : -1;
    if (next < 0) return;
    e.preventDefault();
    // A move expresses fresh intent even while the controlled value awaits its previous update.
    if (next !== index) onChange(options[next].value);
    else select(options[next].value);
    const group = e.currentTarget.parentElement;
    group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };
  return (
    <div className="segmented insp-seg" role="radiogroup" aria-label={label} data-testid={testId}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={i === current ? 0 : -1}
          className={value === o.value ? "is-on" : ""}
          title={o.hint}
          onClick={() => select(o.value)}
          onKeyDown={(e) => move(e, i)}
          data-testid={`${testId}-${o.value}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SideSelect({
  value,
  onChange,
  testId,
}: {
  value?: Side;
  onChange: (v: Side | undefined) => void;
  testId: string;
}) {
  return (
    <select
      className="insp-input"
      value={value ?? ""}
      onChange={(e) => onChange((e.target.value || undefined) as Side | undefined)}
      data-testid={testId}
      name={testId}
    >
      <option value="">{t("inspector.auto")}</option>
      {SIDES.map((s) => (
        <option key={s} value={s}>
          {sideLabel(s)}
        </option>
      ))}
    </select>
  );
}
