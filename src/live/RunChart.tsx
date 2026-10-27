import { useId, useLayoutEffect, useRef, useState } from "react";
import { t } from "../i18n";
import type { TimelineMarker } from "../sim/types";
import type { HoverFact } from "./hoverSummary";
import type { RunHistory } from "./runHistory";
import { chartWindow, groupRunFlags, niceMaximum, plotSamples } from "./runChartMath";
import { formatCount, formatRate, formatSeconds } from "./format";
import { timeToFraction } from "./timelineMath";

const H = 168,
  FLAGS = 14;
export function RunChart({
  history,
  node,
  name,
  time,
  total,
  markers,
  vitals,
}: {
  history: RunHistory;
  node: string;
  name: string;
  time: number;
  total: number;
  markers: readonly TimelineMarker[];
  vitals: readonly HoverFact[];
}) {
  const id = useId();
  const svg = useRef<SVGSVGElement>(null);
  const [W, setWidth] = useState(300);
  useLayoutEffect(() => {
    if (!svg.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, entry.contentRect.width)));
    observer.observe(svg.current);
    return () => observer.disconnect();
  }, []);
  // A reset forgets probes; the still-open readout becomes a probe of the new run.
  useLayoutEffect(() => history.probe(node));
  const samples = history.samples(node);
  const end = chartWindow(time, total);
  const points = plotSamples(samples.filter((s) => s.t <= end));
  const rateMax = niceMaximum(Math.max(0, ...samples.map((s) => s.rate)));
  const queueMax = niceMaximum(Math.max(0, ...samples.map((s) => s.queue)));
  const x = (t: number) => timeToFraction(t, end) * W;
  const y = (v: number, max: number) => FLAGS + H - (v / max) * H;
  const line = (key: "rate" | "queue", max: number) =>
    points.map((p, i) => `${i ? "L" : "M"}${x(p.t)} ${y(p[key], max)}`).join(" ");
  const rate = vitals.find((v) => v.key === "rate")?.value ?? "—";
  const queue = vitals.find((v) => v.key === "queue")?.value ?? "—";
  const windowLabel = t("workbench.runWindow", { end: Math.ceil(end / 1000), total: Math.ceil(total / 1000) });
  const flags = groupRunFlags(
    markers.filter((m) => m.atMs <= end),
    end,
    W,
    11,
  );
  const ticks = Array.from({ length: Math.floor(end / 1000) + 1 }, (_, i) => i * 1000);
  const tickStep = Math.max(5, Math.ceil(end / 1000 / 5 / 5) * 5);
  const elapsed = timeToFraction(time, total) * 100;
  const queuePath = line("queue", queueMax);
  return (
    <section className="run-chart" data-testid="dock-run-chart" data-samples={samples.length}>
      <div className="run-chart-head">
        <strong>{t("workbench.thisRun")}</strong>
        <span data-testid="hover-history-scope">{windowLabel}</span>
      </div>
      <div className="run-chart-legend">
        <span>
          <i className="run-rate-swatch" />
          {t("hover.throughput")} <b data-testid="run-chart-rate-now">{rate}</b>
        </span>
        <span>
          <i className="run-queue-swatch" />
          {t("hover.queue")} <b data-testid="run-chart-queue-now">{queue}</b>
        </span>
        <span>
          <i className="run-fault">▲</i>
          {t("hover.fault")}
        </span>
        <span>
          <i className="run-note">◆</i>
          {t("fault.note")}
        </span>
      </div>
      <div className="run-chart-scales">
        <span>
          <i className="run-rate-swatch" />
          0–{formatRate(rateMax)}
        </span>
        <span>
          <i className="run-queue-swatch" />
          0–{formatCount(queueMax)} {t("hover.queue")}
        </span>
      </div>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H + FLAGS}`}
        preserveAspectRatio="none"
        data-testid="hover-history-chart"
        role="img"
        aria-label={t("workbench.runChartAlt", {
          name,
          rateLabel: t("hover.throughput"),
          rate,
          queueLabel: t("hover.queue"),
          queue,
          window: windowLabel,
        })}
        aria-describedby={id}
      >
        <rect className="run-chart-ground" x={0} y={FLAGS} width={W} height={H} />
        {ticks.map((tick) => (
          <line
            key={tick}
            x1={x(tick)}
            x2={x(tick)}
            y1={FLAGS}
            y2={FLAGS + H}
            className={tick % 5000 === 0 ? "run-grid is-major" : "run-grid"}
          />
        ))}
        <line x1={0} x2={W} y1={FLAGS + H / 2} y2={FLAGS + H / 2} className="run-grid" strokeDasharray="2 3" />
        {points.length > 0 && (
          <path
            className="run-queue-area"
            d={`${queuePath} L${x(points.at(-1)!.t)} ${FLAGS + H} L${x(points[0].t)} ${FLAGS + H} Z`}
          />
        )}
        <path className="run-rate-line" d={line("rate", rateMax)} data-testid="hover-history-line" />
        <path className="run-queue-line" d={queuePath} data-testid="run-chart-queue-line" />
        {flags.map((f, index) => {
          const shift = f.kind === "note" && flags.some((g) => g.kind === "fault" && Math.abs(g.x - f.x) < 11) ? 11 : 0;
          const at = Math.max(6, Math.min(W - 6, f.x + shift));
          return (
            <g key={index} className={f.kind === "note" ? "run-note" : "run-fault"}>
              <title>{f.markers.map((m) => m.marker.label).join(", ")}</title>
              <line
                x1={at}
                x2={at}
                y1={FLAGS}
                y2={FLAGS + H}
                stroke="currentColor"
                strokeWidth={1.25}
                strokeDasharray={f.kind === "note" ? "3 3" : undefined}
              />
              <path
                transform={`translate(${at} 8)`}
                d={f.kind === "note" ? "M0 -5 L5 0 L0 5 L-5 0 Z" : "M0 -5 L5 5 L-5 5 Z"}
                fill="currentColor"
              />
              {f.markers.length > 1 && (
                <g transform={`translate(${at + 5} 0)`}>
                  <rect width={16} height={14} rx={3} fill="currentColor" />
                  <text x={8} y={11} textAnchor="middle" fill="white">
                    {f.markers.length}
                  </text>
                </g>
              )}
            </g>
          );
        })}
        <line x1={x(time)} x2={x(time)} y1={FLAGS} y2={H + FLAGS} className="run-chart-playhead" />
      </svg>
      <div className="run-chart-axis">
        {ticks
          .filter((tick) => (tick / 1000) % tickStep === 0)
          .map((tick) => (
            <span key={tick} style={{ insetInlineStart: `${timeToFraction(tick, end) * 100}%` }}>
              {formatSeconds(tick)}
            </span>
          ))}
      </div>
      <div className="run-scale" data-testid="run-chart-scale" data-fraction={timeToFraction(time, total)}>
        <i style={{ width: `${elapsed}%` }} />
        <span className="run-scale-window" style={{ width: `${timeToFraction(end, total) * 100}%` }} />
        <span className="run-scale-playhead" style={{ left: `${elapsed}%` }} />
      </div>
      <div className="run-chart-head">
        <span>{t("workbench.wholeRun")}</span>
        <span>
          {formatSeconds(time)} / {formatSeconds(total)}
        </span>
      </div>
      <span className="sr-only" id={id} data-testid="hover-history-values">
        {samples.map((s) => formatRate(s.rate)).join(", ")}
      </span>
      <span className="sr-only" data-testid="hover-history-summary">
        {t("hover.historySummary", {
          latest: rate,
          low: formatRate(samples.length ? Math.min(...samples.map((s) => s.rate)) : 0),
          peak: formatRate(Math.max(0, ...samples.map((s) => s.rate))),
        })}
      </span>
    </section>
  );
}
