import { getLocale } from "./core";

// Shared by canvas chrome and the lazy formatters without loading rates, dates or planning messages.
/** A number: `formatNumber(1234.5)` is "1,234.5", "1.234,5" in German. */
export const formatNumber = (n: number, options?: Intl.NumberFormatOptions): string =>
  new Intl.NumberFormat(getLocale(), options).format(n);
