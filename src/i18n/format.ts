import { getLocale, t } from "./index";
import { formatNumber } from "./number";
export { formatNumber } from "./number";
export { formatAgo } from "./relativeTime";

// Numbers, units, rates, percentages, dates, relative times and lists in the current language, all through the
// browser's Intl: no data to download, and each language's conventions (1 234,5 in French, 1.234,5 in German,
// 12,34,567 in Hindi; "vor 5 Min."; "A, B und C"). English keeps the app's own wording where it had one.

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
  new Intl.ListFormat(getLocale(), { type: type === "and" ? "conjunction" : "disjunction" }).format(items);

/** A date (a day and a short month by default: "12 Oct", "12. Okt."). */
export const formatDate = (
  at: number | Date,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" },
): string => new Date(at).toLocaleDateString(getLocale(), options);

/**
 * How long ago: "just now", "5 min ago", "3 h ago", "yesterday", then a date. In English as the app has always said
 * it; in another language as the browser says it there ("vor 5 Min.", "il y a 3 h", "昨日"), from ./load.ts, which
 * comes with every other language (so the entry doesn't carry it).
 */

/** Decimal byte units for exported files and browser storage. */
export function formatBytes(bytes: number, options: Intl.NumberFormatOptions & { storage?: boolean } = {}): string {
  const { storage, ...numberOptions } = options;
  const mb = options.unit ? options.unit === "megabyte" : bytes >= 100_000;
  const value = mb ? bytes / 1_000_000 : Math.max(1, Math.round(bytes / 1000));
  if (getLocale() === "en") {
    const digits = numberOptions.maximumFractionDigits ?? (mb ? 1 : 0);
    const size = mb ? value.toFixed(digits) : String(value);
    return t("format.byteSize", { size, unit: mb ? "MB" : storage ? "KB" : "kB" });
  }
  const formatted = formatNumber(value, {
    style: "unit",
    unit: mb ? "megabyte" : "kilobyte",
    unitDisplay: "short",
    minimumFractionDigits: mb ? 1 : 0,
    maximumFractionDigits: mb ? 1 : 0,
    useGrouping: getLocale() !== "en",
    ...numberOptions,
  });
  return formatted;
}

/** The import readers used different English list separators before localization. */
export function formatImportList(items: string[], english?: "and" | "comma"): string {
  if (getLocale() !== "en") return formatList(items);
  if (english === "comma" || items.length < 2) return items.join(", ");
  if (english === "and")
    return items.slice(1).reduce((before, last) => t("format.importList", { before, last }), items[0]);
  return t("format.importList", { before: items.slice(0, -1).join(", "), last: items.at(-1)! });
}

/** Import evidence keeps its original precision and seconds/minutes in English. */
export function formatImportTraffic(rate: number, seconds: number): { rate: string; duration: string } {
  const number = (value: number) =>
    getLocale() === "en" ? String(value) : formatNumber(value, { maximumFractionDigits: 20 });
  return {
    rate: t("format.rate", { rate: number(rate) }),
    duration:
      getLocale() === "en"
        ? seconds >= 60
          ? t("format.importMinutes", { duration: number(seconds / 60) })
          : t("format.importSeconds", { duration: number(seconds) })
        : formatDuration(seconds * 1000),
  };
}
