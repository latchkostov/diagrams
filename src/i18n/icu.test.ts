import { describe, expect, it } from "vitest";
import { argsOf, compile, format, IcuError, parse, tagsOf, textOf } from "./icu";
import { helpersFor } from "./helpers";
import { pseudoLocalize, pseudoText } from "./pseudo";

// ICU-lite (./icu.ts): the catalogs' message syntax, parsed and compiled at build time.

/** Runs a compiled message the way the app does: English standalone, another language with its helpers. */
function run(message: string, values: Record<string, unknown> = {}, lang = "en"): unknown {
  const source = compile(message, lang === "en");
  const fn = new Function("h", `return (${source});`)(helpersFor(lang)) as unknown;
  return typeof fn === "function" ? (fn as (v: Record<string, unknown>) => unknown)(values) : fn;
}

const COUNT = "{count, plural, one {# node} other {# nodes}}";

describe("parsing", () => {
  it("reads text, arguments, numbers, plurals, selects and tags", () => {
    const parts = parse("<b>Hi</b> {name}: {n, number} {count, plural, =0 {none} one {# item} other {# items}}");
    expect(argsOf(parts)).toEqual(
      new Map([
        ["name", "arg"],
        ["n", "number"],
        ["count", "plural"],
      ]),
    );
    expect([...tagsOf(parts)]).toEqual(["b"]);
    expect(textOf(parse(COUNT))).toBe(" nodes");
  });

  it("keeps apostrophes as text, quoting only before a special character", () => {
    expect(format("can't stop", "en")).toBe("can't stop");
    expect(format("Use '{' and '}' literally, it''s fine", "en")).toBe("Use { and } literally, it's fine");
    expect(format("'<b>' is a tag", "en")).toBe("<b> is a tag");
  });

  it("says where a message is broken", () => {
    for (const broken of [
      "{count, plural, one {# x}}",
      "{count, plural, other {# x}",
      "{a b}",
      "<b>open",
      "x}",
      "{n, date}",
      "{n, plural, offset:1 other {#}}",
    ])
      expect(() => parse(broken), broken).toThrow(IcuError);
  });
});

describe("compiling English (inline at call sites, no helpers)", () => {
  it("plain text is a string literal", () => {
    expect(compile("New diagram", true)).toBe('"New diagram"');
  });

  it("plurals use English's rule: exact values, then one for 1, then other; # is grouped", () => {
    expect(run(COUNT, { count: 1 })).toBe("1 node");
    expect(run(COUNT, { count: 0 })).toBe("0 nodes");
    expect(run(COUNT, { count: 1234 })).toBe("1,234 nodes");
    expect(run("{n, plural, =0 {No diagrams} one {One diagram} other {# diagrams}}", { n: 0 })).toBe("No diagrams");
    expect(run("{count, plural, other {All #}}", { count: 12 })).toBe("All 12");
    expect(compile(COUNT, true)).not.toContain("h.");
  });

  it("selects, ordinals, numbers and percentages", () => {
    const pick = "{kind, select, file {a file} link {a link} other {something}}";
    expect(run(pick, { kind: "link" })).toBe("a link");
    expect(run(pick, { kind: "zip" })).toBe("something");
    const nth = "{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}";
    expect([1, 2, 3, 4, 11, 22].map((n) => run(nth, { n }))).toEqual(["1st", "2nd", "3rd", "4th", "11th", "22nd"]);
    expect(run("{n, number, percent}", { n: 0.42 })).toBe("42%");
    expect(run("{n, number} msg/s", { n: 1200 })).toBe("1,200 msg/s");
  });

  it("two numbers side by side stay text, not a sum", () => {
    expect(run("{a}{b}", { a: 1, b: 2 })).toBe("12");
    expect(run("{a} of {b}", { a: 1, b: 2 })).toBe("1 of 2");
  });

  it("tags call the caller's render functions, with the words inside", () => {
    const out = run("<b>Public:</b> anyone {who}", { b: (c: unknown) => `[${String(c)}]`, who: "here" });
    expect(out).toEqual(["[Public:]", " anyone ", "here"]);
  });
});

