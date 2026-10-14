import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, ViteDevServer } from "vite";
import en from "../src/i18n/en";
import { compile, parse } from "../src/i18n/icu";
import { pseudoLocalize, PSEUDO_LOCALE } from "../src/i18n/pseudo";
import { readDeployment, resolveDeploymentEnv } from "./deployment-env";

// The i18n build step (docs/I18N.md). Two jobs:
//
// 1. Call sites. Each `t("file.new")`, `msg(…)` and `tRich(…)` gets its English inline, in the chunk that uses it
//    (so English costs nothing extra at startup, and the runtime, src/i18n/index.ts, needs no parser):
//      t("file.new")                   → t`New diagram`               plain text: the English is the lookup key
//      t("file.libraryCount", {count}) → t(41,v=>…,{count})           placeholders: a number, English compiled
//    A plain message whose English is shared by another key that some language translates differently ("View" the
//    tab list and "View" the menu) takes the numbered form too, so each keeps its own translation.
// 2. Catalogs. `virtual:i18n/catalogs` maps each language this build offers to a lazy import of
//    `virtual:i18n/catalog/<code>`: src/i18n/locales/<code>.json compiled the same way, keyed by English text or by
//    number. One chunk per language, loaded only by the people who use it. The pseudo-locale (en-XA) is made from
//    English here, in the dev server, Vitest and the e2e build only.
//
// Numbers are positions in the sorted English keys, so they only hold within one build: catalogs and call sites are
// always compiled together.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const LOCALES_DIR = path.join(ROOT, "src/i18n/locales");
const HELPERS = path.join(ROOT, "src/i18n/helpers.ts").replaceAll("\\", "/");
const CATALOGS = "virtual:i18n/catalogs";
const CATALOG = "virtual:i18n/catalog/";
const LOAD_STUB = "\0i18n-load-stub";

type Key = keyof typeof en;
const keys = Object.keys(en).sort() as Key[];
const ids = new Map(keys.map((k, i) => [k, i]));
/** Each message's English, compiled: a JSON string literal when it's plain text, else a function's source. */
const english = new Map(keys.map((k) => [k, compile(en[k], true)]));
const plain = (key: Key) => (english.get(key) ?? "").startsWith('"');

/** The languages with a catalog in src/i18n/locales (`de.json`; not the `.meta.json` beside it). */
export function catalogLocales(dir = LOCALES_DIR): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
}

/** A language's translations, as its file has them (only keys English still has). */
export function readCatalog(code: string, dir = LOCALES_DIR): Partial<Record<Key, string>> {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), "utf8")) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(raw).filter(([k, v]) => ids.has(k as Key) && typeof v === "string" && v),
  ) as Partial<Record<Key, string>>;
}

/**
 * Plain messages that must be looked up by number: their English is shared with another key, and some language
 * translates the two differently.
 */
export function numberedKeys(catalogs: Partial<Record<Key, string>>[]): Set<Key> {
  const byEnglish = new Map<string, Key[]>();
  for (const k of keys) if (plain(k)) byEnglish.set(en[k], [...(byEnglish.get(en[k]) ?? []), k]);
  const out = new Set<Key>();
  for (const group of byEnglish.values()) {
    if (group.length < 2) continue;
    // A key a language hasn't translated reads its sibling's translation: better than English.
    const differ = catalogs.some((c) => new Set(group.map((k) => c[k]).filter(Boolean)).size > 1);
    if (differ) for (const k of group) out.add(k);
  }
  return out;
}

/** A tagged template literal of a text: t`…`. */
const template = (text: string) => `\`${text.replace(/[\\`]|\$\{/g, (c) => `\\${c}`)}\``;

/** A language's catalog module: by English text for plain messages, else by number. */
export function compileCatalog(code: string, numbered: Set<Key>, dir = LOCALES_DIR): string {
  const messages: Partial<Record<Key, string>> = code === PSEUDO_LOCALE ? {} : readCatalog(code, dir);
  const entries: string[] = [];
  for (const key of keys) {
    let compiled: string;
    try {
      if (code === PSEUDO_LOCALE) compiled = compile(pseudoLocalize(parse(en[key])));
      else if (messages[key] !== undefined) compiled = compile(messages[key] ?? "");
      else continue;
    } catch (error) {
      throw new Error(`${code}.json, "${key}": ${(error as Error).message}`, { cause: error });
    }
    const byText = plain(key) && !numbered.has(key);
    // A plain English message stays plain in every language (the validator checks); if not, number it.
    entries.push(`${byText && compiled.startsWith('"') ? JSON.stringify(en[key]) : ids.get(key)}:${compiled}`);
  }
  return [
    `import { helpersFor } from ${JSON.stringify(HELPERS)};`,
    `const h = helpersFor(${JSON.stringify(code)});`,
    `export default {${entries.join(",")}};`,
  ].join("\n");
}

/** Which languages a meta file marks as reviewed by a person (the rest say they're machine-translated). */
function reviewed(dir: string, codes: string[]): string[] {
  return codes.filter((code) => {
    const meta = path.join(dir, `${code}.meta.json`);
    return fs.existsSync(meta) && JSON.parse(fs.readFileSync(meta, "utf8")).reviewed === true;
  });
}

