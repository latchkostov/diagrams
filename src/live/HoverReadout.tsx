import { useState, type ReactNode } from "react";
import { t } from "../i18n";
import type { HoverSummary } from "./hoverSummary";

export function HoverStatus({ summary }: { summary: HoverSummary }) {
  const problem = summary.problems[0];
  return (
    <span className="hover-status">
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
          <b className="mono" title={v.value}>
            <bdi dir="ltr">{v.value}</bdi>
          </b>
          <small>{v.label}</small>
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
  const sectionFor = (key: string): string =>
    kind === "edge"
      ? key === "retry"
        ? "retries"
        : key === "breaker"
          ? "breaker"
          : "timeouts"
      : key === "timeout"
        ? "latency"
        : key === "memory"
          ? "resources"
          : key === "threads" || key === "retry"
            ? "threads"
            : "outcomes";
  const badSections = summary.problems.filter((p) => p.severe).map((p) => sectionFor(p.key));
  const [order] = useState(() => {
    const priority = summary.problems.map((p) => sectionFor(p.key));
    const rank = (key: string) => (priority.includes(key) ? priority.indexOf(key) : priority.length);
    return summary.sections.map((s) => s.key).sort((a, b) => rank(a) - rank(b));
  });
  let sections = docked
    ? summary.sections
    : [...summary.sections].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  if (!docked && pinned && kind === "node")
    sections = [
      ...sections,
      { key: "outcomes", label: t("hover.outcomes"), summary: "" },
      { key: "planning", label: t("hover.planning"), summary: "" },
    ]
      .filter((s, i, all) => all.findIndex((a) => a.key === s.key) === i)
      .map((s) => (s.key === "planning" ? { ...s, label: t("hover.planning") } : s));
  return (
    <div className="hover-sections">
      {sections.map((s) => (
        <section key={s.key} className={`hover-rail is-${s.key}${badSections.includes(s.key) ? " is-bad" : ""}`}>
          <button
            data-testid={`${docked ? "inspector-live" : "hover"}-section-${s.key}`}
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
