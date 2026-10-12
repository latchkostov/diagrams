// The on-device model's job, kept small: read a compact description of the diagram and the request, and
// answer with a few plain-word ops (add, connect, insert_between, rename, change_kind, remove). The
// reply goes through compactOps.ts (which forgives what small models get wrong) and the ops core
// (which resolves "Kafka topic" to a stencil, places new nodes and validates). The panel commits the
// result as one turn with Undo, exactly like an agent's change.

import type { DiagramFile } from "../../model/types";
import type { AiError, DiagramOp } from "../index";
import { getStencil } from "../../stencils/registry";
import { planTurn, type TurnPlan } from "../ui/apply";
import type { ScopeItem } from "../ui/context";
import { MAX_OPS, toOps } from "./compactOps";
import { completeFromRequest, incompleteness } from "./replyChecks";
import { nodeNames, replySchema, SCHEMA_TIERS, type SchemaTier } from "./replySchema";
import type { ModelSession } from "./promptApi";
import { INITIAL_PROMPTS, SYSTEM_PROMPT } from "./examples";

export { INITIAL_PROMPTS, SYSTEM_PROMPT };

export { MAX_OPS, toOps } from "./compactOps";

/** The diagram's description stays under this many characters (a small model's context is a few K tokens). */
export const CONTEXT_CHARS = 2400;

/** A whole reply never needs more: past this it's a runaway, cut off and retried (see askModel). */
export const MAX_REPLY_CHARS = 2400;

export { NAME_CHARS, SUMMARY_CHARS } from "./replySchema";

/** The plain tier of the reply schema: bounded strings, no enums (the fallback, and what tests check). */
export const REPLY_SCHEMA = replySchema(
  { format: "diagrams/v1", title: "", nodes: [], edges: [] },
  "",
  [],
  "plain",
) as {
  properties: {
    summary: { maxLength: number };
    ops: { maxItems: number; items: { properties: { op: { enum: string[] } } } };
  };
};

/**
 * The schema tier this browser accepts, learned per page: "typed" (each op type requiring its fields,
 * enums, anyOf, patterns) until a NotSupportedError says otherwise, then "rich" (round 3's schema),
 * "enums" and "plain".
 */
let schemaTier: SchemaTier = "typed";
/** For tests: start again from the richest tier. */
export function resetSchemaTier(tier: SchemaTier = "typed") {
  schemaTier = tier;
}
export const currentSchemaTier = () => schemaTier;
/** This request's schema at the page's tier; if building it fails, the plain one (never a broken request). */
function schemaFor(diagram: DiagramFile, request: string, scope: readonly ScopeItem[]): object {
  try {
    return replySchema(diagram, request, scope, schemaTier);
  } catch {
    return replySchema(diagram, request, scope, "plain");
  }
}

/** A schema this large isn't put into the model's context too (the prompt lists the names already). */
const OMIT_SCHEMA_CHARS = 2500;

/**
 * The diagram in a few lines a small model can read: each node by the name it should use (its label,
 * or its id when labels repeat) and kind, then the connections. A big diagram keeps the selection and
 * its neighbours first and says how much it left out.
 */
