import { getLocale } from "./core";

// Shared by canvas chrome and the lazy formatters without loading rates, dates or planning messages.
/** A number: `formatNumber(1234.5)` is "1,234.5", "1.234,5" in German. */
const formatters = new Map<string, Intl.NumberFormat>();
export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  const locale = getLocale();
  const key = JSON.stringify([locale, Object.entries(options ?? {}).sort(([a], [b]) => a.localeCompare(b))]);
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    formatters.set(key, formatter);
  }
  return formatter.format(n);
}
