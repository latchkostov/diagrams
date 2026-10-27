import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { SimulationRunState } from "../sim/types";
import { useInteraction } from "../canvas/interaction";
import { t } from "../i18n";
import { formatClock } from "./format";
import { groupRunFlags } from "./runChartMath";
import { fractionToTime, markerSeekTime, timeToFraction, trackLength } from "./timelineMath";
import { useLivePopover } from "./useLivePopover";

const coarseMedia = () => window.matchMedia("(pointer: coarse)");
const coarseSubscribe = (listener: () => void) => {
  const media = coarseMedia();
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
};

/** Faults above, notes below: markers never cover the elapsed track. */
export function RunStrip({
  run,
  onSeek,
  disabled = false,
}: {
  run: SimulationRunState;
  onSeek(ms: number): void;
  disabled?: boolean;
}) {
  const interaction = useInteraction();
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const coarse = useSyncExternalStore(
    coarseSubscribe,
    () => coarseMedia().matches,
    () => false,
  );
  useLayoutEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const total = trackLength(run.totalMs, run.time);
  const groups = groupRunFlags(run.markers, total, width, coarse ? 44 : 14, coarse);
  const [drag, setDrag] = useState<number | null>(null);
  const pending = useRef<number | null>(null);
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const opener = useRef<HTMLButtonElement>(null);
  const [chosen, setChosen] = useState(0);
  const { open, toggle, close } = useLivePopover(() => opener.current);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close("outside");
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close("escape");
      }
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", escape, true);
    };
  }, [open, close]);
  const commit = () => {
    if (pending.current === null) return;
    const fraction = pending.current;
    pending.current = null;
    setDrag(null);
    onSeek(fractionToTime(fraction, total));
  };
  const seek = (at: number) => {
    pending.current = null;
    setDrag(null);
    onSeek(markerSeekTime(at));
  };
  const progress = drag ?? timeToFraction(run.time, total);
  const cluster = groups[chosen];
  return (
    <div
      className={`lv-timeline lv-run-strip${coarse ? " is-coarse" : ""}`}
      ref={root}
      data-testid="live-timeline"
      data-fraction={progress}
      style={{ "--p": `${progress * 100}%`, direction: "ltr" } as CSSProperties}
    >
      <div className="lv-track" aria-hidden data-testid="run-strip-track">
        <span className="lv-fill" />
      </div>
      <span className="lv-playhead" aria-hidden />
      {groups.map((g, i) => {
        const many = g.markers.length > 1;
        const notes = g.markers.filter((m) => m.marker.kind === "note").length;
        const faults = g.markers.length - notes;
        const lane = coarse && many ? "fault" : g.kind;
        const first = g.markers[0];
        return (
          <button
            key={`${first.index}-${many}`}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            className={`run-strip-flag is-${lane}${many ? " is-cluster" : ""}`}
            style={{
              left: `clamp(${coarse ? 30 : 12}px, ${(g.x / Math.max(1, width)) * 100}%, calc(100% - ${coarse ? 30 : 12}px))`,
            }}
            data-testid={many ? `live-marker-cluster-${first.index}` : `live-marker-${first.index}`}
            data-indices={g.markers.map((m) => m.index).join(",")}
            data-at={first.marker.atMs}
            data-lane={lane}
            aria-label={t("resilience.timelineJump", {
              time: formatClock(first.marker.atMs),
              label: g.markers.map((m) => m.marker.label).join(", "),
            })}
            aria-haspopup={many ? "dialog" : undefined}
            aria-expanded={many ? open && chosen === i : undefined}
            disabled={disabled}
            aria-current={i === Math.min(active, groups.length - 1) ? "step" : undefined}
            tabIndex={i === Math.min(active, groups.length - 1) ? 0 : -1}
            onClick={(e) => {
              setActive(i);
              if (!many) return seek(first.marker.atMs);
              opener.current = e.currentTarget;
              setChosen(i);
              if (!open) toggle(e);
            }}
            onKeyDown={(e) => {
              const delta =
                e.key === "ArrowRight" || e.key === "ArrowDown"
                  ? 1
                  : e.key === "ArrowLeft" || e.key === "ArrowUp"
                    ? -1
                    : 0;
              if (!delta && e.key !== "Home" && e.key !== "End") return;
              e.preventDefault();
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? groups.length - 1
                    : (i + delta + groups.length) % groups.length;
              setActive(next);
              const target = refs.current[next];
              if (target) interaction?.dispatch({ type: "node.details", source: "timeline", target });
              seek(groups[next].markers[0].marker.atMs);
            }}
          >
            {many ? (
              <span className="run-strip-count" data-testid={`run-strip-glyph-${first.index}`}>
                {coarse
                  ? `${faults ? `▲${faults}` : ""} ${notes ? `◆${notes}` : ""}`
                  : `${g.kind === "note" ? "◆" : "▲"}${g.markers.length}`}
              </span>
            ) : (
              <span aria-hidden data-testid={`run-strip-glyph-${first.index}`}>
                {g.kind === "note" ? "◆" : "▲"}
              </span>
            )}
          </button>
        );
      })}
      <input
        type="range"
        min={0}
        max={1000}
        step={1}
        value={Math.round(progress * 1000)}
        tabIndex={0}
        aria-label={t("resilience.simulationTime")}
        aria-valuetext={formatClock(fractionToTime(progress, total))}
        data-testid="live-timeline-input"
        name="live-timeline"
        disabled={disabled}
        onChange={(e) => {
          const fraction = Number(e.target.value) / 1000;
          pending.current = fraction;
          setDrag(fraction);
        }}
        onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
        onPointerUp={commit}
        onLostPointerCapture={commit}
        onPointerCancel={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      {open && cluster && (
        <div
          className="run-marker-list"
          role="dialog"
          data-testid="live-marker-list"
          aria-label={t("resilience.simulationTime")}
        >
          {cluster.markers.map(({ marker, index }) => (
            <button
              type="button"
              key={index}
              data-testid={`live-marker-${index}`}
              data-at={marker.atMs}
              onClick={() => {
                seek(marker.atMs);
                close("outside");
              }}
            >
              <span className={marker.kind === "note" ? "run-note" : "run-fault"}>
                {marker.kind === "note" ? "◆" : "▲"}
              </span>{" "}
              {formatClock(marker.atMs)} · {marker.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
