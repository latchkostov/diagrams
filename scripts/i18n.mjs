// `pnpm i18n <command>`: the translation workflow (docs/I18N.md).
//
//   pnpm i18n check [codes…] [--verbose]   validate catalogs: errors fail; missing, stale and the rest are reported
//   pnpm i18n todo <code>                   what a language needs translated (missing and stale), with its glossary,
//                                           as JSON for a translator or an AI to fill in
//   pnpm i18n stamp <code…> [--keys a,b]    record that these translations match today's English (staleness)
//   pnpm i18n add <code>                    start a language: an empty catalog, its meta and a glossary to fill in
//
// Catalogs: src/i18n/locales/<code>.json (key → message), <code>.meta.json (reviewed, source hashes).
// Glossaries: src/i18n/glossary/terms.json (shared) and <code>.json (each language's renderings).
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { runnerImport } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const load = async (file) =>
  (await runnerImport(path.join(root, file), { root, configFile: false, logLevel: "error" })).module;
const en = (await load("src/i18n/en.ts")).default;
const { validateLocale, sourceHash, pluralForms } = await load("src/i18n/validate.ts");

const LOCALES = path.join(root, "src/i18n/locales");
const GLOSSARY = path.join(root, "src/i18n/glossary");
const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback);
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const terms = readJson(path.join(GLOSSARY, "terms.json"));
const codes = () =>
  fs
    .readdirSync(LOCALES)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json"))
    .map((f) => f.slice(0, -5))
    .sort();
const catalog = (code) => readJson(path.join(LOCALES, `${code}.json`), {});
const meta = (code) => readJson(path.join(LOCALES, `${code}.meta.json`), { reviewed: false, sources: {} });
const glossary = (code) => readJson(path.join(GLOSSARY, `${code}.json`), undefined);
/** A catalog in English's key order, so diffs stay small. */
const ordered = (messages) =>
  Object.fromEntries(
    Object.keys(en)
      .filter((k) => messages[k] !== undefined)
      .map((k) => [k, messages[k]]),
  );

const [command, ...rest] = process.argv.slice(2);
const flags = rest.filter((a) => a.startsWith("--"));
const args = rest.filter((a) => !a.startsWith("--"));
const flag = (name) => {
  const hit = rest.find((a) => a.startsWith(`--${name}`));
  return hit === undefined ? undefined : (hit.split("=")[1] ?? true);
};

function report(code) {
  return validateLocale({
    locale: code,
    english: en,
    messages: catalog(code),
    glossary: terms,
    localeGlossary: glossary(code),
    meta: meta(code),
  });
}

if (command === "check") {
  const { lintCatalogBuckets } = await load("scripts/i18n-plugin.ts");
  lintCatalogBuckets();
  const verbose = flags.includes("--verbose");
  let failed = 0;
  const total = Object.keys(en).length;
  for (const code of args.length ? args : codes()) {
    const r = report(code);
    const done = total - r.missing.length;
    const line = `${code.padEnd(7)} ${String(done).padStart(4)}/${total} translated, ${r.missing.length} missing, ${r.stale.length} stale, ${r.warnings.length} warnings, ${r.errors.length} errors`;
    console.log(r.errors.length ? `✗ ${line}` : `  ${line}`);
    for (const e of r.errors) console.log(`    error ${e.kind} ${e.key}: ${e.message}`);
    if (verbose) {
      for (const w of r.warnings) console.log(`    warn  ${w.kind} ${w.key}: ${w.message}`);
      if (r.missing.length) console.log(`    missing: ${r.missing.join(", ")}`);
      if (r.stale.length) console.log(`    stale: ${r.stale.join(", ")}`);
    }
    failed += r.errors.length;
  }
  process.exit(failed ? 1 : 0);
} else if (command === "todo") {
  const code = args[0];
  if (!code) throw new Error("pnpm i18n todo <code>");
  const r = report(code);
  const messages = catalog(code);
  const out = {
    locale: code,
    pluralForms: pluralForms(code),
    rules: [
      "Keep {placeholders}, <tags> and ICU plural/select syntax exactly; translate only the text.",
      "Plurals: give every form listed in pluralForms (one, few, many… as the language needs), always other.",
      "Never translate names in doNotTranslate; follow the glossary's `use` for each term.",
      "Match the length of the English where you can: the UI has room for about 40% more.",
    ],
    doNotTranslate: terms.doNotTranslate,
    glossary: glossary(code) ?? null,
    missing: Object.fromEntries(r.missing.map((k) => [k, en[k]])),
    stale: Object.fromEntries(r.stale.map((k) => [k, { english: en[k], current: messages[k] }])),
    errors: r.errors,
  };
  console.log(JSON.stringify(out, null, 2));
} else if (command === "stamp") {
  const keysFlag = flag("keys");
  const only = typeof keysFlag === "string" ? keysFlag.split(",") : null;
  for (const code of args) {
    const messages = catalog(code);
    writeJson(path.join(LOCALES, `${code}.json`), ordered(messages));
    const m = meta(code);
    m.sources ??= {};
    for (const key of Object.keys(messages))
      if (key in en && (!only || only.includes(key))) m.sources[key] = sourceHash(en[key]);
    // In English's order; a key the catalog no longer has loses its stamp.
    m.sources = Object.fromEntries(
      Object.keys(en)
        .filter((k) => m.sources[k] && k in messages)
        .map((k) => [k, m.sources[k]]),
    );
    writeJson(path.join(LOCALES, `${code}.meta.json`), m);
    console.log(`stamped ${code}: ${Object.keys(m.sources).length} messages`);
  }
} else if (command === "add") {
  const tag = args[0];
  if (!tag) throw new Error("pnpm i18n add <code>, a BCP 47 tag: bg, pt-BR, sr-Latn");
  const [code] = Intl.getCanonicalLocales(tag);
  fs.mkdirSync(LOCALES, { recursive: true });
  const file = path.join(LOCALES, `${code}.json`);
  if (fs.existsSync(file)) throw new Error(`${code} already exists`);
  writeJson(file, {});
  writeJson(path.join(LOCALES, `${code}.meta.json`), { reviewed: false, sources: {} });
  const g = path.join(GLOSSARY, `${code}.json`);
  if (!fs.existsSync(g))
    writeJson(g, {
      language: code,
      register: "",
      quotes: "",
      notes: [],
      terms: Object.fromEntries(Object.keys(terms.terms).map((id) => [id, { use: "" }])),
    });
  const name = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
  console.log(
    [
      `Added ${name} (${code}):`,
      `  src/i18n/locales/${code}.json        its messages (empty: English shows until they're translated)`,
      `  src/i18n/locales/${code}.meta.json   machine-translated until reviewed; the source hashes`,
      `  src/i18n/glossary/${code}.json       fill in each term (docs/research/i18n.md has the research)`,
      `Next: pnpm i18n todo ${code} > todo.json, translate it, merge into the catalog, pnpm i18n stamp ${code},`,
      `pnpm i18n check ${code}. The build offers every catalog in src/i18n/locales (VITE_LOCALES limits them).`,
    ].join("\n"),
  );
} else {
  console.log("pnpm i18n check | todo <code> | stamp <code…> | add <code>   (docs/I18N.md)");
  process.exit(command ? 1 : 0);
}
