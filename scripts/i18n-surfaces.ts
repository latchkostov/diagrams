import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type * as TS from "typescript";

// Which catalogs each module may render (docs/I18N.md, "Catalog loading boundaries"). A build check:
// scripts/i18n-plugin.ts runs it when building the app, and `pnpm i18n check` and src/i18n/surfaceKeys.test.ts too.
//
// A module declares readiness by calling the one readiness API with a literal list, `surfaceCatalogs([...])` or
// `useSurfaceCatalogs([...])` (src/i18n/surfaces.ts): the module and everything it imports, statically or with
// `import()`, render after those catalogs are in. A module reached on several paths gets only what every path
// declares, and startup (src/main.tsx) declares nothing. Every `t`, `msg` and `tRich` key in a module must be in core
// or in a catalog it is guaranteed. A key two surfaces share, or that startup modules render, belongs in core.
//
// So declare where the guarantee is true: in the module a loader returns after awaiting (planning/ui.ts), in a
// loader-only module (canvas/inspector/simulationLoaders.ts), or with the hook in a component that renders those
// catalogs' keys only once `ready` (ContextMenu's stencil search). Never in a module that renders the keys first.

export interface SourceModule {
  /** Keys passed to t, msg or tRich. */
  keys: string[];
  /** Catalogs this module's readiness calls declare. */
  declares: string[];
  /** Static runtime imports (resolved paths; type-only imports load nothing). */
  imports: string[];
  /** Dynamic import() targets (resolved paths). */
  dynamic: string[];
}

export interface SurfaceKeyViolation {
  file: string;
  key: string;
  bucket: string;
  /** What every path to the module guarantees, besides core. */
  ready: string[];
  /** A path from startup to the module on which nothing declares the key's catalog. */
  via: string[];
}

/** The app's startup module. */
export const APP_ENTRIES = ["src/main.tsx"];

const API = new Set(["t", "msg", "tRich"]);
const READY = new Set(["surfaceCatalogs", "useSurfaceCatalogs"]);
const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];
/** The i18n runtime defines the API; its own literals are not renders. */
const RUNTIME = /^src\/i18n\/(?:surfaces|useSurfaceCatalogs|load|core|index|rich|en)\.tsx?$/;
const SKIP = /(?:\.test\.tsx?|\.d\.ts)$|^src\/(?:examples\/private|test|static)(?:\/|$)/;

let typescript: typeof TS | undefined;
/** Loaded on first use: the dev server and Vitest load the plugin without running this check. */
const ts = () => (typescript ??= createRequire(import.meta.url)("typescript") as typeof TS);

function resolve(from: string, spec: string, exists: (file: string) => boolean): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  if (/\.tsx?$/.test(base) && exists(base)) return base;
  const stem = base.replace(/\.js$/, "");
  return EXTENSIONS.map((ext) => stem + ext).find(exists);
}

/** Reads one module's keys, readiness and imports. `file` is relative to the repo, with forward slashes. */
export function readModule(file: string, source: string, exists: (file: string) => boolean): SourceModule {
  const t = ts();
  const kind = file.endsWith(".tsx") ? t.ScriptKind.TSX : t.ScriptKind.TS;
  const sf = t.createSourceFile(file, source, t.ScriptTarget.Latest, false, kind);
  const out: SourceModule = { keys: [], declares: [], imports: [], dynamic: [] };
  const runtime = RUNTIME.test(file);
  const add = (list: string[], spec: TS.Node | undefined) => {
    const hit = spec && t.isStringLiteralLike(spec) ? resolve(file, spec.text, exists) : undefined;
    if (hit) list.push(hit);
  };
  const visit = (node: TS.Node) => {
    if (t.isImportDeclaration(node)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const typesOnly =
        clause &&
        (clause.isTypeOnly ||
          (!clause.name && named && t.isNamedImports(named) && named.elements.every((e) => e.isTypeOnly)));
      if (!typesOnly) add(out.imports, node.moduleSpecifier);
    } else if (t.isExportDeclaration(node) && node.moduleSpecifier) {
      const named = node.exportClause;
      const typesOnly =
        node.isTypeOnly || (named && t.isNamedExports(named) && named.elements.every((e) => e.isTypeOnly));
      if (!typesOnly) add(out.imports, node.moduleSpecifier);
    } else if (t.isCallExpression(node)) {
      const callee = node.expression;
      const [first] = node.arguments;
      if (callee.kind === t.SyntaxKind.ImportKeyword) add(out.dynamic, first);
      else if (!runtime && t.isIdentifier(callee) && API.has(callee.text) && first && t.isStringLiteralLike(first))
        out.keys.push(first.text);
      const name = t.isIdentifier(callee) ? callee.text : t.isPropertyAccessExpression(callee) ? callee.name.text : "";
      if (!runtime && READY.has(name) && first && t.isArrayLiteralExpression(first))
        for (const bucket of first.elements) if (t.isStringLiteralLike(bucket)) out.declares.push(bucket.text);
    }
    t.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Every app module under src/, read from disk. */
export function readSources(root: string): Map<string, SourceModule> {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (SKIP.test(rel)) continue;
      if (entry.isDirectory()) visit(rel);
      else if (/\.tsx?$/.test(entry.name)) files.push(rel);
    }
  };
  visit("src");
  const known = new Set(files);
  const exists = (file: string) => known.has(file);
  return new Map(files.map((file) => [file, readModule(file, fs.readFileSync(path.join(root, file), "utf8"), exists)]));
}

