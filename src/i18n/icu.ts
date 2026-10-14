// ICU-lite: the message syntax of the catalogs (src/i18n/en.ts, src/i18n/locales/*.json), a subset of ICU
// MessageFormat that translators and their tools already know. Build-time only: the Vite plugin
// (scripts/i18n-plugin.ts) parses every message here and compiles it to a plain string or a tiny function, so the
// app ships no parser. The validator (./validate.ts) and the tests use the same parser.
//
// Supported:
//   {name}                                  an argument (numbers are formatted for the language)
//   {n, number} / {n, number, percent}      a number, or a fraction as a percentage
//   {n, plural, =0 {…} one {# item} other {# items}}   plural forms; # is the number
//   {n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}
//   {kind, select, file {…} other {…}}      a choice by value
//   <b>…</b>                                a rich-text tag, rendered by the caller (tRich)
//   '{' '}' '<' and ''                      quoting, as in ICU: an apostrophe quotes only before a special
//                                           character, so "can't" needs nothing
//
// Not supported (the validator rejects them): offset:, date and time skeletons, nested tags with attributes.

import { helpersFor } from "./helpers";

export type Part =
  | { type: "text"; value: string }
  | { type: "arg"; name: string }
  | { type: "number"; name: string; style?: "percent" | "integer" }
  | { type: "plural"; name: string; ordinal: boolean; options: Record<string, Part[]> }
  | { type: "select"; name: string; options: Record<string, Part[]> }
  | { type: "pound" }
  | { type: "tag"; name: string; children: Part[] };

export class IcuError extends Error {}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const KEY = /^(=\d+|[A-Za-z_][A-Za-z0-9_-]*)$/;

/** Parses a message into parts. Throws an IcuError that says where and why. */
export function parse(message: string): Part[] {
  let i = 0;
  const fail = (why: string): never => {
    throw new IcuError(`${why} at ${i} in "${message}"`);
  };

  /** Text and placeholders up to `}` (inside a branch), `</` (inside a tag) or the end. */
  const parts = (inPlural: boolean, closing?: "}" | "tag"): Part[] => {
    const out: Part[] = [];
    let text = "";
    const flush = () => {
      if (text) out.push({ type: "text", value: text });
      text = "";
    };
    while (i < message.length) {
      const c = message[i];
      if (c === "'") {
        const next = message[i + 1];
        if (next === "'") {
          text += "'";
          i += 2;
          continue;
        }
        if (next === "{" || next === "}" || next === "<" || (inPlural && next === "#")) {
          // Quoted until the next lone apostrophe.
          i++;
          while (i < message.length) {
            if (message[i] === "'") {
              if (message[i + 1] === "'") {
                text += "'";
                i += 2;
                continue;
              }
              i++;
              break;
            }
            text += message[i++];
          }
          continue;
        }
        text += c;
        i++;
        continue;
      }
      if (c === "}") {
        if (closing === "}") {
          flush();
          i++;
          return out;
        }
        fail("Unexpected }");
      }
      if (c === "#" && inPlural) {
        flush();
        out.push({ type: "pound" });
        i++;
        continue;
      }
      if (c === "<") {
        const close = /^<\/([a-z][a-z0-9]*)>/.exec(message.slice(i));
        if (close) {
          if (closing === "tag") {
            flush();
            return out;
          }
          fail(`Unexpected </${close[1]}>`);
        }
        const open = /^<([a-z][a-z0-9]*)>/.exec(message.slice(i));
        if (open) {
          flush();
          i += open[0].length;
          const children = parts(inPlural, "tag");
          const end = `</${open[1]}>`;
          if (!message.startsWith(end, i)) fail(`Missing ${end}`);
          i += end.length;
          out.push({ type: "tag", name: open[1], children });
          continue;
        }
        text += c;
        i++;
        continue;
      }
      if (c === "{") {
        flush();
        i++;
        out.push(placeholder());
        continue;
      }
      text += c;
      i++;
    }
    if (closing === "}") fail("Missing }");
    if (closing === "tag") fail("Missing closing tag");
    flush();
    return out;
  };

  const skipSpace = () => {
    while (/\s/.test(message[i] ?? "")) i++;
  };
  const word = (): string => {
    skipSpace();
    const m = /^[^\s,{}]+/.exec(message.slice(i));
    if (!m) fail("Expected a name");
    i += m![0].length;
    skipSpace();
    return m![0];
  };

  const placeholder = (): Part => {
    const name = word();
    if (!NAME.test(name)) fail(`Bad argument name "${name}"`);
    if (message[i] === "}") {
      i++;
      return { type: "arg", name };
    }
    if (message[i] !== ",") fail("Expected , or }");
    i++;
    const kind = word();
    if (kind === "number") {
      if (message[i] === "}") {
        i++;
        return { type: "number", name };
      }
      if (message[i] !== ",") fail("Expected , or }");
      i++;
      const style = word();
      if (style !== "percent" && style !== "integer") fail(`Unsupported number style "${style}"`);
      if (message[i] !== "}") fail("Expected }");
      i++;
      return { type: "number", name, style: style as "percent" | "integer" };
    }
    if (kind !== "plural" && kind !== "selectordinal" && kind !== "select") fail(`Unsupported type "${kind}"`);
    if (message[i] !== ",") fail("Expected ,");
    i++;
    const options: Record<string, Part[]> = {};
    for (;;) {
      skipSpace();
      if (message[i] === "}") {
        i++;
        break;
      }
      const key = word();
      if (key.startsWith("offset:")) fail("offset: isn't supported");
      if (!KEY.test(key)) fail(`Bad option "${key}"`);
      if (options[key]) fail(`Option "${key}" twice`);
      if (message[i] !== "{") fail(`Expected { after "${key}"`);
      i++;
      options[key] = parts(kind !== "select", "}");
    }
    if (!options.other) fail(`"${name}" has no "other" option`);
    return kind === "select"
      ? { type: "select", name, options }
      : { type: "plural", name, ordinal: kind === "selectordinal", options };
  };

  const out = parts(false);
  return out;
}