describe("compiling other languages (helpers for the language)", () => {
  const PL = "{count, plural, one {# węzeł} few {# węzły} many {# węzłów} other {# węzła}}";
  it("Polish: one, few, many", () => {
    expect([1, 2, 5, 22, 25, 112].map((count) => run(PL, { count }, "pl"))).toEqual([
      "1 węzeł",
      "2 węzły",
      "5 węzłów",
      "22 węzły",
      "25 węzłów",
      "112 węzłów",
    ]);
  });

  it("Bulgarian: one and other, a space groups thousands", () => {
    const BG = "{count, plural, one {# възел} other {# възела}}";
    expect(run(BG, { count: 1 }, "bg")).toBe("1 възел");
    expect(run(BG, { count: 12345 }, "bg")).toMatch(/^12\s345 възела$/);
  });

  it("Arabic: all six forms, Western digits", () => {
    const AR = "{n, plural, zero {لا عقد} one {عقدة واحدة} two {عقدتان} few {# عقد} many {# عقدة} other {# عقدة.}}";
    expect([0, 1, 2, 3, 11, 100].map((n) => run(AR, { n }, "ar"))).toEqual([
      "لا عقد",
      "عقدة واحدة",
      "عقدتان",
      "3 عقد",
      "11 عقدة",
      "100 عقدة.",
    ]);
  });

  it("Czech and Russian", () => {
    const CS = "{n, plural, one {# uzel} few {# uzly} many {# uzlu} other {# uzlů}}";
    expect([1, 3, 5].map((n) => run(CS, { n }, "cs"))).toEqual(["1 uzel", "3 uzly", "5 uzlů"]);
    const RU = "{n, plural, one {# узел} few {# узла} many {# узлов} other {# узла}}";
    expect([1, 2, 5, 21].map((n) => run(RU, { n }, "ru"))).toEqual(["1 узел", "2 узла", "5 узлов", "21 узел"]);
  });

  it("formats numbers and percentages for the language", () => {
    expect(run("{n, number}", { n: 1234.5 }, "de")).toBe("1.234,5");
    expect(run("{n, number, percent}", { n: 0.42 }, "de")).toMatch(/^42\s%$/);
    expect(run("{n} x", { n: 1234567 }, "hi")).toBe("12,34,567 x");
  });

  it("compiles the same way format() reads", () => {
    for (const [message, values, lang] of [
      [COUNT, { count: 3 }, "en"],
      ["{count, plural, one {# Knoten} other {# Knoten}} · {ago}", { count: 1, ago: "jetzt" }, "de"],
    ] as const)
      expect(run(message, { ...values }, lang)).toBe(format(message, lang, { ...values }));
  });
});

describe("the pseudo-locale", () => {
  it("accents every letter, doubles vowels, pads to 40% longer and brackets each message", () => {
    expect(pseudoText("Save")).toBe("Šááṽéé");
    const source = compile(pseudoLocalize(parse(COUNT)));
    const fn = new Function("h", `return (${source});`)(helpersFor("en-XA")) as (v: object) => string;
    expect(fn({ count: 2 })).toBe("[2 ñóóðééš]");
    const sample = "Pick up where you left off, open an example, or start from a blank canvas.";
    const pseudo = textOf(pseudoLocalize(parse(sample)));
    expect(pseudo.startsWith("[Þííçķ úúþ")).toBe(true);
    expect(pseudo.endsWith("!]")).toBe(true);
    expect((pseudo.length - 2) / sample.length).toBeCloseTo(1.4, 1);
  });

  it("leaves placeholders and tags alone", () => {
    const parts = pseudoLocalize(parse("<b>Public:</b> {name}"));
    expect(argsOf(parts)).toEqual(new Map([["name", "arg"]]));
    expect([...tagsOf(parts)]).toEqual(["b"]);
  });
});
