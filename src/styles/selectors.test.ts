import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { expect, it } from "vitest";

/** Top-level splits only: commas, combinators and compounds inside `:is()`/`:not()`/`:has()` stay whole. */
function splitTopLevel(text: string, at: (ch: string, i: number) => boolean): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (!depth && at(ch, i)) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Every style rule's selectors (at-rule preludes such as `@container` and `@media` are skipped). */
function selectors(css: string): string[] {
  const out: string[] = [];
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  let prelude = "";
  for (const ch of body) {
    if (ch === "{") {
      const head = prelude.trim();
      if (head && !head.startsWith("@") && !/^(from|to|\d[\d.]*%)(\s*,\s*(from|to|\d[\d.]*%))*$/.test(head))
        out.push(...splitTopLevel(head.replace(/\s+/g, " "), (c) => c === ","));
      prelude = "";
    } else if (ch === "}" || ch === ";") prelude = "";
    else prelude += ch;
  }
  return out;
}

/** The compounds of a selector, left to right. */
const compounds = (selector: string) =>
  splitTopLevel(selector.replace(/\s*([>+~])\s*/g, "$1"), (c) => c === " " || c === ">" || c === "+" || c === "~");

/**
 * A compound with a type, class, id or attribute of its own, or an `:is()`/`:where()` whose every argument
 * has one. Other functional pseudo-classes (`:not()`, `:has()`) never key a compound.
 */
function keyed(compound: string): boolean {
  const lists = [...compound.matchAll(/:(?:is|where)\(/g)].map((match) => {
    let depth = 1;
    let end = match.index + match[0].length;
    for (; end < compound.length && depth; end++) depth += compound[end] === "(" ? 1 : compound[end] === ")" ? -1 : 0;
    return compound.slice(match.index + match[0].length, end - 1);
  });
  if (lists.some((list) => splitTopLevel(list, (c) => c === ",").every((part) => compounds(part).every(keyed))))
    return true;
  let bare = compound;
  for (let prev = ""; prev !== bare;) {
    prev = bare;
    bare = bare.replace(/::?[\w-]+\([^()]*\)/g, "");
  }
  bare = bare.replace(/::?[\w-]+/g, "").replace(/\*/g, "");
  return bare.length > 0;
}

function stylesheets(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".css"))
    .map((file) => join(dir, file))
    .filter((file) => !relative("src", file).split(sep).join("/").startsWith("examples/private/"));
}

it("finds the selectors this guard reads", () => {
  const found = selectors(".a:has(.b) > :not(.c), .d { x: 1 } @container c (min-width: 1px) { .e { y: 2 } }");
  expect(found).toEqual([".a:has(.b) > :not(.c)", ".d", ".e"]);
  expect(compounds(".a .b:has(.c .d)>:not(.e)")).toEqual([".a", ".b:has(.c .d)", ":not(.e)"]);
  expect(keyed(":not(.insp-label)")).toBe(false);
  expect(keyed(":is(:not(.a))")).toBe(false);
  expect(keyed(".insp-note")).toBe(true);
  expect(keyed("label:not(.a)")).toBe(true);
  expect(keyed(":is([data-a], .b, c)")).toBe(true);
  expect(keyed(":is(.a, :not(.b))")).toBe(false);
});

/**
 * A `:has()` left of an unkeyed subject (`> :not(.x)`, `*`) is tested against every element in each
 * style recalc. One such inspector rule made typing a label on a 1,500-node canvas cost about four times
 * the main-thread CPU (tests/e2e/checks-ui.spec.ts, "typing a label does the same rendering work ...").
 * Key the subject (a class, type, id or attribute), or put a modifier class on the ancestor instead.
 */
it("never pairs a :has() with an unkeyed subject compound", () => {
  const offenders: string[] = [];
  for (const file of stylesheets("src"))
    for (const selector of selectors(readFileSync(file, "utf8"))) {
      const parts = compounds(selector);
      const subject = parts[parts.length - 1];
      if (parts.slice(0, -1).some((part) => part.includes(":has(")) && !keyed(subject))
        offenders.push(`${relative(".", file).split(sep).join("/")}: ${selector}`);
    }
  expect(offenders).toEqual([]);
});
