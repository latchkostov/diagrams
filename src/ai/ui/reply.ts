// Reads what a chatbot pasted back: ops JSON (fenced or not, a bare array, `{ ops }`, one op) or a
// whole diagrams/v1 file. Pure: no DOM, no React, so it's unit-tested and shared by every front-end.

import type { DiagramOp, LayoutMode } from "../index";

export type ParsedReply =
  | { ok: true; kind: "ops"; ops: DiagramOp[]; layout?: LayoutMode }
  | { ok: true; kind: "file"; file: Record<string, unknown> }
  | { ok: false; error: string; hint: string };

const ASK_AGAIN = "Ask your AI to answer with one ```json block that holds an array of ops.";
const LAYOUTS: readonly LayoutMode[] = ["auto", "full", "none"];

/** Fenced code blocks, in order (``` or ~~~, any info string). */
function fencedBlocks(text: string): string[] {
  const out: string[] = [];
  const re = /(```|~~~)[^\n`]*\n([\s\S]*?)\1/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[2]);
  return out;
}

/** The outermost JSON-looking span: from the first `[` or `{` to the last matching closer. */
function jsonSpan(text: string): string | undefined {
  const start = text.search(/[[{]/);
  if (start < 0) return undefined;
  const close = text[start] === "[" ? "]" : "}";
  const end = text.lastIndexOf(close);
  return end > start ? text.slice(start, end + 1) : undefined;
}

/** Chatbots sometimes leave trailing commas or smart quotes around keys; forgive those, nothing more. */
function lenient(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

function parseJson(text: string): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(text) };
  } catch (err) {
    try {
      return { value: JSON.parse(lenient(text)) };
    } catch {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Is this a diagrams/v1 file (or close enough to one: nodes and edges arrays)? */
function isFile(v: Record<string, unknown>): boolean {
  return v.format === "diagrams/v1" || (Array.isArray(v.nodes) && !("op" in v));
}

type Classified = ParsedReply | null;

function classify(value: unknown): Classified {
  // A tool call wrapper: { name: "edit_diagram", arguments: { ops } } or { input: { ops } }.
  if (isObject(value) && !("ops" in value) && !("op" in value) && !isFile(value)) {
    const inner = value.arguments ?? value.input ?? value.parameters ?? value.args;
    if (isObject(inner)) return classify(inner);
    if (typeof inner === "string") {
      const parsed = parseJson(inner);
      if ("value" in parsed) return classify(parsed.value);
    }
  }
  if (isObject(value) && isFile(value)) return { ok: true, kind: "file", file: value };
  let ops: unknown;
  let layout: LayoutMode | undefined;
  if (Array.isArray(value)) ops = value;
  else if (isObject(value) && Array.isArray(value.ops)) {
    ops = value.ops;
    if (LAYOUTS.includes(value.layout as LayoutMode)) layout = value.layout as LayoutMode;
  } else if (isObject(value) && typeof value.op === "string") ops = [value];
  else return null;
  const list = ops as unknown[];
  if (!list.length) return { ok: false, error: "The reply has an empty list of ops.", hint: ASK_AGAIN };
  const bad = list.findIndex((o) => !isObject(o) || typeof o.op !== "string");
  if (bad >= 0)
    return {
      ok: false,
      error: `Item ${bad + 1} isn't an op: every item needs an "op" such as "add_node" or "connect".`,
      hint: ASK_AGAIN,
    };
  return { ok: true, kind: "ops", ops: list as DiagramOp[], ...(layout ? { layout } : {}) };
}

/**
 * Turns a pasted reply into ops or a file. Tries, in order: every fenced block (ops from several
 * blocks are joined), the whole text, then the outermost JSON span inside prose.
 */
export function parseReply(text: string): ParsedReply {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Paste your AI's reply first.", hint: ASK_AGAIN };

  let firstError: string | undefined;
  const attempt = (candidate: string): Classified => {
    const parsed = parseJson(candidate.trim());
    if ("error" in parsed) {
      firstError ??= parsed.error;
      return null;
    }
    return classify(parsed.value);
  };

  const blocks = fencedBlocks(trimmed);
  if (blocks.length) {
    const results = blocks.map(attempt).filter((r): r is ParsedReply => r !== null);
    const file = results.find((r) => r.ok && r.kind === "file");
    if (file) return file;
    const opsResults = results.filter((r): r is Extract<ParsedReply, { kind: "ops" }> => r.ok && r.kind === "ops");
    if (opsResults.length)
      return {
        ok: true,
        kind: "ops",
        ops: opsResults.flatMap((r) => r.ops),
        ...(opsResults.find((r) => r.layout) ? { layout: opsResults.find((r) => r.layout)!.layout } : {}),
      };
    const failed = results.find((r) => !r.ok);
    if (failed) return failed;
  }

  for (const candidate of [trimmed, jsonSpan(trimmed)]) {
    if (!candidate) continue;
    const r = attempt(candidate);
    if (r) return r;
  }

  if (firstError && /[[{]/.test(trimmed))
    return {
      ok: false,
      error: `The JSON in the reply couldn't be read (${firstError}).`,
      hint: "It may have been cut off. Ask your AI to send the whole JSON again, in one block.",
    };
  if (/[[{]/.test(trimmed))
    return {
      ok: false,
      error: "This JSON isn't a list of ops or a diagram file.",
      hint: ASK_AGAIN,
    };
  return { ok: false, error: "There's no JSON in the reply.", hint: ASK_AGAIN };
}
