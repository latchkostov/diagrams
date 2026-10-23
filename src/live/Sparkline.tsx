import { useId, useMemo, useState } from "react";
import type { TrafficShape } from "../model/types";
import { trafficRateAt, trafficWindow } from "../sim/simulation";
import { formatClock, formatCount, formatRate } from "./format";
import { t } from "../i18n";

const W = 260;
const H = 54;
const N = 120;

/** A bounded observed series, rather than a configured traffic curve. Its values are also text, for every reader. */
export function SampleSparkline({ samples }: { samples: readonly number[] }) {
  const id = useId();
  const peak = Math.max(1, ...samples);
  const line = samples
    .map((v, i) => `${i ? "L" : "M"}${(i * W) / Math.max(1, samples.length - 1)} ${H - 4 - (v / peak) * (H - 12)}`)
    .join(" ");
  const summary = t("hover.historySummary", {
    latest: formatRate(samples.at(-1) ?? 0),
    low: formatRate(Math.min(...samples)),
    peak: formatRate(Math.max(0, ...samples)),
  });
  return (
    <div className="lv-spark" data-testid="hover-history">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        data-testid="hover-history-chart"
        role="img"
        aria-label={t("hover.history", { count: samples.length })}
        aria-describedby={`${id}summary ${id}values`}
      >
        <path d={line} className="lv-spark-line" fill="none" />
      </svg>
      <div className="lv-spark-legend mono">
        <span id={`${id}summary`} data-testid="hover-history-summary">
          {summary}
        </span>
      </div>
      <span id={`${id}values`} className="sr-only" data-testid="hover-history-values">
        {t("hover.historyValues", { values: samples.map(formatRate).join(", ") })}
      </span>
    </div>
  );
}

/** Samples a traffic shape's rate curve; also integrates it for the "≈ N messages" readout. */
function sampleRate(shape: TrafficShape, points = N): { tMax: number; rates: number[]; peak: number; total: number } {
  const w = trafficWindow(shape);
  const tMax = Math.max(1000, w.endMs * 1.08 + 200);
  const rates: number[] = [];
  for (let i = 0; i <= points; i++) rates.push(trafficRateAt(shape, (tMax * i) / points));
  const total =
    shape.kind === "burst" ? Math.max(0, shape.count) : rates.reduce((sum, r) => sum + (r * tMax) / points / 1000, 0);
  return { tMax, rates, peak: Math.max(0, ...rates), total };
}

/** One series: a filled rate curve with a hover crosshair showing the rate at that moment. */
export function Sparkline({ shape, testId }: { shape: TrafficShape; testId?: string }) {
  const { tMax, rates, peak, total } = useMemo(() => sampleRate(shape), [shape]);
  const [hover, setHover] = useState<number | null>(null);
  const y = (r: number) => H - 4 - (peak > 0 ? (r / peak) * (H - 12) : 0);
  const x = (i: number) => (i / N) * W;
  const line = rates.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(r).toFixed(1)}`).join(" ");
  const area = `${line} L${W} ${H - 4} L0 ${H - 4} Z`;
  const hi = hover === null ? null : Math.round(hover * N);

  return (
    <div className="lv-spark" data-testid={testId}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
        }}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`Rate peaks at ${formatRate(peak)}, about ${formatCount(total)} messages`}
      >
        <line x1="0" x2={W} y1={H - 4} y2={H - 4} className="lv-spark-base" />
        <path d={area} className="lv-spark-area" />
        <path d={line} className="lv-spark-line" vectorEffect="non-scaling-stroke" />
        {hi !== null && (
          <line x1={x(hi)} x2={x(hi)} y1="2" y2={H - 4} className="lv-spark-cross" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <div className="lv-spark-legend mono">
        {hi !== null ? (
          <span>
            {formatClock((tMax * hi) / N)} · {formatRate(rates[hi])}
          </span>
        ) : (
          <span>peak {formatRate(peak)}</span>
        )}
        <span>≈ {formatCount(total)} messages</span>
      </div>
    </div>
  );
}
