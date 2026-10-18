// Prove the concept split against the ordered rule fingerprints of the original stylesheet.
// No rule/declaration/condition may change. Reorders must commute on the app's element class sets.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import console from "node:console";
import ts from "typescript";

const digest = (value) => createHash("sha256").update(value).digest("hex");
function expand(file, files = new Set()) {
  assert(!files.has(file), `Duplicate or cyclic CSS import: ${file}`);
  files.add(file);
  return readFileSync(file, "utf8").replace(/^@import "([^"]+)";$/gm, (_, path) =>
    expand(resolve(dirname(file), path), files),
  );
}
function rules(css) {
  const list = [];
  let rule = "",
    quote = "",
    depth = 0,
    space = false;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      rule += c;
      if (c === "\\") rule += css[++i];
      else if (c === quote) quote = "";
      continue;
    }
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      assert(end !== -1, "Unclosed CSS comment");
      i = end + 1;
      space = true;
      continue;
    }
    if (/\s/.test(c)) {
      space = true;
      continue;
    }
    if (space && rule) rule += " ";
    space = false;
    rule += c;
    if (c === '"' || c === "'") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") {
      assert(depth > 0, "Unexpected closing CSS brace");
      depth--;
    }
    if (depth === 0 && (c === "}" || c === ";")) {
      list.push(rule);
      rule = "";
    }
  }
  assert(!quote && depth === 0 && !rule.trim(), "Incomplete CSS rule");
  return list;
}
const current = rules(expand(resolve(process.argv[2] ?? "src/styles/canvas.css")));
const baseline = readFileSync("scripts/canvas-css-baseline.txt", "utf8")
  .trim()
  .split(/\r?\n/)
  .filter((line) => !line.startsWith("#"));
const ids = current.map(digest);
assert.deepEqual([...ids].sort(), [...baseline].sort(), "CSS tokens or at-rule context changed");

// This audit models this app's authored JSX and RF's fixed DOM roles, rather than assuming classes
// from different concepts are disjoint. Template prefixes match every possible suffix in the CSS;
// conditional branches may coexist, forwarded className values are unioned, and states are ignored.
// Unknown selector relationships remain order-sensitive. This is not a general CSS optimizer.
const classes = new Set(current.flatMap((r) => [...r.matchAll(/\.([\w-]+)/g)].map((m) => m[1])));
const tags = new Map();
const elements = [];
const calls = new Map();
const values = (node) => {
  const literals = [];
  const visit = (n) => {
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n)
    )
      literals.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return new Set(
    literals.flatMap((s) =>
      (s.match(/[\w-]+/g) ?? []).flatMap((word) =>
        [...classes].filter((c) => c === word || (word.endsWith("-") && c.startsWith(word))),
      ),
    ),
  );
};
// Also works in the Linux gate's git archive, which deliberately has no .git directory.
function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    // No examples participate in the class graph. Do not traverse that directory.
    if (entry.isDirectory()) return entry.name === "examples" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.") ? [path] : [];
  });
}
const files = sourceFiles(resolve("src"));
const forwarded = new Set();
const sources = files
  .filter((file) => file.endsWith(".tsx"))
  .map((file) =>
    ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
  );
