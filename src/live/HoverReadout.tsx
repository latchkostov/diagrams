import "../styles/readout.css";
import { useState, type ReactNode } from "react";
import { HEALTH_WINDOW_MS } from "./healthWindow";
import { t } from "../i18n";
import type { HoverSummary } from "./hoverSummary";
import { cardSections } from "./hoverSections";
import { verdictSection } from "./verdictSection";

export function HoverStatus({ summary }: { summary: HoverSummary }) {
  const problem = summary.problems[0];
  return (
    <span
      className="hover-status"
      data-testid="hover-status"
      title={t("health.window", { seconds: HEALTH_WINDOW_MS / 1000 })}
    >
      <span aria-hidden>{problem ? (problem.severe ? "⊗" : "△") : "✓"}</span>{" "}
      {problem ? t("hover.attention") : t("hover.healthy")}
    </span>
  );
}
export function HoverVerdict({ summary, healthy }: { summary: HoverSummary; healthy: string }) {
  const problem = summary.problems[0];
  return (
    <p className="hover-verdict" data-testid="hover-verdict">
      <span aria-hidden>{problem ? (problem.severe ? "⊗" : "△") : "✓"}</span>
      <span>{problem?.text ?? healthy}</span>
    </p>
  );
}
export function HoverVitals({ summary }: { summary: HoverSummary }) {
  return (
    <div className="hover-vitals" data-testid="hover-vitals">
      {summary.vitals.map((v) => (
        <div key={v.key} className={v.bad ? "is-bad" : ""} data-testid={`hover-vital-${v.key}`}>
          <b className="mono" title={v.value} data-testid={`hover-vital-value-${v.key}`}>
            <bdi dir="ltr">{v.value}</bdi>
          </b>
          <small data-testid={`hover-vital-label-${v.key}`}>{v.label}</small>
          {v.ratio !== undefined && Number.isFinite(v.ratio) ? (
            <meter min={0} max={1} value={Math.min(1, Math.max(0, v.ratio))} aria-label={v.label} />
          ) : (
            <span className="hover-meter-space" aria-hidden />
          )}
        </div>
      ))}
    </div>
  );
}

export function SectionRows({
  summary,
  pinned,
  kind,
  open,
  toggle,
  render,
  docked = false,
}: { summary: HoverSummary; pinned: boolean; kind: "node" | "edge" } & {
  docked?: boolean;
  open: string | null;
  toggle(key: string): void;
  render(section: string): ReactNode;
}) {
  const allSections = docked ? summary.sections : cardSections(summary, kind);
  const sectionFor = (key: string) => {
    // Broker hover cards put their reader breakdown in Outcomes; the inspector has a separate Readers row.
    const preferred = verdictSection(key, kind);
    return preferred === "readers" && !allSections.some((s) => s.key === "readers") ? "outcomes" : preferred;
  };
  const badSections = summary.problems.filter((p) => p.severe).map((p) => sectionFor(p.key));
  const [order] = useState(() => {
    const priority = summary.problems.map((p) => sectionFor(p.key));
    const rank = (key: string) => (priority.includes(key) ? priority.indexOf(key) : priority.length);
    return allSections.map((s) => s.key).sort((a, b) => rank(a) - rank(b));
  });
  const sections = docked
    ? summary.sections
    : allSections
        .filter((s) => pinned || summary.sections.some((compact) => compact.key === s.key))
        .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
        .map((s) => (pinned && s.key === "planning" ? { ...s, label: t("hover.planning") } : s));
  return (
    <div className="hover-sections" data-testid={docked ? "inspector-live-sections" : "hover-sections"}>
      {sections.map((s) => (
        <section key={s.key} className={`hover-rail is-${s.key}${badSections.includes(s.key) ? " is-bad" : ""}`}>
          <button
            data-testid={`${docked ? "inspector-live" : "hover"}-section-${s.key}`}
            className="readout-row"
            data-hover-row=""
            tabIndex={pinned ? 0 : -1}
            aria-expanded={pinned && open === s.key}
            onClick={(e) => {
              e.stopPropagation();
              toggle(s.key);
            }}
          >
            <span aria-hidden>
              {s.key === "threads" ? "☷" : s.key === "latency" ? "◷" : s.key === "resources" ? "▦" : "≡"}
            </span>
            <strong>{s.label}</strong>
            <small>
              <bdi>{s.summary}</bdi>
            </small>
            <span aria-hidden>{pinned && open === s.key ? "⌄" : "›"}</span>
          </button>
          {pinned && open === s.key && render(s.key)}
        </section>
      ))}
    </div>
  );
}
