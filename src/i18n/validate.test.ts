import { describe, expect, it } from "vitest";
import { pluralForms, sourceHash, termsIn, validateLocale, type LocaleGlossary, type TermGlossary } from "./validate";

// The catalog validator (./validate.ts): what `pnpm i18n check` and catalogs.test.ts hold every language to.

const GLOSSARY: TermGlossary = {
  doNotTranslate: ["Live Diagrams", "Kafka", "Google Drive"],
  terms: {
    topic: { en: ["topics?"] },
    diagram: { en: ["diagrams?"] },
    live: { en: ["live view", "go live"] },
  },
};
const BG: LocaleGlossary = {
  language: "bg",
  terms: {
    topic: { use: "topic", keepEnglish: true, avoid: ["тема"] },
    diagram: { use: "диаграма", match: ["диаграм"] },
  },
};

const check = (english: Record<string, string>, messages: Record<string, string>, locale = "bg") =>
  validateLocale({ locale, english, messages, glossary: GLOSSARY, localeGlossary: BG });
const kinds = (r: ReturnType<typeof check>) => r.errors.map((e) => `${e.kind} ${e.key}`);

describe("errors", () => {
  it("broken ICU", () => {
    expect(kinds(check({ a: "{n, plural, other {#}}" }, { a: "{n, plural, other {#}" }))).toEqual(["syntax a"]);
  });

  it("placeholders and tags must match English's", () => {
    const en = { a: "To {name}", b: "<b>Public:</b> anyone", c: "{n, plural, other {# x}}" };
    const r = check(en, { a: "Към {nmae}", b: "Публична: всеки", c: "{n} x" });
    expect(kinds(r)).toEqual(["placeholders a", "tags b", "placeholders c"]);
  });

  it("plurals need every form the language uses, and none it doesn't", () => {
    const en = { a: "{n, plural, one {# diagram} other {# diagrams}}" };
    const pl = (m: string) => validateLocale({ locale: "pl", english: en, messages: { a: m }, glossary: GLOSSARY });
    expect(pl("{n, plural, one {# diagram} other {# diagramy}}").errors[0].message).toMatch(/needs few, many in pl/);
    expect(pl("{n, plural, one {#} few {#} many {#} other {#}}").errors).toEqual([]);
    const ja = validateLocale({
      locale: "ja",
      english: en,
      messages: { a: "{n, plural, one {#} other {#}}" },
      glossary: GLOSSARY,
    });
    expect(ja.errors[0].message).toMatch(/has one, which ja doesn't use/);
    const bg = check(en, { a: "{n, plural, one {# диаграма} other {# диаграми} wat {#}}" });
    expect(bg.errors[0].message).toMatch(/unknown forms wat/);
  });

  it("protected names stay exactly as they are", () => {
    expect(kinds(check({ a: "Kafka and Google Drive" }, { a: "Кафка и Google Drive" }))).toEqual(["protected a"]);
  });

  it("the glossary: a term rendered against it, or a form to avoid", () => {
    const en = { a: "Delete the topic", b: "Open a diagram", c: "Your diagrams" };
    const r = check(en, { a: "Изтрийте темата", b: "Отворете схема", c: "Вашите диаграми" });
    expect(kinds(r)).toEqual(["glossary a", "glossary a", "glossary b"]);
    expect(r.errors[0].message).toMatch(/"тема" is avoided for "topic"/);
  });

  it("protected names hide what's inside them from the glossary (Live Diagrams isn't live view)", () => {
    expect(termsIn("Live Diagrams is free", GLOSSARY)).toEqual([]);
    expect(termsIn("Then leave live view", GLOSSARY)).toEqual(["live"]);
    expect(termsIn("Two topics and a diagram", GLOSSARY)).toEqual(["topic", "diagram"]);
  });

  it("a glossary exception lets a natural translation leave a term out", () => {
    const g = { ...BG, terms: { ...BG.terms, diagram: { ...BG.terms.diagram, except: ["b"] } } };
    const r = validateLocale({
      locale: "bg",
      english: { b: "Open a diagram" },
      messages: { b: "Отворете файл" },
      glossary: GLOSSARY,
      localeGlossary: g,
    });
    expect(r.errors).toEqual([]);
  });
});

describe("reported, never failing", () => {
  it("missing, stale, untranslated, long", () => {
    const en = { a: "Save a copy", b: "Open", c: "Keep", d: "Done" };
    const r = validateLocale({
      locale: "bg",
      english: en,
      messages: { a: "Save a copy", c: "Запазете", d: "Готово, затворете този прозорец сега" },
      glossary: GLOSSARY,
      meta: { sources: { c: sourceHash("Keep it"), d: sourceHash("Done") } },
    });
    expect(r.errors).toEqual([]);
    expect(r.missing).toEqual(["b"]);
    expect(r.stale).toEqual(["c"]);
    expect(r.warnings.map((w) => `${w.kind} ${w.key}`)).toEqual(["untranslated a", "long d"]);
  });

  it("French spacing before : ; ? !", () => {
    const fr = (m: string) =>
      validateLocale({ locale: "fr", english: { a: "Public: anyone" }, messages: { a: m }, glossary: GLOSSARY });
    expect(fr("Public : tout le monde").warnings.map((w) => w.kind)).toEqual(["typography"]);
    expect(fr("Public : tout le monde").warnings).toEqual([]);
  });
});

describe("helpers", () => {
  it("the plural forms a language needs for whole counts", () => {
    expect(pluralForms("en")).toEqual(["one", "other"]);
    expect(pluralForms("bg")).toEqual(["one", "other"]);
    expect(pluralForms("fr")).toEqual(["one", "other"]);
    expect(pluralForms("pl")).toEqual(["few", "many", "one"]);
    expect(pluralForms("ar")).toEqual(["few", "many", "one", "other", "two", "zero"]);
    expect(pluralForms("ja")).toEqual(["other"]);
  });

  it("source hashes are short and stable", () => {
    expect(sourceHash("New diagram")).toMatch(/^[0-9a-f]{8}$/);
    expect(sourceHash("New diagram")).toBe(sourceHash("New diagram"));
    expect(sourceHash("New diagram")).not.toBe(sourceHash("New diagrams"));
  });
});
