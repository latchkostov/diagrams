import { argsOf, choicesOf, IcuError, parse, tagsOf, textOf, type Part } from "./icu";

// The catalog validator (docs/I18N.md): what `pnpm i18n check` reports and what src/i18n/catalogs.test.ts requires.
//
// Errors (a translation that would break or mislead; the build and the tests fail):
//   - its ICU-lite doesn't parse (./icu.ts);
//   - placeholders or tags differ from English's ({count} dropped, {cuont} added, <b> lost);
//   - a plural misses a form the language needs (Polish one/few/many/other; Arabic all six) or has one it can't use;
//   - a protected name is changed (Kafka, Live Diagrams, Google Drive…: glossary/terms.json's doNotTranslate);
//   - a glossary term is rendered against the language's glossary (glossary/<code>.json: a form to avoid, or none of
//     the accepted ones).
// Warnings (reported, never failing):
//   - missing: English shows instead (the fallback);
//   - stale: English changed since it was translated (meta's source hashes);
//   - same as English, for a message that reads as words: probably untranslated;
//   - long: much longer than English (the UI has room for about 40% more; the pseudo-locale e2e shows what overflows);
//   - typography: the language's own rules (French spaces before : ; ? !).

export interface TermGlossary {
  doNotTranslate: string[];
  terms: Record<string, { en: string[]; note?: string }>;
}

export interface LocaleTerm {
  /** The form to write. */
  use: string;
  /** Developers in this language keep the English word. */
  keepEnglish?: boolean;
  /** Stems a translation may contain instead of `use` (inflected forms); default: `use`. Case-insensitive. */
  match?: string[];
  /** Forms that must not appear (a clash or a wrong sense). */
  avoid?: string[];
  /** Keys where the term may be left out (a natural translation that doesn't need it). */
  except?: string[];
  note?: string;
}

export interface LocaleGlossary {
  language: string;
  /** How the UI addresses the person ("Sie", "vous", "tú"…). */
  register?: string;
  /** Quotation marks. */
  quotes?: string;
  notes?: string[];
  terms: Record<string, LocaleTerm>;
}

export interface LocaleMeta {
  /** A person fluent in the language has reviewed it (otherwise the UI says it's machine-translated). */
  reviewed?: boolean;
  /** Each key's English, hashed, as it was when translated: a different hash now means stale. */
  sources?: Record<string, string>;
}

export interface Issue {
  key: string;
  kind:
    | "syntax"
    | "placeholders"
    | "tags"
    | "plural"
    | "protected"
    | "glossary"
    | "missing"
    | "stale"
    | "untranslated"
    | "long"
    | "typography"
    | "unknown";
  message: string;
}

export interface Report {
  locale: string;
  errors: Issue[];
  warnings: Issue[];
  /** Keys with no translation (English shows). */
  missing: string[];
  /** Keys whose English changed since they were translated. */
  stale: string[];
}

