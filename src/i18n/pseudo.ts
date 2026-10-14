import { textOf, type Part } from "./icu";

// The pseudo-locale, en-XA (Android's name for it): English with every letter accented, every vowel doubled and
// padded with "!" to 40% longer (like German or Finnish), each message in brackets. It shows at a glance what isn't translated
// (plain English), what overflows (a cut-off bracket) and what is glued together from pieces (brackets mid-line).
// Made from English by the build (scripts/i18n-plugin.ts), offered in the dev server and the e2e build only.

export const PSEUDO_LOCALE = "en-XA";

const PLAIN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ACCENTED = "áƀçðéƒĝĥíĵķļɱñóþǫŕšţúṽŵẋýžÁƁÇÐÉƑĜĤÍĴĶĻṀÑÓÞǪŔŠŢÚṼŴẊÝŽ";
const MAP = new Map([...PLAIN].map((c, i) => [c, [...ACCENTED][i]]));

/** One stretch of text, accented and lengthened. */
export function pseudoText(text: string): string {
  return [...text].map((c) => (/[aeiouAEIOU]/.test(c) ? MAP.get(c)!.repeat(2) : (MAP.get(c) ?? c))).join("");
}

/** A message's parts, pseudo-localized: text only, never a placeholder's name or a tag. */
export function pseudoLocalize(parts: Part[], outer = true): Part[] {
  const walk = (list: Part[]): Part[] =>
    list.map((p) => {
      if (p.type === "text") return { ...p, value: pseudoText(p.value) };
      if (p.type === "tag") return { ...p, children: walk(p.children) };
      if (p.type === "plural" || p.type === "select")
        return { ...p, options: Object.fromEntries(Object.entries(p.options).map(([k, o]) => [k, walk(o)])) };
      return p;
    });
  const out = walk(parts);
  if (!outer) return out;
  // Padding to 40% longer than English, as Microsoft's pseudo-localization does ("!!!").
  const pad = Math.max(0, Math.ceil(textOf(parts).length * 1.4) - textOf(out).length);
  return [
    { type: "text", value: "[" },
    ...out,
    { type: "text", value: `${pad > 1 ? ` ${"!".repeat(pad - 1)}` : ""}]` },
  ];
}
