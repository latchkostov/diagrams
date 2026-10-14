import { useSyncExternalStore, type ReactNode } from "react";
import type en from "./en";

// The i18n runtime: in the startup JavaScript, about 0.3 kB (a chunk of its own, shared by the entry and the lazy
// dialogs; ./start.ts is in the entry). Everything else is lazy: the language list, switching and the Language dialog
// (./load.ts), and each language's catalog (a chunk of its own). docs/I18N.md.
//
// Source code calls `t("file.new")`, type-checked against the English catalog (./en.ts). The build
// (scripts/i18n-plugin.ts) rewrites each call with the English inline, so the runtime carries no English catalog
// and no parser:
//   - a message without placeholders becomes a tagged template, t`New diagram`: the English is the lookup key;
//   - one with placeholders (or tags, or English that reads differently in two places) becomes
//     t(12, v=>…, values): a number for the lookup and the English compiled to a small function.
// The current language's catalog maps either key to its message; a missing one falls back to the English.

/** A compiled message: plain text, or a function of the arguments. */
export type Compiled = string | ((values: Record<string, unknown>) => unknown);
/** A language's compiled catalog: by English text, or by message number. */
export type Catalog = Record<string | number, Compiled>;

/** Where the person's choice is kept ("Browser default" removes it). Clear everything removes it with the rest. */
export const LOCALE_KEY = "diagrams.locale";

/**
 * The runtime's state. One object, so ./load.ts (lazy) can switch the language without the entry carrying the
 * code that does: `l` the language, `c` its catalog (none for English), `f` what re-renders when they change, `a`
 * relative times.
 */
export const state: {
  l: string;
  c?: Catalog;
  f: Set<() => void>;
  /** "5 min ago" in the language (./format.ts's formatAgo): set by ./load.ts with the catalog, none for English. */
  a?: (at: number, now?: number) => string;
} = { l: "en", f: new Set() };

/** The current language (a BCP 47 tag: "en", "de", "pt-BR"). */
export const getLocale = () => state.l;

const subscribe = (f: () => void) => {
  state.f.add(f);
  return () => void state.f.delete(f);
};

/** The current language, re-rendering the component when it changes. Call it in any component that shows text. */
export const useLocale = (): string => useSyncExternalStore(subscribe, getLocale);

// ------------------------------------------------------------------------------------------------ typed API

type Messages = typeof en;
export type MessageKey = keyof Messages;

/** The next `{` or `}` in a message, and what follows it. */
type Next<S extends string> = S extends `${infer A}{${infer B}`
  ? A extends `${string}}${infer A2}`
    ? ["}", `${A2}{${B}`]
    : ["{", B]
  : S extends `${string}}${infer B}`
    ? ["}", B]
    : ["", ""];
type Trim<S extends string> = S extends ` ${infer R}` ? Trim<R> : S extends `${infer R} ` ? Trim<R> : S;
type Kind<T extends string> = T extends "plural" | "selectordinal" | "number" ? "number" : "string";

/** Arguments of a message, as [name, kind] pairs: a small type-level reading of ICU-lite (./icu.ts). */
type Args<S extends string, Stack extends 0[] = [], Acc = never> =
  Next<S> extends ["{", infer R extends string]
    ? Head<R, Stack, Acc>
    : Next<S> extends ["}", infer R extends string]
      ? Stack extends [0, ...infer Up extends 0[]]
        ? Options<R, Up, Acc>
        : Args<R, Stack, Acc>
      : Acc;
/** Just inside `{`: `name}`, or `name, type, …`. */
type Head<S extends string, Stack extends 0[], Acc> = S extends `${infer X}}${infer After}`
  ? X extends `${string},${string}`
    ? S extends `${infer Name},${infer Rest}`
      ? Rest extends `${infer Type},${infer Opts}`
        ? Type extends `${string}}${string}`
          ? Args<After, Stack, Acc | [Trim<Name>, "number"]>
          : Options<Opts, Stack, Acc | [Trim<Name>, Kind<Trim<Type>>]>
        : Args<After, Stack, Acc | [Trim<Name>, "number"]>
      : never
    : Args<After, Stack, Acc | [Trim<X>, "arg"]>
  : Acc;
/** Between a choice's options: `one {…} other {…}}`. */
type Options<S extends string, Stack extends 0[], Acc> =
  Next<S> extends ["{", infer R extends string]
    ? Args<R, [0, ...Stack], Acc>
    : Next<S> extends ["}", infer R extends string]
      ? Args<R, Stack, Acc>
      : Acc;
type Tags<S extends string, Acc = never> = S extends `${string}<${infer T}>${infer R}`
  ? T extends `/${string}` | `${string} ${string}`
    ? Tags<R, Acc>
    : Tags<R, Acc | T>
  : Acc;

type Value<K, Rich> = K extends "number"
  ? number
  : K extends "string"
    ? string
    : Rich extends true
      ? ReactNode
      : string | number;
type Values<S extends string, Rich = false> = {
  [P in Args<S> as P extends [infer N extends string, string] ? N : never]: Value<
    // A plural argument may also appear as plain {count} to keep English's ungrouped numbers.
    // The numeric use still requires a number; the plain use must not widen it to string | number.
    P extends [infer N, infer K] ? ([N, "number"] extends Args<S> ? "number" : K) : never,
    Rich
  >;
} & (Rich extends true ? { [T in Tags<S>]: (chunks: ReactNode) => ReactNode } : unknown);
type ValuesOf<K extends MessageKey, Rich = false> = Values<Messages[K], Rich>;
/** No second argument for a message without placeholders; otherwise its values, checked. */
export type ArgList<K extends MessageKey> = [Args<Messages[K]>] extends [never] ? [] : [values: ValuesOf<K>];
/** Messages with tags, for tRich (./rich.ts). */
export type RichKey = { [K in MessageKey]: [Tags<Messages[K]>] extends [never] ? never : K }[MessageKey];
export type RichValues<K extends MessageKey> = ValuesOf<K, true>;
/** Messages without tags: what t and msg take (a message with tags needs its render functions, through tRich). */
export type PlainKey = Exclude<MessageKey, RichKey>;

/** A message in the current language. Re-renders need `useLocale()` in the component. */
export function t<K extends PlainKey>(key: K, ...values: ArgList<K>): string;
// What every call compiles to (t`English` or t(number, English, values)): the language's message, else the English.
export function t(key: number | TemplateStringsArray, english?: Compiled, values?: Record<string, unknown>): unknown {
  const m = typeof key == "object" ? (state.c?.[key[0]] ?? key[0]) : (state.c?.[key] ?? english!);
  return typeof m == "function" ? m(values!) : m;
}
type Raw = (key: number | TemplateStringsArray, english?: Compiled, values?: Record<string, unknown>) => never;

/**
 * A message to translate later, for tables built once (the shortcuts sheet's rows): `msg("shortcuts.undo")()`
 * gives it in the language of the moment.
 */
export const msg = ((key: number | TemplateStringsArray, english?: Compiled) => (values?: Record<string, unknown>) =>
  (t as unknown as Raw)(key, english, values)) as unknown as <K extends PlainKey>(
  key: K,
) => (...values: ArgList<K>) => string;