for (const source of sources) {
  const visit = (n) => {
    if (ts.isPropertyAssignment(n) && n.name.getText(source) === "className")
      for (const c of values(n.initializer)) forwarded.add(c);
    if (
      ts.isJsxAttribute(n) &&
      n.name.getText(source) === "className" &&
      n.initializer &&
      /^[A-Z]/.test(n.parent.parent.tagName.getText(source))
    )
      for (const c of values(n.initializer)) forwarded.add(c);
    ts.forEachChild(n, visit);
  };
  visit(source);
}
for (const source of sources) {
  const records = new Map();
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const attr = node.attributes.properties.find(
        (n) => ts.isJsxAttribute(n) && n.name.getText(source) === "className",
      );
      let set = attr?.initializer ? values(attr.initializer) : new Set();
      // A locally computed class list may be a variable or helper. Every string in its module is
      // a conservative superset. Forwarded className props include all authored call-site values.
      if (attr?.initializer && /^\{\w+\}$/.test(attr.initializer.getText(source)) && set.size === 0)
        set = values(source);
      if (attr?.initializer?.getText(source).includes("className")) for (const c of forwarded) set.add(c);

      if (tag === "Handle")
        for (const c of classes)
          if (
            c.startsWith("react-flow__handle") ||
            ["valid", "connectingto", "connectingfrom", "connecting"].includes(c)
          )
            set.add(c);
      if (tag === "NodeResizeControl")
        for (const c of classes)
          if (c.startsWith("react-flow__resize-control") || ["line", "handle"].includes(c)) set.add(c);
      const el = { tag: /^[a-z]/.test(tag) ? tag : "*", classes: set, parents: [], ast: node, source };
      elements.push(el);
      records.set(node, el);
      if (/^[A-Z]/.test(tag)) {
        const list = calls.get(tag) ?? [];
        list.push(el);
        calls.set(tag, list);
      }
      for (const c of set) {
        const t = tags.get(c) ?? new Set();
        t.add(el.tag);
        tags.set(c, t);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const el of records.values()) {
    let parent = el.ast.parent;
    while (parent) {
      if (ts.isJsxElement(parent) && parent.openingElement !== el.ast) {
        el.parents.push(records.get(parent.openingElement));
        break;
      }
      if (ts.isFunctionDeclaration(parent) && parent.name) {
        el.owner = parent.name.text;
        break;
      }
      if (ts.isVariableDeclaration(parent) && parent.initializer && ts.isIdentifier(parent.name)) {
        el.owner = parent.name.text;
        break;
      }
      parent = parent.parent;
    }
  }
}
for (const el of elements) if (el.owner) el.parents.push(...(calls.get(el.owner) ?? []));
// RF's fixed DOM roles (v12). Its state classes may coexist; its distinct wrappers cannot.
for (const root of calls.get("ReactFlow") ?? []) {
  root.classes.add("react-flow");
  root.classes.add("connecting");
  for (const name of classes)
    if (name.startsWith("react-flow__") && !name.startsWith("react-flow__handle")) {
      const set = new Set([
        name,
        "selected",
        "dragging",
        "draggable",
        "selection",
        "bottom",
        "left",
        "right",
        "line",
        "handle",
      ]);
      if (name.startsWith("react-flow__node-")) set.add("react-flow__node");
      if (["react-flow__controls", "react-flow__minimap", "react-flow__attribution"].includes(name))
        set.add("react-flow__panel");
      elements.push({ tag: name === "react-flow__controls-button" ? "button" : "div", classes: set, parents: [root] });
    }
}
// Keep separate component call paths: two Icon instances need not share a parent.
function paths(el, seen = new Set()) {
  if (seen.has(el)) return [[]];
  const next = new Set([...seen, el]);
  return el.parents.length ? el.parents.flatMap((p) => paths(p, next).map((path) => [p, ...path])) : [[]];
}
// image.ts creates this export-only subtree imperatively; it never enters the editor tree.
assert.match(readFileSync("src/interop/image.ts", "utf8"), /el.className = "export-header"/);
const exportHeader = { tag: "div", classes: new Set(["export-header"]), parents: [] };
elements.push(exportHeader);
for (const [, tag] of readFileSync("src/interop/image.ts", "utf8").matchAll(/document\.createElement\("(\w+)"\)/g))
  elements.push({ tag, classes: new Set(), parents: [exportHeader] });
// These legacy selectors have no authored class producer. Keep the rules, and verify that remains
// true rather than assuming a namespace can never occur on a future element.
const inactive = ["insp-meta", "insp-relation", "start-theme", "start-section"];
const produced = new Set(sources.flatMap((source) => [...values(source)]));
const imperativeSources = files.filter((file) => file.endsWith(".ts")).map((file) => readFileSync(file, "utf8"));
for (const name of inactive)
  assert(
    !produced.has(name) && imperativeSources.every((source) => !source.includes(name)),
    "New producer needs a cascade audit: " + name,
  );
const instances = elements.flatMap((el) => paths(el).map((path) => ({ el, path })));

