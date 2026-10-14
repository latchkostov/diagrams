import { formatAgo as formatAgoEnglish } from "../lib/time";
import { getLocale, state, t } from "./index";

// Numbers, units, rates, percentages, dates, relative times and lists in the current language, all through the
// browser's Intl: no data to download, and each language's conventions (1 234,5 in French, 1.234,5 in German,
// 12,34,567 in Hindi; "vor 5 Min."; "A, B und C"). English keeps the app's own wording where it had one.

const lang = () => getLocale();

/** A number: `formatNumber(1234.5)` is "1,234.5", "1.234,5" in German. */
export const formatNumber = (n: number, options?: Intl.NumberFormatOptions): string =>
  new Intl.NumberFormat(lang(), options).format(n);

/** A fraction as a percentage: 0.42 is "42%", "42 %" in German and French. */
export const formatPercent = (fraction: number, digits = 0): string =>
  formatNumber(fraction, { style: "percent", maximumFractionDigits: digits });

/** A rate in messages per second: "1,200 msg/s"; each language words the unit (developers mostly keep msg/s). */
export const formatRate = (perSecond: number): string =>
  t("format.rate", { rate: formatNumber(perSecond, { maximumFractionDigits: perSecond < 10 ? 1 : 0 }) });

/** A duration, in the unit that reads best: "850 ms", "1.2 s", "3 min". */
export function formatDuration(ms: number): string {
  const [value, unit] = ms < 1000 ? [ms, "millisecond"] : ms < 60_000 ? [ms / 1000, "second"] : [ms / 60_000, "minute"];
  return formatNumber(value, { style: "unit", unit, unitDisplay: "short", maximumFractionDigits: value < 10 ? 1 : 0 });
}

/** A list: "A, B and C" ("A, B und C"; "A、B、C"). `or` for alternatives. */
export const formatList = (items: string[], type: "and" | "or" = "and"): string =>
  new Intl.ListFormat(lang(), { type: type === "and" ? "conjunction" : "disjunction" }).format(items);

/** A date (a day and a short month by default: "12 Oct", "12. Okt."). */
export const formatDate = (
  at: number | Date,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" },
): string => new Date(at).toLocaleDateString(lang(), options);

/**
 * How long ago: "just now", "5 min ago", "3 h ago", "yesterday", then a date. In English as the app has always said
 * it; in another language as the browser says it there ("vor 5 Min.", "il y a 3 h", "昨日"), from ./load.ts, which
 * comes with every other language (so the entry doesn't carry it).
 */
export const formatAgo = (at: number, now = Date.now()): string => (state.a ?? formatAgoEnglish)(at, now);
