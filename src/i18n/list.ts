import { getLocale } from "./core";

/** Shared list formatting for canvas chrome without loading rates, dates or planning messages. */
export const formatList = (items: string[], type: "and" | "or" = "and"): string =>
  new Intl.ListFormat(getLocale(), { type: type === "and" ? "conjunction" : "disjunction" }).format(items);
