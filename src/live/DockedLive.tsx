import { useId, useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { t } from "../i18n";
import type { HoverSummary } from "./hoverSummary";
import { HoverStatus, HoverVerdict, HoverVitals, SectionRows } from "./HoverReadout";
import { verdictSection } from "./verdictSection";
import { SampleSparkline } from "./Sparkline";

/** A selected item's pinned readout: no canvas positioning, announcements or animation. */
export function DockedLive({
  summary,
  healthy,
  time,
  value,
  kind = "node",
  broker = false,
  children,
}: {
  summary: HoverSummary;
  healthy: string;
  time: number;
  value: number;
  kind?: "node" | "edge";
  broker?: boolean;
  children(section: string): ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const description = useId();
  const defaultSection = () =>
    verdictSection(
      summary.problems[0]?.key,
      kind,
      broker ? summary.sections.some((s) => s.key === "readers") : undefined,
    );
  const [section, setSection] = useState(() => ({
    open: defaultSection(),
    chosen: time >= 1000,
  }));
  if (!section.chosen && time >= 1000) setSection({ open: defaultSection(), chosen: true });
  const [history, setHistory] = useState({ at: time, samples: time >= 1000 ? [value] : ([] as number[]) });
  if (time < history.at) setHistory({ at: time, samples: time >= 1000 ? [value] : [] });
  else if (time - history.at >= 1000) setHistory({ at: time, samples: [...history.samples.slice(-9), value] });
  else if (history.samples.length && history.samples.at(-1) !== value)
    setHistory({ ...history, samples: [...history.samples.slice(0, -1), value] });
  const problem = summary.problems[0];
  return (
    <section
      className={`insp-section inspector-live${problem ? (problem.severe ? " is-bad" : " is-warning") : ""}`}
      data-testid="planning-live-details"
    >
      <h3 className="insp-section-title inspector-live-heading">
        <button
          data-testid="planning-live-details-toggle"
          aria-expanded={expanded}
          aria-describedby={!expanded ? description : undefined}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="insp-disclosure-title" data-testid="inspector-live-title">
            {t("hover.live")}
          </span>
          <HoverStatus summary={summary} />
          <Icon name="chevron-right" size={12} />
        </button>
      </h3>
      {!expanded && (
        <p className="insp-summary" id={description} data-testid="inspector-summary-live">
          {problem?.text ?? healthy}
        </p>
      )}
      {expanded && (
        <>
          <HoverVerdict summary={summary} healthy={healthy} />
          {time < 1000 ? (
            <p className="insp-note" data-testid="inspector-live-waiting">
              {t("workspaceLive.waiting")}
            </p>
          ) : (
            <>
              <HoverVitals summary={summary} />
              <SampleSparkline samples={history.samples} docked />
            </>
          )}
          <SectionRows
            summary={summary}
            kind={kind}
            pinned
            docked
            open={section.open}
            toggle={(key) => setSection({ open: section.open === key ? null : key, chosen: true })}
            render={children}
          />
        </>
      )}
    </section>
  );
}