/** Whether a module uses the i18n API: it imports src/i18n (or, inside src/i18n, ./index or ./rich). */
const USES_I18N = /from\s*["'][^"']*\/i18n(?:\/(?:index|rich))?["']/;
const USES_I18N_INSIDE = /from\s*["']\.\/(?:index|rich)["']/;
const CALL = /\b(t|tRich|msg)\(\s*(["'])([A-Za-z0-9_.-]+)\2(\s*\))?/g;

/** Rewrites the call sites in one module's code (`id`: its path); undefined when it has none. */
export function rewriteCalls(
  code: string,
  numbered: Set<Key>,
  onUnknown: (key: string) => void,
  id = "",
): string | undefined {
  const inside = /[/\\]src[/\\]i18n[/\\]/.test(id) && USES_I18N_INSIDE.test(code);
  if (!(inside || USES_I18N.test(code)) || !/\b(?:t|tRich|msg)\(\s*["']/.test(code)) return undefined;
  let changed = false;
  const out = code.replace(CALL, (match, fn: string, _q: string, name: string, closed?: string) => {
    const key = name as Key;
    const id = ids.get(key);
    if (id === undefined) {
      // A dotted name that English hasn't: a typo (TypeScript says so too) or a message not added yet.
      if (name.includes(".")) onUnknown(name);
      return match;
    }
    changed = true;
    if (closed && fn !== "tRich" && plain(key) && !numbered.has(key)) return `${fn}${template(en[key])}`;
    return `${fn}(${id},${english.get(key)}${closed ? ")" : ""}`;
  });
  return changed ? out : undefined;
}

export interface I18nOptions {
  /** Offer catalogs at all (false for the Interactive HTML viewer, which stays English). Default true. */
  catalogs?: boolean;
}

export function i18n(options: I18nOptions = {}): Plugin {
  let pseudo = false;
  /** VITE_LOCALES (scripts/deployment-env.ts): the languages this copy offers; "" for all. */
  let limit = "";
  let numbered = new Set<Key>();
  let server: ViteDevServer | undefined;
  const offered = () => {
    if (options.catalogs === false) return [];
    const wanted = limit ? limit.split(",") : null;
    const codes = catalogLocales().filter((c) => !wanted || wanted.includes(c));
    return pseudo && !wanted ? [...codes, PSEUDO_LOCALE] : codes;
  };
  const refresh = () => {
    numbered = numberedKeys(
      offered()
        .filter((c) => c !== PSEUDO_LOCALE)
        .map((c) => readCatalog(c)),
    );
  };
  return {
    name: "i18n",
    enforce: "pre",
    config(config, { command, mode }) {
      // The pseudo-locale is for spotting untranslated and overflowing UI: the dev server, Vitest and the e2e build.
      pseudo = command === "serve" || process.env.VITE_E2E === "1";
      if (options.catalogs === false) return;
      limit = readDeployment(resolveDeploymentEnv(mode, config.envDir || config.root || process.cwd())).locales;
      const have = new Set(["en", ...catalogLocales()]);
      const missing = limit.split(",").filter((c) => c && !have.has(c));
      if (missing.length)
        throw new Error(`VITE_LOCALES: no catalog for ${missing.join(", ")} (src/i18n/locales; docs/I18N.md)`);
    },
    configureServer(s) {
      server = s;
    },
    buildStart() {
      refresh();
    },
    resolveId(id, importer) {
      if (id === CATALOGS || id.startsWith(CATALOG)) return `\0${id}`;
      // Without catalogs (the Interactive HTML viewer) there's nothing to switch to: the lazy half is a stub.
      if (
        options.catalogs === false &&
        id === "./load" &&
        importer &&
        /[/\\]src[/\\]i18n[/\\]start\.ts$/.test(importer)
      )
        return LOAD_STUB;
    },
    load(id) {
      if (id === LOAD_STUB)
        return "export const start = async () => {};\nexport const openLanguageDialog = async () => {};";
      if (id === `\0${CATALOGS}`) {
        const codes = offered();
        const loaders = codes.map((c) => `${JSON.stringify(c)}:()=>import(${JSON.stringify(CATALOG + c)})`);
        return [
          `export const catalogs = {${loaders.join(",")}};`,
          `export const reviewed = ${JSON.stringify(reviewed(LOCALES_DIR, codes))};`,
        ].join("\n");
      }
      if (id.startsWith(`\0${CATALOG}`)) {
        const code = id.slice(`\0${CATALOG}`.length);
        if (code !== PSEUDO_LOCALE) this.addWatchFile(path.join(LOCALES_DIR, `${code}.json`));
        return compileCatalog(code, numbered);
      }
    },
    transform(code, id) {
      if (id.startsWith("\0") || id.includes("node_modules") || !/\.[cm]?[jt]sx?(?:\?|$)/.test(id)) return;
      const out = rewriteCalls(
        code,
        numbered,
        (key) => this.error(`Unknown message "${key}" (add it to src/i18n/en.ts)`),
        id,
      );
      return out === undefined ? undefined : { code: out, map: null };
    },
    // A catalog edited in the dev server: if it changes which messages are numbered, every call site changes too.
    handleHotUpdate({ file }) {
      if (!file.startsWith(LOCALES_DIR.replaceAll("\\", "/")) && !file.startsWith(LOCALES_DIR)) return;
      const before = [...numbered].join();
      refresh();
      if ([...numbered].join() !== before) void server?.restart();
    },
  };
}
