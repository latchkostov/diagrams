// The formatting helpers a language's compiled catalog calls (scripts/i18n-plugin.ts makes each catalog module
// with `const h = helpersFor("de")`). They load with the first catalog, never at startup: English messages are
// compiled to plain JavaScript (./icu.ts).

export interface Helpers {
  /** Formats a number for the language (percent: a fraction as a percentage); anything else passes through. */
  n(value: unknown, percent?: 1): unknown;
  /** Plural (ordinal: ordinal) form: an exact `=n` option first, then the language's category, else other. */
  p(value: number, forms: Record<string, unknown>, ordinal?: 1): unknown;
  /** A select: the matching option, else other. */
  s(value: unknown, forms: Record<string, unknown>): unknown;
}

const pick = (f: unknown) => (typeof f == "function" ? (f as () => unknown)() : f);

/** The helpers for one language. ("ar" writes Western digits, as Microsoft's Arabic style guide asks; ar-SA wouldn't.) */
export function helpersFor(lang: string): Helpers {
  const numbers = new Intl.NumberFormat(lang);
  const percent = new Intl.NumberFormat(lang, { style: "percent" });
  const cardinal = new Intl.PluralRules(lang);
  const ordinal = new Intl.PluralRules(lang, { type: "ordinal" });
  return {
    n: (x, pc) => (typeof x == "number" ? (pc ? percent : numbers).format(x) : x),
    p: (x, f, o) => pick(f[`=${x}`] ?? f[(o ? ordinal : cardinal).select(x)] ?? f.other),
    s: (x, f) => pick(f[String(x)] ?? f.other),
  };
}