/** Every argument a message reads, with how it's used. */
export function argsOf(parts: Part[], out = new Map<string, string>()): Map<string, string> {
  for (const p of parts) {
    if (p.type === "arg") out.set(p.name, out.get(p.name) ?? "arg");
    else if (p.type === "number") out.set(p.name, "number");
    else if (p.type === "plural") {
      out.set(p.name, p.ordinal ? "selectordinal" : "plural");
      for (const o of Object.values(p.options)) argsOf(o, out);
    } else if (p.type === "select") {
      out.set(p.name, "select");
      for (const o of Object.values(p.options)) argsOf(o, out);
    } else if (p.type === "tag") argsOf(p.children, out);
  }
  return out;
}

/** Every tag a message uses. */
export function tagsOf(parts: Part[], out = new Set<string>()): Set<string> {
  for (const p of parts) {
    if (p.type === "tag") {
      out.add(p.name);
      tagsOf(p.children, out);
    } else if (p.type === "plural" || p.type === "select") for (const o of Object.values(p.options)) tagsOf(o, out);
  }
  return out;
}

/** The plural and select parts, anywhere in the message. */
export function choicesOf(parts: Part[], out: Extract<Part, { options: unknown }>[] = []) {
  for (const p of parts) {
    if (p.type === "plural" || p.type === "select") {
      out.push(p);
      for (const o of Object.values(p.options)) choicesOf(o, out);
    } else if (p.type === "tag") choicesOf(p.children, out);
  }
  return out;
}

/** The message's plain text (every branch, without placeholders): for length and leftover-English checks. */
export function textOf(parts: Part[], branch: "other" | "all" = "other"): string {
  return parts
    .map((p) => {
      if (p.type === "text") return p.value;
      if (p.type === "tag") return textOf(p.children, branch);
      if (p.type === "plural" || p.type === "select")
        return branch === "all"
          ? Object.values(p.options)
              .map((o) => textOf(o, branch))
              .join(" ")
          : textOf(p.options.other, branch);
      return "";
    })
    .join("");
}

// ---------------------------------------------------------------------------------------------- compiling

/**
 * JavaScript source for a message: a string literal when it has no placeholders, else an arrow function of its
 * arguments, `v=>…`. A message with tags returns an array (text, and what the tags' render functions return) for
 * tRich.
 *
 * English (the source, inlined at every call site, so in the entry too) compiles to plain JavaScript with its plural
 * rule built in (1 is "one", the rest "other"), needing nothing at run time. Another language's messages call the
 * helpers `h` of their catalog module (./helpers.ts, made for that language by scripts/i18n-plugin.ts).
 */
export function compile(message: string | Part[], english = false): string {
  const parts = typeof message === "string" ? parse(message) : message;
  const rich = tagsOf(parts).size > 0;
  if (!rich && parts.every((p) => p.type === "text")) return JSON.stringify(textOf(parts));
  return `v=>${expr(parts, { rich, english })}`;
}

interface Mode {
  rich: boolean;
  english: boolean;
  /** Inside a plural branch: the number `#` stands for, and its value when the branch fixes it (=1, English one). */
  pound?: { name: string; fixed?: number };
}

const prop = (name: string) => `v.${name}`;
/** An English number: grouped as English writes it (1,234). */
const enNumber = (js: string) => `${js}.toLocaleString("en")`;