/** A short, stable hash of a message's English (FNV-1a, 32 bits, hex): its translation's source stamp. */
export function sourceHash(english: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < english.length; i++) {
    h ^= english.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** The plural categories a language uses for whole counts people see (0 to 1000): the forms a translation needs. */
export function pluralForms(locale: string, ordinal = false): string[] {
  const rules = new Intl.PluralRules(locale, { type: ordinal ? "ordinal" : "cardinal" });
  const seen = new Set<string>();
  for (let n = 0; n <= 1000; n++) seen.add(rules.select(n));
  return [...seen].sort();
}

const ALL_CATEGORIES = new Set(["zero", "one", "two", "few", "many", "other"]);

/** Words of a message's text, for the leftover-English check. */
const words = (text: string) => text.match(/\p{L}+/gu) ?? [];

/** The term regexes found in an English text (protected names taken out first: "Live Diagrams" isn't Live). */
export function termsIn(english: string, glossary: TermGlossary): string[] {
  let text = english;
  for (const name of glossary.doNotTranslate) text = text.split(name).join(" ");
  return Object.entries(glossary.terms)
    .filter(([, term]) => term.en.some((re) => new RegExp(`(?<![\\p{L}-])(?:${re})(?![\\p{L}-])`, "iu").test(text)))
    .map(([id]) => id);
}

export function validateLocale(opts: {
  locale: string;
  english: Record<string, string>;
  messages: Record<string, string>;
  glossary: TermGlossary;
  localeGlossary?: LocaleGlossary;
  meta?: LocaleMeta;
}): Report {
  const { locale, english, messages, glossary, localeGlossary, meta } = opts;
  const report: Report = { locale, errors: [], warnings: [], missing: [], stale: [] };
  const error = (key: string, kind: Issue["kind"], message: string) => report.errors.push({ key, kind, message });
  const warn = (key: string, kind: Issue["kind"], message: string) => report.warnings.push({ key, kind, message });
  const needed = pluralForms(locale);
  const neededOrdinal = pluralForms(locale, true);

  for (const key of Object.keys(messages))
    if (!(key in english)) warn(key, "unknown", "not in English any more (the build drops it)");

  for (const [key, source] of Object.entries(english)) {
    const message = messages[key];
    if (message === undefined || message === "") {
      report.missing.push(key);
      continue;
    }
    if (meta?.sources?.[key] && meta.sources[key] !== sourceHash(source)) report.stale.push(key);

    let parts: Part[];
    try {
      parts = parse(message);
    } catch (e) {
      error(key, "syntax", e instanceof IcuError ? e.message : String(e));
      continue;
    }
    const en = parse(source);

    // Placeholders and tags: the same names, the same kinds.
    const want = argsOf(en);
    const have = argsOf(parts);
    const names = (m: Map<string, string>) => [...m.keys()].sort().join(", ");
    if (names(want) !== names(have)) error(key, "placeholders", `has {${names(have)}}, English has {${names(want)}}`);
    else
      for (const [name, kind] of want) {
        const here = have.get(name)!;
        // Same kind; a plain argument and a number are interchangeable, and a language with one plural form (Japanese,
        // Chinese, Korean…) may write a plural's number plainly.
        const plain = (k: string) => k === "arg" || k === "number";
        const ok =
          here === kind ||
          (plain(here) && plain(kind)) ||
          (here === "arg" && kind === "plural" && needed.length === 1) ||
          (kind === "arg" && here !== "arg");
        if (!ok) error(key, "placeholders", `{${name}} is ${here} here, ${kind} in English`);
      }
    const tags = (p: Part[]) => [...tagsOf(p)].sort().join(", ");
    if (tags(en) !== tags(parts)) error(key, "tags", `has <${tags(parts)}>, English has <${tags(en)}>`);

    // Plurals: every form the language needs, and none it can't use.
    for (const choice of choicesOf(parts)) {
      if (choice.type !== "plural") continue;
      const forms = choice.ordinal ? neededOrdinal : needed;
      const options = Object.keys(choice.options).filter((o) => !o.startsWith("="));
      const lacking = forms.filter((f) => !options.includes(f));
      if (lacking.length) error(key, "plural", `{${choice.name}} needs ${lacking.join(", ")} in ${locale}`);
      const extra = options.filter((o) => !forms.includes(o) && ALL_CATEGORIES.has(o) && o !== "other");
      if (extra.length) error(key, "plural", `{${choice.name}} has ${extra.join(", ")}, which ${locale} doesn't use`);
      const unknown = options.filter((o) => !ALL_CATEGORIES.has(o));
      if (unknown.length) error(key, "plural", `{${choice.name}} has unknown forms ${unknown.join(", ")}`);
    }

    // Protected names stay exactly as they are.
    const all = textOf(parts, "all");
    const enAll = textOf(en, "all");
    for (const name of glossary.doNotTranslate)
      if (enAll.includes(name) && !all.includes(name)) error(key, "protected", `"${name}" must stay as it is`);

    // The glossary.
    if (localeGlossary) {
      const lower = all.toLocaleLowerCase(locale);
      for (const id of termsIn(enAll, glossary)) {
        const term = localeGlossary.terms[id];
        if (!term) continue;
        for (const bad of term.avoid ?? [])
          if (lower.includes(bad.toLocaleLowerCase(locale)))
            error(key, "glossary", `"${bad}" is avoided for "${id}" in ${locale}; use "${term.use}"`);
        if (term.except?.includes(key)) continue;
        const accepted = [term.use, ...(term.match ?? [])].map((m) => m.toLocaleLowerCase(locale));
        if (!accepted.some((m) => lower.includes(m)))
          error(key, "glossary", `"${id}" should read "${term.use}" (accepted: ${accepted.join(", ")})`);
      }
    }

    // Warnings.
    const text = textOf(parts);
    const enText = textOf(en);
    if (message === source && words(enText).length >= 2 && locale.split("-")[0] !== "en")
      warn(key, "untranslated", "the same as English");
    const ratio = enText.length ? text.length / enText.length : 1;
    if (enText.length >= 4 && ratio > 1.6 && text.length - enText.length > 8)
      warn(key, "long", `${Math.round(ratio * 100)}% of English's length (${text.length} vs ${enText.length})`);
    // \s includes U+00A0 and U+202F: what goes before the mark is one of those, never a letter or a plain space.
    if (locale === "fr" && /(?:\S| )[:;?!](?=\s|$)/.test(text))
      warn(key, "typography", "French puts a non-breaking space (U+00A0 or U+202F) before : ; ? !");
  }
  return report;
}
