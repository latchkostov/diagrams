import { createElement, Fragment, type ReactNode } from "react";
import { t, type Compiled, type RichKey, type RichValues } from "./index";

// Messages with tags ("<b>Public:</b> anyone with the link can open it."): the words stay one message, so a
// language can move the bold part where its grammar needs it, and the caller renders each tag. Kept out of
// ./index.ts so the entry doesn't carry it.

const raw = t as unknown as (id: number, english: Compiled, values: Record<string, unknown>) => unknown;

/** A message with tags, as React nodes: `tRich("share.linkDesc", { b: (c) => <strong>{c}</strong> })`. */
export const tRich = ((id: number, english: Compiled, values: Record<string, unknown>) =>
  createElement(Fragment, null, ...([] as ReactNode[]).concat(raw(id, english, values) as ReactNode))) as unknown as <
  K extends RichKey,
>(
  key: K,
  values: RichValues<K>,
) => ReactNode;