type Guarantee = Set<string> | "unknown";

/**
 * The keys a module can render before their catalog is ready: a must-analysis over the import graph. A module's
 * guarantee is its own declarations plus what all its importers guarantee; `entries` guarantee nothing.
 */
export function surfaceKeyViolations(
  modules: Map<string, SourceModule>,
  entries: string[],
  /** A key's catalog; undefined for a string that isn't a message key (a local `t`). */
  bucketOf: (key: string) => string | undefined,
): SurfaceKeyViolation[] {
  const reachable = new Map<string, SourceModule>();
  const stack = [...entries];
  for (let file = stack.pop(); file !== undefined; file = stack.pop()) {
    const m = modules.get(file);
    if (!m || reachable.has(file)) continue;
    reachable.set(file, m);
    stack.push(...m.imports, ...m.dynamic);
  }
  const importers = new Map<string, string[]>();
  for (const [file, m] of reachable)
    for (const next of [...m.imports, ...m.dynamic]) importers.set(next, [...(importers.get(next) ?? []), file]);
  const roots = new Set(entries);
  // Start from "unknown" (everything) and shrink to what every path guarantees.
  const ready = new Map<string, Guarantee>([...reachable.keys()].map((file) => [file, "unknown"]));
  for (let changed = true; changed;) {
    changed = false;
    for (const [file, m] of reachable) {
      let inherited: Guarantee = roots.has(file) ? new Set() : "unknown";
      for (const from of importers.get(file) ?? []) {
        const theirs = ready.get(from) ?? "unknown";
        if (theirs === "unknown") continue;
        inherited = inherited === "unknown" ? new Set(theirs) : new Set([...inherited].filter((b) => theirs.has(b)));
      }
      const next: Guarantee = inherited === "unknown" ? inherited : new Set([...inherited, ...m.declares]);
      const before = ready.get(file);
      if (next === "unknown" || (before !== "unknown" && before?.size === next.size)) continue;
      ready.set(file, next);
      changed = true;
    }
  }
  const lacks = (file: string, bucket: string) => {
    const guarantee = ready.get(file);
    return guarantee !== undefined && guarantee !== "unknown" && !guarantee.has(bucket);
  };
  /** One path to `file` that never declares `bucket`. */
  const unready = (file: string, bucket: string): string[] => {
    const via = [file];
    for (let at = file; !roots.has(at);) {
      const from = (importers.get(at) ?? []).find((f) => lacks(f, bucket) && !via.includes(f));
      if (!from) break;
      via.unshift(from);
      at = from;
    }
    return via;
  };
  const out: SurfaceKeyViolation[] = [];
  for (const file of [...reachable.keys()].sort()) {
    const guarantee = ready.get(file);
    const have = guarantee === undefined || guarantee === "unknown" ? [] : [...guarantee].sort();
    for (const key of new Set(reachable.get(file)?.keys)) {
      const bucket = bucketOf(key);
      if (bucket && bucket !== "core" && !have.includes(bucket))
        out.push({ file, key, bucket, ready: have, via: unready(file, bucket) });
    }
  }
  return out;
}

export function formatViolations(violations: SurfaceKeyViolation[]): string {
  return violations
    .map(
      (v) =>
        `${v.file}: "${v.key}" is in the ${v.bucket} catalog, which nothing declares on ${v.via.join(" > ")} ` +
        `(ready: core${v.ready.map((b) => `, ${b}`).join("")}). Declare it with surfaceCatalogs/useSurfaceCatalogs ` +
        `on that path, or move the key to core (docs/I18N.md).`,
    )
    .join("\n");
}
