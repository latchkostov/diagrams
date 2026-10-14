import { useState } from "react";
import { Icon } from "../components/Icon";
import { DiagramThumbnail } from "../components/DiagramThumbnail";
import type { Thumb } from "../lib/thumbnail";
import type { ThemeSection } from "../examples/themes";
import { t, useLocale } from "../i18n";
import { tRich } from "../i18n/rich";

export interface StartExample {
  slug: string;
  title: string;
  description?: string;
  /** A tiny rendering of the diagram (the same renderer as Your diagrams). */
  thumb: Thumb;
  /** Shown before "All examples" is opened. */
  featured?: boolean;
}

export interface StartRecent {
  slug: string;
  title: string;
  /** e.g. "12 nodes · edited 5 min ago". */
  detail: string;
  thumb: Thumb;
}

export interface StartOptions {
  /** Your diagrams, most recent first (the open one excluded). */
  recent: StartRecent[];
  /**
   * Examples by theme, in display order (groupByTheme, as in the picker). "All examples" shows one
   * section per theme: its id names the section, its label is the heading.
   */
  examples: ThemeSection<StartExample>[];
  /** Opens a diagram (yours or an example) by slug. */
  onOpen: (slug: string) => void;
  onOpenFile: () => void;
  onPaste: () => void;
  /** Opens the full "Your diagrams" list. */
  onLibrary: () => void;
}

/** Recent diagrams shown on the card; the rest are one click away in Your diagrams. */
const RECENT_MAX = 3;

/**
 * The empty state of a blank diagram, and the first screen a new visitor sees: what this is, and
 * the ways in (your recent diagrams, an example, a blank canvas, or a file from another tool). No
 * modal, no tour: it sits on the canvas and disappears as soon as there's a node.
 */
export function StartCard({ start, onBlank }: { start: StartOptions; onBlank: () => void }) {
  useLocale();
  const recent = start.recent.slice(0, RECENT_MAX);
  const [allExamples, setAllExamples] = useState(false);
  const all = start.examples.flatMap((section) => section.items);
  const featured = all.filter((ex) => ex.featured);
  // With nothing featured (or nothing more to show), the card simply lists every example.
  const expandable = featured.length > 0 && featured.length < all.length;
  const expanded = !expandable || allExamples;
  const exampleRow = (ex: StartExample) => (
    <StartRow
      key={ex.slug}
      testId={`start-example-${ex.slug}`}
      title={ex.title}
      detail={ex.description}
      thumb={ex.thumb}
      onClick={() => start.onOpen(ex.slug)}
    />
  );
  return (
    <section className="start-card" data-testid="start-card" aria-labelledby="start-card-title">
      <h2 id="start-card-title">{t("start.title")}</h2>
      <p className="start-lede">{recent.length ? t("start.ledeRecent") : t("start.lede")}</p>

      {recent.length > 0 && (
        <>
          <div className="start-heading">
            <h3>{t("start.yourDiagrams")}</h3>
            {start.recent.length > RECENT_MAX && (
              <button className="link-btn" onClick={start.onLibrary} data-testid="start-library">
                {t("start.all", { count: start.recent.length })}
              </button>
            )}
          </div>
          <ul className="start-examples" aria-label={t("start.yourDiagrams")}>
            {recent.map((d) => (
              <StartRow
                key={d.slug}
                testId={`start-recent-${d.slug}`}
                title={d.title}
                detail={d.detail}
                thumb={d.thumb}
                onClick={() => start.onOpen(d.slug)}
              />
            ))}
          </ul>
        </>
      )}

      <div className="start-heading">
        <h3>{t("start.examples")}</h3>
        {expandable && (
          <button
            className="link-btn start-all"
            onClick={() => setAllExamples((v) => !v)}
            aria-expanded={allExamples}
            data-testid="start-all-examples"
          >
            {allExamples ? t("start.fewer") : t("start.allExamples")}
            {!allExamples && <Icon name="chevron-right" size={12} />}
          </button>
        )}
      </div>

      {expanded ? (
        start.examples.map(({ theme, items }) => (
          <div key={theme?.id ?? ""} className="start-section" data-testid={`start-theme-${theme?.id ?? "other"}`}>
            {theme && <h4 className="start-theme">{theme.label}</h4>}
            <ul
              className={`start-examples${expandable ? " is-compact" : ""}`}
              aria-label={theme?.label ?? t("start.examples")}
            >
              {items.map(exampleRow)}
            </ul>
          </div>
        ))
      ) : (
        <ul className="start-examples" aria-label={t("start.featured")}>
          {featured.map(exampleRow)}
        </ul>
      )}

      {/* Teaches the infrastructure import in place (docs/research/imports.md): the one line it adds. */}
      <p className="start-note" data-testid="start-import-hint">
        {t("start.importHint")}
      </p>

      <div className="start-actions">
        <button className="btn" onClick={onBlank} data-testid="start-blank">
          <Icon name="plus" size={14} /> {t("start.blank")}
        </button>
        <button className="btn btn-ghost" onClick={start.onOpenFile} data-testid="start-open">
          <Icon name="upload" size={14} /> {t("start.open")}
        </button>
      </div>
      <p className="start-note">
        {tRich("start.opens", {
          paste: (chunks) => (
            <button className="link-btn start-paste" onClick={start.onPaste} data-testid="start-paste">
              {chunks}
            </button>
          ),
        })}
      </p>
      {/* What this is and the policies, without signing in: the home page OAuth brand reviewers check. */}
      <footer className="start-about" data-testid="start-about">
        <span>{tRich("start.about", { b: (chunks) => <strong>{chunks}</strong> })}</span>
        <span className="start-legal">
          <a href="privacy.html" target="_blank" rel="noopener" data-testid="start-privacy">
            {t("start.privacy")}
          </a>
          <span aria-hidden> · </span>
          <a href="terms.html" target="_blank" rel="noopener" data-testid="start-terms">
            {t("start.terms")}
          </a>
        </span>
      </footer>
    </section>
  );
}

function StartRow(p: { testId: string; title: string; detail?: string; thumb: Thumb; onClick: () => void }) {
  return (
    <li>
      <button className="start-example" onClick={p.onClick} data-testid={p.testId}>
        <span className="start-thumb">
          <DiagramThumbnail thumb={p.thumb} testId={`${p.testId}-thumb`} />
        </span>
        <span className="start-example-text">
          <strong>{p.title}</strong>
          {p.detail && <span>{p.detail}</span>}
        </span>
        <Icon name="chevron-right" size={14} />
      </button>
    </li>
  );
}
