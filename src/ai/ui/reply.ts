// Reads what a chatbot pasted back: ops JSON (fenced or not, a bare array, `{ ops }`, one op) or a
// whole diagrams/v1 file. Pure: no DOM, no React, so it's unit-tested and shared by every front-end.

import { edit_diagramSchema, type DiagramOp, type LayoutMode } from "../index";
import { checkSchema } from "../validation";
import type { JsonSchema } from "../schemas";
import { exceedsDepth, LIMITS, tooLargeMessage } from "../../interop/native";

export type ParsedReply =
  | { ok: true; kind: "ops"; ops: DiagramOp[]; layout?: LayoutMode }
  | { ok: true; kind: "file"; file: Record<string, unknown> }
  | { ok: false; error: string; hint: string };

const ASK_AGAIN = "Ask your AI to answer with one ```json block that holds an array of ops.";
const LAYOUTS: readonly LayoutMode[] = ["auto", "full", "none"];

/** Fenced code blocks, in order (``` or ~~~, any info string). */
function fencedBlocks(text: string): { text: string; intended: boolean; closed: boolean }[] {
  const out: { text: string; intended: boolean; closed: boolean }[] = [];
  const opener = /^[ \t]*(```|~~~)([^\n]*)\n/gm;
  for (let open = opener.exec(text); open; open = opener.exec(text)) {
    const closer = new RegExp(`^[ \\t]*${open[1]}[ \\t]*(?:\\r?\\n|$)`, "gm");
    closer.lastIndex = opener.lastIndex;
    const close = closer.exec(text);
    const content = text.slice(opener.lastIndex, close?.index ?? text.length);
    out.push({ text: content, intended: /json|ops/i.test(open[2]) || /^[\s]*[[{]/.test(content), closed: !!close });
    if (!close) break;
    opener.lastIndex = closer.lastIndex;
  }
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
  // Iterative unwrapping also bounds wrappers whose payload is encoded as a JSON string.
  for (let depth = 0; ; depth++) {
    if (depth >= LIMITS.maxDepth || exceedsDepth(value))
      return { ok: false, error: "The reply exceeds the nesting limit.", hint: ASK_AGAIN };
    if (!isObject(value) || "ops" in value || "op" in value || isFile(value)) break;
    const inner = value.arguments ?? value.input ?? value.parameters ?? value.args;
    if (typeof inner === "string") {
      const parsed = parseJson(inner);
      if ("error" in parsed)
        return { ok: false, error: `The wrapper JSON couldn't be read (${parsed.error}).`, hint: ASK_AGAIN };
      value = parsed.value;
    } else if (isObject(inner) || Array.isArray(inner)) value = inner;
    else break;
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
  if (!list.length && layout !== "full")
    return { ok: false, error: "The reply has an empty list of ops.", hint: ASK_AGAIN };
  const bad = list.findIndex((o) => !isObject(o) || typeof o.op !== "string");
  if (bad >= 0)
    return {
      ok: false,
      error: `Item ${bad + 1} isn't an op: every item needs an "op" such as "add_node" or "connect".`,
      hint: ASK_AGAIN,
    };
  const opSchema = (edit_diagramSchema.properties as Record<string, { items: JsonSchema }>).ops.items;
  for (const [i, op] of list.entries()) {
    try {
      checkSchema(op, opSchema);
    } catch (error) {
      return {
        ok: false,
        error: `Item ${i + 1}: ${error instanceof Error ? error.message : String(error)}`,
        hint: ASK_AGAIN,
      };
    }
  }
  return { ok: true, kind: "ops", ops: list as DiagramOp[], ...(layout ? { layout } : {}) };
}

/**
 * Turns a pasted reply into ops or a file. Tries, in order: every fenced block (ops from several
 * blocks are joined), the whole text, then the outermost JSON span inside prose.
 */
export function parseReply(text: string): ParsedReply {
  if (text.length > LIMITS.maxTextChars) return { ok: false, error: tooLargeMessage(text.length), hint: ASK_AGAIN };
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
    const results: ParsedReply[] = [];
    for (const [i, block] of blocks.entries()) {
      if (!block.intended) continue;
      if (!block.closed)
        return {
          ok: false,
          error: `Block ${i + 1}: The JSON couldn't be read: this fenced block was cut off or is missing its closing fence.`,
          hint: ASK_AGAIN,
        };
      const parsed = parseJson(block.text.trim());
      const result = "value" in parsed ? classify(parsed.value) : null;
      if (!result || !result.ok)
        return {
          ok: false,
          error: `Block ${i + 1}: ${result && !result.ok ? result.error : "error" in parsed ? `The JSON couldn't be read (${parsed.error}).` : "This JSON isn't a list of ops or a diagram file."}`,
          hint: ASK_AGAIN,
        };
      results.push(result);
    }
    const files = results.filter((r) => r.ok && r.kind === "file");
    if (files.length) {
      if (results.length !== 1)
        return {
          ok: false,
          error: "Send one whole diagram file, or only operation blocks; mixing them would discard changes.",
          hint: ASK_AGAIN,
        };
      return files[0];
    }
    const opsResults = results.filter((r): r is Extract<ParsedReply, { kind: "ops" }> => r.ok && r.kind === "ops");
    if (opsResults.length) {
      const layouts = new Set(opsResults.map((r) => r.layout).filter((l) => l !== undefined));
      if (layouts.size > 1) return { ok: false, error: "The blocks request conflicting layouts.", hint: ASK_AGAIN };
      const layout = opsResults.find((r) => r.layout)?.layout;
      return { ok: true, kind: "ops", ops: opsResults.flatMap((r) => r.ops), ...(layout ? { layout } : {}) };
    }
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
