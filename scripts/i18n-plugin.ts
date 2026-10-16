import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAst, type Plugin, type ViteDevServer } from "vite";
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
//    tab list and "View" the menu) takes the numbered form too, so each keeps its own translation. Calls are found in
//    the module's syntax tree, after TypeScript and JSX are compiled away, by the bindings imported from src/i18n.
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
export function compileCatalog(
  code: string,
  numbered: Set<Key>,
  dir = LOCALES_DIR,
  prefix = "",
  excludeStandalone = false,
): string {
  const messages: Partial<Record<Key, string>> = code === PSEUDO_LOCALE ? {} : readCatalog(code, dir);
  const entries: string[] = [];
  for (const key of keys) {
    if (!key.startsWith(prefix) || (excludeStandalone && /^(?:staticAuth|staticSkill)\./.test(key))) continue;
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

/** The i18n API's module, as an import names it: src/i18n (or ./index, ./rich from inside src/i18n). */
const API_MODULE = /(?:^|\/)i18n(?:\/(?:index|core|rich))?$/;
const API_MODULE_INSIDE = /^\.\/(?:index|core|rich)$/;
const API = new Set(["t", "msg", "tRich"]);

interface Node {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}
const isNode = (v: unknown): v is Node => !!v && typeof v === "object" && typeof (v as Node).type === "string";

/** The names a binding pattern declares (`x`, `{ a, b: c }`, `[d, ...e]`, `f = 1`). */
function patternNames(node: unknown, out: string[] = []): string[] {
  if (!isNode(node)) return out;
  if (node.type === "Identifier") out.push(node.name as string);
  else if (node.type === "ObjectPattern")
    for (const p of node.properties as Node[]) patternNames(p.type === "RestElement" ? p.argument : p.value, out);
  else if (node.type === "ArrayPattern") for (const e of node.elements as unknown[]) patternNames(e, out);
  else if (node.type === "RestElement") patternNames(node.argument, out);
  else if (node.type === "AssignmentPattern") patternNames(node.left, out);
  return out;
}

/** The names declared directly in a scope's statements: let, const, var, functions and classes. */
function declaredIn(statements: unknown): string[] {
  const out: string[] = [];
  for (const s of Array.isArray(statements) ? statements : []) {
    if (!isNode(s)) continue;
    const decl = s.type === "ExportNamedDeclaration" || s.type === "ExportDefaultDeclaration" ? s.declaration : s;
    if (!isNode(decl)) continue;
    if (decl.type === "VariableDeclaration") for (const d of decl.declarations as Node[]) patternNames(d.id, out);
    else if ((decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") && isNode(decl.id))
      out.push(decl.id.name as string);
  }
  return out;
}

/** The names a node declares for its own scope (a function's parameters, a block's declarations…), if it has one. */
function scopeOf(node: Node): string[] | undefined {
  switch (node.type) {
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      return [
        ...(node.params as Node[]).flatMap((p) => patternNames(p)),
        ...(node.type === "FunctionExpression" && isNode(node.id) ? [node.id.name as string] : []),
      ];
    case "BlockStatement":
    case "StaticBlock":
      return declaredIn(node.body);
    case "SwitchStatement":
      return (node.cases as Node[]).flatMap((c) => declaredIn(c.consequent));
    case "ForStatement":
      return isNode(node.init) && node.init.type === "VariableDeclaration" ? declaredIn([node.init]) : [];
    case "ForInStatement":
    case "ForOfStatement":
      return isNode(node.left) && node.left.type === "VariableDeclaration" ? declaredIn([node.left]) : [];
    case "CatchClause":
      return patternNames(node.param);
    case "ClassExpression":
      return isNode(node.id) ? [node.id.name as string] : [];
    default:
      return undefined;
  }
}

/**
 * Every node, with its parent, the property that holds it, and whether a name is shadowed there: declared in a scope
 * between the node and the module's top (a local `t` isn't the imported one). `var` counts as block-scoped here,
 * which only errs towards treating a name as shadowed.
 */
function walk(
  node: Node,
  visit: (node: Node, parent: Node | undefined, key: string, shadowed: (name: string) => boolean) => void,
  parent?: Node,
  key = "",
  scopes: string[][] = [],
) {
  const own = node.type === "Program" ? undefined : scopeOf(node);
  const inner = own?.length ? [...scopes, own] : scopes;
  visit(node, parent, key, (name) => inner.some((s) => s.includes(name)));
  for (const [k, value] of Object.entries(node)) {
    if (k === "parent") continue;
    if (Array.isArray(value)) {
      for (const child of value) if (isNode(child)) walk(child, visit, node, k, inner);
    } else if (isNode(value)) walk(value, visit, node, k, inner);
  }
}

/** Where an identifier is a name, not a reference: `a.t`, `{ t: 1 }`, an import's own name. */
function isNameOnly(parent: Node | undefined, key: string): boolean {
  if (!parent) return false;
  if (parent.type === "MemberExpression" && key === "property" && !parent.computed) return true;
  if (
    (parent.type === "Property" || parent.type === "MethodDefinition" || parent.type === "PropertyDefinition") &&
    key === "key" &&
    !parent.computed &&
    !parent.shorthand
  )
    return true;
  return parent.type === "ImportSpecifier" || parent.type === "ExportSpecifier";
}

/**
 * Rewrites the i18n calls in one module's JavaScript (after TypeScript and JSX are compiled away; `id`: its path).
 * Only calls of the bindings imported from src/i18n count, under whatever local name (`import { t as tr }`); a
 * method `other.t("x")`, a string or a comment never does. What the build can't rewrite is an error, reported through
 * `onError` (the build fails): a key that isn't a string literal, a key English hasn't, a message with tags passed to
 * t or msg, or t passed around as a value. Undefined when the module has nothing to rewrite.
 */
export function rewriteCalls(
  code: string,
  numbered: Set<Key>,
  onError: (message: string) => void,
  id = "",
): string | undefined {
  if (!/i18n|\.\/(?:index|core|rich)/.test(code)) return undefined;
  const inside = /[/\\]src[/\\]i18n[/\\]/.test(id);
  let ast: Node;
  try {
    ast = parseAst(code) as unknown as Node;
  } catch {
    return undefined; // not JavaScript this step reads (the transform pipeline reports real syntax errors)
  }
  // The local names of t, msg and tRich in this module.
  const local = new Map<string, string>();
  for (const statement of ast.body as Node[]) {
    if (statement.type !== "ImportDeclaration") continue;
    const source = String((statement.source as Node).value);
    if (!API_MODULE.test(source) && !(inside && API_MODULE_INSIDE.test(source))) continue;
    for (const spec of statement.specifiers as Node[]) {
      if (spec.type === "ImportNamespaceSpecifier")
        onError(`Import t, msg and tRich by name from "${source}": the build rewrites their calls`);
      if (spec.type !== "ImportSpecifier") continue;
      const imported = (spec.imported as Node).name as string;
      if (API.has(imported)) local.set((spec.local as Node).name as string, imported);
    }
  }
  if (!local.size) return undefined;
  // rich.ts wraps t itself; everywhere else t, msg and tRich are only ever called.
  const valuesAllowed = /[/\\]src[/\\]i18n[/\\]rich\.ts$/.test(id);
  const edits: { start: number; end: number; text: string }[] = [];
  const callees = new Set<Node>();
  walk(ast, (node, parent, key, shadowed) => {
    if (node.type === "CallExpression" && isNode(node.callee) && node.callee.type === "Identifier") {
      const name = node.callee.name as string;
      const fn = local.get(name);
      if (!fn || shadowed(name)) return;
      callees.add(node.callee);
      const args = node.arguments as Node[];
      const first = args[0];
      if (!first || first.type !== "Literal" || typeof first.value !== "string") {
        onError(`${name}() needs a message key as a string literal (${id})`);
        return;
      }
      const k = first.value as Key;
      const n = ids.get(k);
      if (n === undefined) {
        onError(`Unknown message "${first.value}" (add it to src/i18n/en.ts)`);
        return;
      }
      const rich = /<[a-z][a-z0-9]*>/.test(en[k]);
      if (rich && fn !== "tRich") {
        onError(`"${k}" has tags: render it with tRich, not ${fn} (${id})`);
        return;
      }
      if (args.length === 1 && fn !== "tRich" && plain(k) && !numbered.has(k))
        edits.push({ start: node.start, end: node.end, text: `${name}${template(en[k])}` });
      else if (args.length === 1)
        edits.push({ start: node.start, end: node.end, text: `${name}(${n},${english.get(k)})` });
      else edits.push({ start: node.start, end: first.end, text: `${name}(${n},${english.get(k)}` });
      return;
    }
    if (
      node.type === "Identifier" &&
      local.has(node.name as string) &&
      !valuesAllowed &&
      !shadowed(node.name as string)
    ) {
      if (isNameOnly(parent, key) || (parent?.type === "CallExpression" && key === "callee")) return;
      onError(`${node.name as string} is only ever called, with a string key: the build rewrites the calls (${id})`);
    }
  });
  if (!edits.length) return undefined;
  let out = code;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

export interface I18nOptions {
  /** Offer catalogs at all (false for the Interactive HTML viewer, which stays English). Default true. */
  catalogs?: boolean;
  /** Explicit scope: a standalone area, or "" for complete validation/parity catalogs. Omitted: app messages. */
  prefix?: string;
  /** Include the layout-testing language in a standalone dev script. */
  pseudo?: boolean;
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
    config(config, { command, mode }) {
      // The pseudo-locale is for spotting untranslated and overflowing UI: the dev server, Vitest and the e2e build.
      pseudo = options.pseudo === true || command === "serve" || process.env.VITE_E2E === "1";
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
        return compileCatalog(code, numbered, LOCALES_DIR, options.prefix, options.prefix === undefined);
      }
    },
    transform(code, id) {
      if (id.startsWith("\0") || id.includes("node_modules") || !/\.[cm]?[jt]sx?(?:\?|$)/.test(id)) return;
      // After TypeScript and JSX are compiled away (no enforce: "pre"): the calls are read from the module's syntax tree.
      const out = rewriteCalls(code, numbered, (message) => this.error(message), id);
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