export function diagramContext(
  diagram: DiagramFile,
  focusIds: readonly string[] = [],
  maxChars = CONTEXT_CHARS,
): string {
  if (!diagram.nodes.length) return "Empty diagram.";
  const name = nodeNames(diagram);
  const focus = new Set(focusIds);
  const near = new Set(focus);
  for (const e of diagram.edges) if (focus.has(e.from) || focus.has(e.to)) near.add(e.from).add(e.to);
  const rank = (id: string) => (focus.has(id) ? 0 : near.has(id) ? 1 : 2);
  const nodes = [...diagram.nodes].sort((a, b) => rank(a.id) - rank(b.id));
  const header = `Diagram ${JSON.stringify(diagram.title)}`;
  let budget = maxChars - header.length - 60;
  const nodeLines: string[] = [];
  const shown = new Set<string>();
  for (const n of nodes) {
    const line = `- ${name.get(n.id)}: ${getStencil(n.stencil).label}${n.sublabel ? ` (${n.sublabel})` : ""}`;
    if (budget - line.length < 0) break;
    budget -= line.length + 1;
    nodeLines.push(line);
    shown.add(n.id);
  }
  const edgeLines: string[] = [];
  const edges = diagram.edges.filter((e) => shown.has(e.from) && shown.has(e.to));
  for (const e of edges) {
    const line = `- ${name.get(e.from)} -> ${name.get(e.to)} (${e.relation ? e.relation : e.kind === "sync" ? "request" : "message"})`;
    if (budget - line.length < 0) break;
    budget -= line.length + 1;
    edgeLines.push(line);
  }
  const hidden = diagram.nodes.length - nodeLines.length;
  const hiddenEdges = diagram.edges.length - edgeLines.length;
  return [
    header,
    "Nodes (label: kind):",
    ...nodeLines,
    ...(hidden ? [`(${hidden} more nodes not shown)`] : []),
    "Connections:",
    ...edgeLines,
    ...(hiddenEdges ? [`(${hiddenEdges} more connections not shown)`] : []),
  ].join("\n");
}

/** One request: the diagram, the selection (`this = <id> "<label>"`), and the person's words. */
export function requestPrompt(diagram: DiagramFile, request: string, scope: readonly ScopeItem[] = []): string {
  const parts = [
    diagramContext(
      diagram,
      scope.map((s) => s.id),
    ),
  ];
  if (scope.length === 1) parts.push(`this = ${scope[0].id} ${JSON.stringify(scope[0].label)}`);
  else if (scope.length > 1) parts.push(`these = ${scope.map((s) => `${s.id} ${JSON.stringify(s.label)}`).join(", ")}`);
  parts.push(`Request: ${request.trim()}`);
  return parts.join("\n\n");
}

export type OnDeviceStatus = "thinking" | "retrying" | "applying";

/** What the model answered, for the evals' "Model output" column. */
export interface ModelOutput {
  /** The last reply, as the model wrote it. */
  raw: string;
  /** The ops it became, after compactOps. */
  ops?: DiagramOp[];
}

export type OnDeviceResult =
  | {
      ok: true;
      plan: Extract<TurnPlan, { ok: true }>;
      summary: string;
      attempts: number;
      ops: DiagramOp[];
      output: ModelOutput;
      /** Completed from the request's words after the retry (completeFromRequest). */
      completed?: boolean;
    }
  | { ok: false; error: string; attempts: number; tooBig?: boolean; output?: ModelOutput };

/**
 * A plan's error as feedback for the retry. An unknown reference to something that isn't in the diagram
 * at all ("ECS workload", never added) says to add it; a near miss lists the labels it could mean.
 */
export function planError(e: AiError, diagram: DiagramFile): string {
  const unknown = e.ref !== undefined && /^Unknown reference/.test(e.error);
  const close = (e.candidates ?? []).filter((c) => {
    const words = (s: string) =>
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2);
    const mine = words(e.ref ?? "");
    return words(c.label).some((w) => mine.includes(w));
  });
  if (unknown && !close.length)
    return `${e.ref} isn't in the diagram. Add it with an add op (with a key), then connect it by that key.`;
  const could = unknown ? close : (e.candidates ?? []);
  return `${e.error}${e.hint ? ` ${e.hint}` : ""}${
    could.length && diagram.nodes.length
      ? ` Labels it could mean: ${could.map((c) => JSON.stringify(c.label)).join(", ")}.`
      : ""
  }`;
}

/** True for the abort a cancel causes (the caller says nothing then). */
export const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

/** A Prompt API failure worth one more try on a fresh session ("An unknown error occurred: kErrorUnknown"). */
export const isTransient = (err: unknown) =>
  err instanceof Error &&
  !isAbort(err) &&
  !["QuotaExceededError", "NotSupportedError", "SyntaxError", "NotAllowedError"].includes(err.name) &&
  (err.name === "UnknownError" || /kError|unknown error|generic failure|internal/i.test(err.message));