function expr(parts: Part[], mode: Mode): string {
  const items = parts.map((p) => item(p, mode));
  if (mode.rich) return items.length === 1 ? items[0] : `[${items.join(",")}]`;
  if (!items.length) return '""';
  // A string whatever the parts are: `a+" kept"` already is one, `a+b` (two numbers, or one alone) isn't.
  const text = (p?: Part) => p?.type === "text";
  return text(parts[0]) || text(parts[1]) ? items.join("+") : `""+${items.join("+")}`;
}

/** A branch for the helpers: text as it is, anything else a function they call only if it's picked. */
function thunk(parts: Part[], mode: Mode): string {
  if (!mode.rich && parts.every((p) => p.type === "text")) return JSON.stringify(textOf(parts));
  return `()=>${expr(parts, mode)}`;
}

function item(p: Part, mode: Mode): string {
  const { english } = mode;
  switch (p.type) {
    case "text":
      return JSON.stringify(p.value);
    case "arg":
      return english ? prop(p.name) : `h.n(${prop(p.name)})`;
    case "number":
      if (!english) return p.style === "percent" ? `h.n(${prop(p.name)},1)` : `h.n(${prop(p.name)})`;
      return p.style === "percent"
        ? `new Intl.NumberFormat("en",{style:"percent"}).format(${prop(p.name)})`
        : enNumber(prop(p.name));
    case "pound": {
      const pound = mode.pound;
      if (!pound) return JSON.stringify("#");
      if (pound.fixed !== undefined) return JSON.stringify(String(pound.fixed));
      return english ? enNumber(prop(pound.name)) : `h.n(${prop(pound.name)})`;
    }
    case "tag":
      return `v.${p.name}(${expr(p.children, { ...mode, rich: true })})`;
    case "select": {
      if (english) {
        const { other, ...rest } = p.options;
        return `(${Object.entries(rest)
          .map(([k, o]) => `${prop(p.name)}===${JSON.stringify(k)}?${expr(o, mode)}:`)
          .join("")}${expr(other, mode)})`;
      }
      const options = Object.entries(p.options).map(([k, o]) => `${JSON.stringify(k)}:${thunk(o, mode)}`);
      return `h.s(${prop(p.name)},{${options.join(",")}})`;
    }
    case "plural": {
      const x = prop(p.name);
      const inBranch = (key: string): Mode => ({
        ...mode,
        pound: {
          name: p.name,
          fixed: key.startsWith("=") ? Number(key.slice(1)) : english && !p.ordinal && key === "one" ? 1 : undefined,
        },
      });
      if (english && !p.ordinal) {
        // English cardinals: exact values first, then one (1), then other.
        const { other, one, ...exact } = p.options;
        const tests = Object.entries(exact).map(([k, o]) => `${x}===${Number(k.slice(1))}?${expr(o, inBranch(k))}:`);
        if (one) tests.push(`${x}===1?${expr(one, inBranch("one"))}:`);
        return `(${tests.join("")}${expr(other, inBranch("other"))})`;
      }
      const options = Object.entries(p.options).map(([k, o]) => `${JSON.stringify(k)}:${thunk(o, inBranch(k))}`);
      if (english)
        // English ordinals (rare): the language's own rule, inline.
        return `((f,k)=>(k=f["="+${x}]??f[k]??f.other,typeof k=="function"?k():k))({${options.join(",")}},new Intl.PluralRules("en",{type:"ordinal"}).select(${x}))`;
      return `h.p(${x},{${options.join(",")}}${p.ordinal ? ",1" : ""})`;
    }
  }
}

// ---------------------------------------------------------------------------------------------- interpreting

/** Formats a message the slow way (parse and walk): for tests and the validator. */
export function format(message: string, lang: string, values: Record<string, unknown> = {}): string {
  const h = helpersFor(lang);
  const walk = (parts: Part[], pound?: number): string =>
    parts
      .map((p): string => {
        switch (p.type) {
          case "text":
            return p.value;
          case "arg":
            return String(h.n(values[p.name]));
          case "number":
            return String(h.n(values[p.name], p.style === "percent" ? 1 : undefined));
          case "pound":
            return pound === undefined ? "#" : String(h.n(pound));
          case "tag":
            return walk(p.children, pound);
          case "plural": {
            const x = Number(values[p.name]);
            const forms = Object.fromEntries(Object.entries(p.options).map(([k, o]) => [k, () => walk(o, x)]));
            return String(h.p(x, forms, p.ordinal ? 1 : undefined));
          }
          case "select": {
            const forms = Object.fromEntries(Object.entries(p.options).map(([k, o]) => [k, () => walk(o, pound)]));
            return String(h.s(values[p.name], forms));
          }
        }
      })
      .join("");
  return walk(parse(message));
}