function split(text, delimiter) {
  const parts = [];
  let start = 0,
    depth = 0,
    quote = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && delimiter.test(c)) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.filter((s) => s.trim());
}
function specificity(selector) {
  let score = 0;
  while (selector.includes("(")) {
    const begin = selector.indexOf("("),
      prefix = selector.slice(0, begin);
    const name = /:([\w-]+)$/.exec(prefix)?.[1];
    let end = begin + 1,
      depth = 1;
    for (; end < selector.length; end++) {
      if (selector[end] === "(") depth++;
      if (selector[end] === ")" && --depth === 0) break;
    }
    // Only these functional pseudo-classes occur in this frozen stylesheet.
    assert(["is", "not", "has", "where"].includes(name), "Unsupported selector function: " + name);
    score += name === "where" ? 0 : Math.max(...split(selector.slice(begin + 1, end), /,/).map(specificity));
    selector = prefix.replace(/:[\w-]+$/, "") + selector.slice(end + 1);
  }
  score += (selector.match(/#[\w-]+/g) ?? []).length * 100;
  score += (selector.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):(?!:)[\w-]+/g) ?? []).length * 10;
  selector = selector.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|(?<!:):(?!:)[\w-]+/g, "");
  return score + (selector.match(/::[\w-]+|(?:^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
}

function subject(selector) {
  const last = split(selector, /[\s>+~]/)
    .at(-1)
    .trim();
  // Functional subjects and unanchored subjects are deliberately unknown.
  const plain = last.replace(/:(?:has|not|is|where)\(.*\)/g, "");
  return {
    selector,
    specificity: specificity(selector),
    tag: /^[a-z][\w-]*/i.exec(plain)?.[0] ?? "",
    pseudo: /::[\w-]+/.exec(plain)?.[0] ?? "",
    classes: [...plain.matchAll(/\.([\w-]+)/g)]
      .map((m) => m[1])
      .filter((c) => !c.startsWith("is-") && !["selected", "dragging", "draggable"].includes(c)),
  };
}
const candidateCache = new Map();
function candidates(s) {
  if (candidateCache.has(s.selector)) return candidateCache.get(s.selector);
  const compounds = split(s.selector, /[\s>+~]/).map((p) => subject(p));
  const found = instances.filter(({ el, path }) => {
    const matches = (e, c) => (!c.tag || e.tag === "*" || c.tag === e.tag) && c.classes.every((k) => e.classes.has(k));
    return (
      matches(el, s) && compounds.slice(0, -1).every((c) => c.classes.length === 0 || path.some((p) => matches(p, c)))
    );
  });
  const broad = found.length
    ? found
    : instances.filter(
        ({ el }) => (!s.tag || el.tag === "*" || s.tag === el.tag) && s.classes.every((k) => el.classes.has(k)),
      );
  candidateCache.set(s.selector, broad);
  return broad;
}

function overlap(a, b) {
  // a is the later-original rule moving earlier: do not cross an equal/higher-specificity conflict.
  if (a.specificity > b.specificity) return false;
  const inactiveScope = (s) =>
    split(s.selector, /[\s>+~]/).some((p) => subject(p).classes.some((c) => inactive.includes(c)));
  if (inactiveScope(a) || inactiveScope(b)) return false;
  if (a.tag && b.tag && a.tag !== b.tag) return false;
  const hasTag = (s, tag) =>
    !tag || s.classes.every((c) => !tags.has(c) || tags.get(c).has("*") || tags.get(c).has(tag));
  if (!hasTag(a, b.tag) || !hasTag(b, a.tag)) return false;
  if (a.pseudo !== b.pseudo) return false;
  const ac = candidates(a),
    bc = candidates(b);
  if (ac.length && bc.length) return ac.some((el) => bc.includes(el));
  return true;
}
function family(p) {
  if (p.startsWith("--")) return p;
  if (/^(top|right|bottom|left|inset)/.test(p)) return "inset";
  if (/^(width|height|min-|max-|block-size|inline-size)/.test(p)) return "size";
  if (/^(align-|justify-|place-|flex|grid|gap$|row-gap$|column-gap$)/.test(p)) return "layout";
  if (/^(font|line-height$)/.test(p)) return "font";
  if (/^(white-space|text-wrap|word-wrap|overflow-wrap)/.test(p)) return "wrapping";
  return p.split("-")[0];
}
function parse(r) {
  if (/^@(media|container|supports)\b/.test(r)) return rules(r.slice(r.indexOf("{") + 1, -1)).flatMap(parse);
  if (r.startsWith("@")) return [];
  const properties = new Map();
  for (const m of r.matchAll(/(?:\{|;)\s*([\w-]+)\s*:\s*([^;}]+)/g)) {
    const key = family(m[1]),
      list = properties.get(key) ?? [];
    list.push({ declaration: m[1] + ":" + m[2].trim(), important: m[2].includes("!important") });
    properties.set(key, list);
  }
  return [{ subjects: split(r.split("{")[0], /,/).map(subject), properties }];
}
const keyframes = current.filter((r) => r.startsWith("@keyframes")).map((r) => r.split("{")[0]);
assert(new Set(keyframes).size === keyframes.length, "Duplicate keyframes require an order audit");
const parsed = current.map(parse);
const positions = new Map();
baseline.forEach((id, i) => {
  const q = positions.get(id) ?? [];
  q.push(i);
  positions.set(id, q);
});
const order = ids.map((id) => positions.get(id).shift());
const ambiguous = [];
for (let i = 0; i < order.length; i++)
  for (let j = i + 1; j < order.length; j++) {
    if (order[i] < order[j]) continue;
    if (
      parsed[i].some((a) =>
        parsed[j].some(
          (b) =>
            [...a.properties].some(([p, ad]) => {
              const bd = b.properties.get(p);
              return (
                bd &&
                JSON.stringify(ad) !== JSON.stringify(bd) &&
                ad.some((x) => bd.some((y) => x.important === y.important))
              );
            }) && a.subjects.some((x) => b.subjects.some((y) => overlap(x, y))),
        ),
      )
    )
      ambiguous.push([order[j], order[i], current[j].split("{")[0].trim(), current[i].split("{")[0].trim()]);
  }
assert.deepEqual(ambiguous, [], `Cannot prove reordered rules independent (${ambiguous.length} pairs)`);
console.log(`Canvas CSS: ${current.length} rules unchanged; all reordered rules independent.`);
