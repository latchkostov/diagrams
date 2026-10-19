// Number formatting for live badges, chips and the control bar. Short, stable widths: a badge that
// jumps between "999" and "1000" every frame is hard to read on a projector.
import { formatNumber } from "../i18n/number";

/** Dot weights can be fractional when a caller pool is not divisible by the requested sample size. */
export function formatScale(scale: number): string {
  return Number.isInteger(scale) ? formatCount(scale) : formatNumber(scale, { maximumFractionDigits: 3 });
}

/** 0 → "0", 999 → "999", 1234 → "1.2k", 15300 → "15k", 2_500_000 → "2.5M". */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "–";
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(Math.round(n));
  if (v < 1000) return `${sign}${v}`;
  if (v < 10_000) return `${sign}${trim((v / 1000).toFixed(1))}k`;
  if (v < 1_000_000) return `${sign}${Math.round(v / 1000)}k`;
  if (v < 10_000_000) return `${sign}${trim((v / 1_000_000).toFixed(1))}M`;
  return `${sign}${Math.round(v / 1_000_000)}M`;
}

/** Messages per second: "0/s" below 0.05, one decimal under 10, whole numbers above. */
export function formatRate(perSec: number): string {
  if (!Number.isFinite(perSec) || perSec < 0.05) return "0/s";
  if (perSec < 10) return `${trim(perSec.toFixed(1))}/s`;
  return `${formatCount(perSec)}/s`;
}

/** Simulation clock: "0.0s", "12.4s", "1:05". */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** Durations typed by people: 0 → "0 s", 1500 → "1.5 s", 90000 → "90 s". */
export function formatSeconds(ms: number): string {
  return `${trim((Math.max(0, ms) / 1000).toFixed(1))} s`;
}

export function formatSpeed(speed: number): string {
  return `${speed < 1 ? speed : trim(speed.toFixed(2))}×`;
}

/** "0.1" → 10%, used by the failure-rate menu. */
export function formatPercent(p: number): string {
  return `${Math.round(p * 100)}%`;
}

const trim = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);

/** Heat 0..1 from a backlog: grows fast for the first messages, saturates around `full`. */
export function heatOf(backlog: number, full = 60): number {
  if (!(backlog > 0)) return 0;
  return Math.min(1, Math.log1p(backlog) / Math.log1p(full));
}

/**
 * What a broker's waiting count is called, on its badge and in its hover card. A queue's messages are queued; a
 * topic or stream with consumers has lag (per consumer group, the largest shown); one with no consumer has no lag
 * at all, it keeps what's published: "Nobody reads this yet · 297 kept".
 */
export function heldWords(s: { role: string; noConsumer?: boolean }): { lead?: string; unit: string; row: string } {
  if (s.role === "queue") return { unit: "queued", row: "Queued" };
  if (s.noConsumer) return { lead: "Nobody reads this yet", unit: "kept", row: "Kept" };
  return { unit: "lag", row: "Lag (max group)" };
}
