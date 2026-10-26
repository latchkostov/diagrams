import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "./en";
import { argsOf, parse } from "./icu";
import { sourceHash, validateLocale, type LocaleGlossary, type LocaleMeta, type TermGlossary } from "./validate";
import { catalogLocales, compileCatalog, numberedKeys, readCatalog, rewriteCalls } from "../../scripts/i18n-plugin";

// Every committed catalog, as CI sees it (`pnpm i18n check` prints the same report): no errors in any language,
// every launch language present with its glossary, and the build step's rules. Missing and stale messages are
// reported by `pnpm i18n check`, never failed here: English shows until they're translated (docs/I18N.md).

const DIR = path.resolve("src/i18n");
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")) as T;
const terms = read<TermGlossary>("glossary/terms.json");

/**
 * A language's errors, and its glossary terms without a rendering, from `root` (src/i18n, or a test's copy): what
 * every discovered catalog is held to, launch language or not.
 */
function check(code: string, root = DIR) {
  const json = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) as T;
  const glossary = json<LocaleGlossary>(`glossary/${code}.json`);
  const report = validateLocale({
    locale: code,
    english: en,
    messages: json<Record<string, string>>(`locales/${code}.json`),
    glossary: terms,
    localeGlossary: glossary,
    meta: json<LocaleMeta>(`locales/${code}.meta.json`),
  });
  return { errors: report.errors, undecided: Object.keys(terms.terms).filter((id) => !glossary.terms[id]?.use) };
}

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

  // Every catalog the build would offer, not only the launch languages: a language added later is checked the same way.
  it.each(codes)("%s translates every tutorial message, including quarantined lessons", (code) => {
    const messages = read<Record<string, string>>(`locales/${code}.json`);
    const meta = read<LocaleMeta>(`locales/${code}.meta.json`);
    for (const [key, source] of Object.entries(en).filter(([key]) => key.startsWith("tutorials."))) {
      expect(messages[key], `${code}: ${key}`).toBeTruthy();
      expect(meta.sources?.[key], `${code}: ${key}`).toBe(sourceHash(source));
    }
  });

  it.each(codes)("%s: no errors, and its glossary decides every term", (code) => {
    const { errors, undecided } = check(code);
    expect(errors).toEqual([]);
    expect(undecided, `${code}: glossary terms without a rendering`).toEqual([]);
  });

  it.each(codes)("%s translates the custom colour controls without an English fallback", (code) => {
    const messages = read<Record<string, string>>(`locales/${code}.json`);
    const meta = read<LocaleMeta>(`locales/${code}.meta.json`);
    const keys = [
      "chrome.white",
      "chrome.customColour",
      "chrome.hexColour",
      "chrome.resetColour",
      "chrome.canvasBackgroundTint",
    ] as const;
    for (const key of keys) {
      expect(messages[key], `${code}: ${key}`).toBeTruthy();
      expect(meta.sources?.[key], `${code}: ${key} matches the current English`).toBe(sourceHash(en[key]));
    }
  });

  it("a newly discovered language is validated in full: a renamed plural argument fails", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-catalogs-"));
    try {
      fs.mkdirSync(path.join(root, "locales"));
      fs.mkdirSync(path.join(root, "glossary"));
      const glossary = {
        language: "ca",
        terms: Object.fromEntries(Object.keys(terms.terms).map((id) => [id, { use: "x" }])),
      };
      fs.writeFileSync(path.join(root, "glossary", "ca.json"), JSON.stringify(glossary));
      fs.writeFileSync(path.join(root, "locales", "ca.meta.json"), JSON.stringify({ reviewed: false, sources: {} }));
      fs.writeFileSync(
        path.join(root, "locales", "ca.json"),
        JSON.stringify({ "file.libraryCount": "{n, plural, one {# desat} other {# desats}}" }),
      );
      expect(catalogLocales(path.join(root, "locales"))).toEqual(["ca"]);
      expect(check("ca", root).errors.map((e) => e.kind)).toEqual(["placeholders"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it.each(codes)("%s compiles: every message, by English text or number", (code) => {
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
  const NL = String.fromCharCode(10);
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

  it("recognizes the rich-text wrapper when coverage appends a module query", () => {
    const code = `import { t } from "./index";${NL}const raw = t;`;
    const id = "/repo/src/i18n/rich.ts?cache=1&vitest-uncovered-coverage=true";
    expect(rewriteCalls(code, none, fail, id)).toBeUndefined();
    expect(() => rewriteCalls(code, none, fail, id.replace("rich.ts", "other.ts"))).toThrow("only ever called");
  });

  it("follows the imported binding: an alias is rewritten; a method, a string or a comment never is", () => {
    const alias = `import { t as tr, msg as m } from "../../i18n";${NL}// é… ${call("t", "file.new")}${NL}const a = ${call("tr", "file.new")}, b = ${call("m", "shortcuts.undo")};`;
    const out = rewriteCalls(alias, none, fail)!;
    expect(out).toContain("const a = tr`New diagram`, b = m`Undo`;");
    expect(out).toContain(`// é… ${call("t", "file.new")}`);
    const lookalikes = `${uses}const s = '${call("t", "file.new")}';${NL}other.${call("t", "file.new")};`;
    expect(rewriteCalls(lookalikes, none, fail)).toBeUndefined();
  });

  it("rejects what it can't rewrite: a computed key, t passed around, a message with tags through t", () => {
    const errors: string[] = [];
    const collect = (m: string) => void errors.push(m);
    rewriteCalls(`${uses}const k = "file.new";${NL}t(k);`, none, collect);
    rewriteCalls(`${uses}const rows = ["a"].map(t);`, none, collect);
    rewriteCalls(`${uses}${call("t", "share.linkDesc")};`, none, collect);
    rewriteCalls(`import * as i18n from "../i18n";${NL}i18n.${call("t", "file.new")};`, none, collect);
    expect(errors).toEqual([
      expect.stringMatching(/needs a message key as a string literal/),
      expect.stringMatching(/only ever called/),
      expect.stringMatching(/has tags: render it with tRich/),
      expect.stringMatching(/Import t, msg and tRich by name/),
    ]);
    // A local t (a timer id, a parameter) is not the imported one: left alone, no error.
    const local = `${uses}function f(t) { return t(${JSON.stringify("x")}); }${NL}function g() { const t = 1; clearTimeout(t); }`;
    expect(rewriteCalls(local, none, fail)).toBeUndefined();
    const rich = `import { tRich } from "../i18n/rich";${NL}${call("tRich", "share.linkDesc", ", { b }")};`;
    expect(rewriteCalls(rich, none, fail)).toContain(`tRich(${ids.indexOf("share.linkDesc")},v=>`);
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
