import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "./en";
import { argsOf, parse } from "./icu";
import { validateLocale, type LocaleGlossary, type LocaleMeta, type TermGlossary } from "./validate";
import { catalogLocales, compileCatalog, numberedKeys, readCatalog, rewriteCalls } from "../../scripts/i18n-plugin";

// Every committed catalog, as CI sees it (`pnpm i18n check` prints the same report): no errors in any language,
// every launch language present with its glossary, and the build step's rules. Missing and stale messages are
// reported by `pnpm i18n check`, never failed here: English shows until they're translated (docs/I18N.md).

const DIR = path.resolve("src/i18n");
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")) as T;
const terms = read<TermGlossary>("glossary/terms.json");

/** Tier 1 (docs/research/i18n.md): the Windows base languages, plus Indonesian, Vietnamese and Hindi. */
const LAUNCH = [
  "ar",
  "bg",
  "cs",
  "da",
  "de",
  "el",
  "es",
  "et",
  "fi",
  "fr",
  "he",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "lt",
  "lv",
  "nb",
  "nl",
  "pl",
  "pt-BR",
  "pt-PT",
  "ro",
  "ru",
  "sk",
  "sl",
  "sr-Latn",
  "sv",
  "th",
  "tr",
  "uk",
  "vi",
  "zh-CN",
  "zh-TW",
];

describe("the English source", () => {
  it("parses, every message", () => {
    for (const [key, message] of Object.entries(en)) expect(() => parse(message), key).not.toThrow();
  });

  it("keys are area.name, lower camel case", () => {
    for (const key of Object.keys(en)) expect(key).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/);
  });
});

describe("the catalogs", () => {
  const codes = catalogLocales();

  it("every launch language has a catalog, a meta file and a glossary", () => {
    expect(codes).toEqual(expect.arrayContaining(LAUNCH));
    for (const code of codes) {
      expect(fs.existsSync(path.join(DIR, "locales", `${code}.meta.json`)), code).toBe(true);
      expect(fs.existsSync(path.join(DIR, "glossary", `${code}.json`)), code).toBe(true);
    }
  });

  it.each(LAUNCH)("%s: no errors, and its glossary decides every term", (code) => {
    const glossary = read<LocaleGlossary>(`glossary/${code}.json`);
    const report = validateLocale({
      locale: code,
      english: en,
      messages: read<Record<string, string>>(`locales/${code}.json`),
      glossary: terms,
      localeGlossary: glossary,
      meta: read<LocaleMeta>(`locales/${code}.meta.json`),
    });
    expect(report.errors).toEqual([]);
    const undecided = Object.keys(terms.terms).filter((id) => !glossary.terms[id]?.use);
    expect(undecided, `${code}: glossary terms without a rendering`).toEqual([]);
  });

  it.each(LAUNCH)("%s compiles: every message, by English text or number", (code) => {
    const source = compileCatalog(code, numberedKeys(codes.map((c) => readCatalog(c))));
    expect(source).toMatch(/^import \{ helpersFor \} from /);
    expect(source.split("\n").at(-1)).toMatch(/^export default \{.*\};$/);
  });
});

describe("the build step (scripts/i18n-plugin.ts)", () => {
  const none = new Set<never>();
  const fail = (key: string) => {
    throw new Error(key);
  };
  const ids = Object.keys(en).sort();
  // Module code to rewrite, spelled so this file's own transform (the same plugin) doesn't rewrite it first.
  const uses = `import { t } from "../i18n";${"\n"}`;
  const call = (fn: string, key: string, rest = "") => `${fn}(${JSON.stringify(key)}${rest})`;

  it("a plain message becomes t`English`; one with arguments t(number, English, values)", () => {
    const code = `${uses}const a = ${call("t", "file.new")};${"\n"}const b = ${call("t", "file.libraryCount", ", { count }")};`;
    const out = rewriteCalls(code, none, fail)!;
    expect(out).toContain("const a = t`New diagram`;");
    expect(out).toContain(`const b = t(${ids.indexOf("file.libraryCount")},v=>`);
    expect(out).toContain(", { count });");
  });

  it("leaves modules that don't use the i18n API alone, and their own t() calls", () => {
    expect(rewriteCalls(`const t = (x) => x;${"\n"}${call("t", "file.new")};`, none, fail)).toBeUndefined();
    expect(rewriteCalls(`${uses}${call("msg", "db", ', "billing"')};`, none, fail)).toBeUndefined();
  });

  it("fails on a dotted key English hasn't", () => {
    expect(() => rewriteCalls(`${uses}${call("t", "file.nope")};`, none, fail)).toThrow("file.nope");
  });

  it("a plain message's English is the template's text", () => {
    expect(rewriteCalls(`${uses}${call("t", "start.privacy")};`, none, fail)).toContain("t`Privacy`");
  });

  it("numbers plain messages whose shared English some language translates differently", () => {
    // "Privacy" is start.privacy, shortcuts.privacy and file.privacy: one language translating them differently
    // gives each its own number, so each keeps its translation.
    const same = numberedKeys([{ "start.privacy": "Datenschutz", "shortcuts.privacy": "Datenschutz" }]);
    expect(same.has("start.privacy")).toBe(false);
    // One not translated yet reads its sibling's translation.
    expect(numberedKeys([{ "start.privacy": "Datenschutz" }]).size).toBe(0);
    const differ = numberedKeys([{ "start.privacy": "Datenschutz", "file.privacy": "Privatsphäre" }]);
    expect([...differ].sort()).toEqual(["file.privacy", "shortcuts.privacy", "start.privacy"]);
    const out = rewriteCalls(`${uses}${call("t", "file.privacy")};`, differ, fail)!;
    expect(out).toContain(`t(${ids.indexOf("file.privacy")},"Privacy")`);
  });

  it("English and every catalog agree on each message's placeholders", () => {
    // What the runtime relies on: a plain English message is plain in every language (by text), one with arguments
    // is a function in every language (by number).
    for (const code of catalogLocales()) {
      const messages = readCatalog(code);
      for (const [key, message] of Object.entries(messages)) {
        const plainEnglish = argsOf(parse(en[key as keyof typeof en])).size === 0;
        const plainHere = argsOf(parse(message!)).size === 0;
        if (plainEnglish) expect(plainHere, `${code} ${key}`).toBe(true);
      }
    }
  });
});