type Session = Pick<ModelSession, "prompt" | "promptStreaming"> & { destroy?: () => void };

/**
 * How long one reply (or one fresh session) may take. The built-in model can keep generating under a
 * response constraint and never finish; without a limit one such prompt hangs the request (and the evals).
 */
export const REPLY_TIMEOUT_MS = 30_000;

export const TIMED_OUT = "The model took too long to answer.";

/** `promise`, or a TimeoutError after `ms` (the work itself isn't cancelled; free what it returns late). */
export function withTimeout<T>(promise: Promise<T>, ms: number, onLate?: (value: T) => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let late = false;
  void promise.then((v) => late && onLate?.(v)).catch(() => undefined);
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        late = true;
        reject(new DOMException(TIMED_OUT, "TimeoutError"));
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const isTimeout = (err: unknown) => err instanceof DOMException && err.name === "TimeoutError";

/** A reply cut off for running past MAX_REPLY_CHARS; `partial` is what came before the cut. */
export class RunawayError extends Error {
  constructor(readonly partial: string) {
    super(`The reply ran on past ${MAX_REPLY_CHARS} characters.`);
    this.name = "RunawayError";
  }
}

/**
 * One reply. Streamed where the session can, so a runaway (the model generating under the constraint
 * until its context runs out) is cut off at MAX_REPLY_CHARS instead of minutes later.
 */
async function askModel(session: Session, input: string, signal: AbortSignal, schema: object): Promise<string> {
  const constraint = {
    responseConstraint: schema,
    ...(JSON.stringify(schema).length > OMIT_SCHEMA_CHARS ? { omitResponseConstraintInput: true } : {}),
  };
  if (!session.promptStreaming) return session.prompt(input, { signal, ...constraint });
  const cut = new AbortController();
  const both = AbortSignal.any([signal, cut.signal]);
  const reader = session.promptStreaming(input, { signal: both, ...constraint }).getReader();
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text;
      // Chunks are deltas; older Chrome sent the whole text so far each time.
      text = text && value.length > text.length && value.startsWith(text) ? value : text + value;
      if (text.length > MAX_REPLY_CHARS) {
        cut.abort();
        throw new RunawayError(text);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Asks the model, checks the reply against the ops core, and on failure asks once more with the error.
 * A transient Prompt API error is retried once on a fresh session from `freshSession`, without using up
 * that retry. Applies nothing: the caller commits `plan` (one turn, one undo step). Throws only an
 * AbortError.
 */
export async function runOnDevice({
  session,
  freshSession,
  diagram,
  request,
  scope = [],
  signal,
  onStatus,
  replyTimeoutMs = REPLY_TIMEOUT_MS,
}: {
  /** A fresh session per request (a clone of the primed one): retries share its context. */
  session: Session;
  /** Another fresh session, for one retry after a transient error (destroyed here when used). */
  freshSession?: () => Promise<Session>;
  diagram: DiagramFile;
  request: string;
  scope?: readonly ScopeItem[];
  signal?: AbortSignal;
  onStatus?: (s: OnDeviceStatus) => void;
  /** The limit for one reply; a reply that runs over is cancelled and counts as a transient failure. */
  replyTimeoutMs?: number;
}): Promise<OnDeviceResult> {
  const first = requestPrompt(diagram, request, scope);
  let input = first;
  let error = "";
  let output: ModelOutput | undefined;
  let current = session;
  // Assigned in swapToFresh too, so typed wide (not narrowed to null).
  let replaced = null as Session | null;
  let freshUsed = !freshSession;
  /** The last reply's ops when it was only incomplete (for the completion after the retry). */
  let partial: DiagramOp[] | undefined;
  /** Goes on in a fresh session (once per request); false when none arrived in time. */
  const swapToFresh = async (): Promise<boolean> => {
    freshUsed = true;
    replaced?.destroy?.();
    replaced = null;
    try {
      replaced = await withTimeout(freshSession!(), replyTimeoutMs, (s) => s.destroy?.());
    } catch (err) {
      if (signal?.aborted) throw err instanceof Error ? err : new DOMException("Aborted", "AbortError");
      return false;
    }
    current = replaced;
    input = first;
    return true;
  };
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      onStatus?.(attempt === 1 ? "thinking" : "retrying");
      partial = undefined;
      let reply: string;
      try {
        const limit = AbortSignal.timeout(replyTimeoutMs);
        const both = signal ? AbortSignal.any([signal, limit]) : limit;
        reply = await withTimeout(askModel(current, input, both, schemaFor(diagram, request, scope)), replyTimeoutMs);
      } catch (err) {
        if (signal?.aborted) throw err instanceof Error ? err : new DOMException("Aborted", "AbortError");
        if (err instanceof RunawayError) {
          // A runaway is the model's answer gone wrong, not a transient failure: the retry says so. An
          // aborted prompt leaves the session's history, so the retry carries the whole request again,
          // in a fresh session where there is one (the cut-off one may still be busy).
          error = err.message;
          output = { raw: `${err.partial.slice(0, 600)}…` };
          if (!freshUsed && !(await swapToFresh())) return { ok: false, error: TIMED_OUT, attempts: attempt };
          input = `${first}\n\nYour last reply ran on past ${MAX_REPLY_CHARS} characters. Reply with only the ops the request needs (at most ${MAX_OPS}), labels of a few words and a one-line summary.`;
          continue;
        }
        if (isTimeout(err) || (isAbort(err) && !signal?.aborted)) {
          // Ran over: this session may still be busy, so go on with a fresh one if there is one.
          error = TIMED_OUT;
          if (!freshUsed) {
            if (!(await swapToFresh())) return { ok: false, error: TIMED_OUT, attempts: attempt };
            attempt--;
          }
          continue;
        }
        if (err instanceof DOMException && err.name === "NotSupportedError" && schemaTier !== "plain") {
          // This browser doesn't take a keyword of the richer schema: the next tier, same attempt.
          schemaTier = SCHEMA_TIERS[SCHEMA_TIERS.indexOf(schemaTier) + 1];
          attempt--;
          continue;
        }
        if (err instanceof DOMException && err.name === "QuotaExceededError")
          return {
            ok: false,
            error: "This diagram is too big for the on-device model.",
            attempts: attempt,
            tooBig: true,
          };
        error = err instanceof Error ? err.message : String(err);
        if (!freshUsed && isTransient(err)) {
          // A fresh session and the request from the start; this doesn't count as the retry.
          if (!(await swapToFresh())) return { ok: false, error: TIMED_OUT, attempts: attempt };
          attempt--;
          continue;
        }
        // The model never answered this prompt: ask the same again.
        continue;
      }
      signal?.throwIfAborted();
      const parsed = toOps(reply, { diagram, scope, request });
      output = { raw: reply, ...(parsed.ok ? { ops: parsed.ops } : {}) };
      if (parsed.ok) {
        onStatus?.("applying");
        const plan = planTurn(diagram, { ok: true, kind: "ops", ops: parsed.ops });
        if (plan.ok && plan.hasChanges)
          return { ok: true, plan, summary: parsed.summary, attempts: attempt, ops: parsed.ops, output };
        error = plan.ok ? "The ops didn't change anything." : planError(plan.error, diagram);
      } else {
        error = parsed.error;
        partial = parsed.partial;
      }
      input = `That failed: ${error}\nReply again with the whole corrected JSON, using exact labels from the diagram and keys for new nodes.`;
    }
    // The retry still left a simple request incomplete: complete it from the request's own words.
    const completed = partial ? completeFromRequest(partial, request, diagram) : null;
    if (completed && !incompleteness(completed, request, diagram)) {
      const plan = planTurn(diagram, { ok: true, kind: "ops", ops: completed });
      if (plan.ok && plan.hasChanges)
        return {
          ok: true,
          plan,
          summary: "Completed from the request",
          attempts: 2,
          ops: completed,
          output: output ?? { raw: "" },
          completed: true,
        };
    }
    return { ok: false, error, attempts: 2, ...(output ? { output } : {}) };
  } finally {
    replaced?.destroy?.();
  }
}
