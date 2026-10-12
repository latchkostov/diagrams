// The on-device model's job, kept small: read a compact description of the diagram and the request, and
// answer with a few plain-word ops (add, connect, insert_between, rename, change_kind, remove). The
// reply goes through compactOps.ts (which forgives what small models get wrong) and the ops core
// (which resolves "Kafka topic" to a stencil, places new nodes and validates). The panel commits the
// result as one turn with Undo, exactly like an agent's change.

import type { DiagramFile } from "../../model/types";
import type { DiagramOp } from "../index";
import { getStencil } from "../../stencils/registry";
import { planTurn, type TurnPlan } from "../ui/apply";
import type { ScopeItem } from "../ui/context";
import { COMPACT_OPS, toOps } from "./compactOps";
import type { InitialPrompt, ModelSession } from "./promptApi";

export { MAX_OPS, toOps } from "./compactOps";

/** The diagram's description stays under this many characters (a small model's context is a few K tokens). */
export const CONTEXT_CHARS = 2400;

/**
 * The reply's shape, as `responseConstraint`: one flat op object (Chrome's subset may reject `oneOf`),
 * per-op required fields checked in code.
 */
export const REPLY_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    ops: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: [...COMPACT_OPS] },
          key: { type: "string" },
          kind: { type: "string" },
          label: { type: "string" },
          sublabel: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          flow: { type: "string", enum: ["message", "request"] },
          target: { type: "string" },
        },
        required: ["op"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "ops"],
  additionalProperties: false,
} as const;

export const SYSTEM_PROMPT = `You change architecture diagrams. Reply with JSON only: {"summary": "<one short sentence>", "ops": [...]}.
Ops:
- {"op":"add","key":"<short id>","kind":"<the technology in plain words: Kafka topic, Service Bus queue, PostgreSQL, Redis cache, Go service, Python service, Java service, Lambda, browser>","label":"<short name>"}
- {"op":"connect","from":"<label or key>","to":"<label or key>","flow":"message" or "request"}
- {"op":"insert_between","key":"<short id>","kind":"<plain words>","label":"<short name>","from":"<label>","to":"<label>"} (puts a new node on the connection from -> to)
- {"op":"rename","target":"<label>","label":"<new label>"}
- {"op":"change_kind","target":"<label>","kind":"<plain words>"} ("make X a Y": X keeps its label and connections)
- {"op":"remove","target":"<label>"} (a connection: "<from label> -> <to label>")
Rules:
- Give every added node a short key, and connect new nodes by their key.
- Name existing nodes by their exact label from the diagram. "this" is the selected node.
- Direction follows the data. "A calls / uses / writes to / sends to / publishes to / routes to / invokes / feeds B" goes from A to B. "A consumes / reads from / subscribes to / is fed by / is triggered by B" goes from B to A.
- flow is "message" for events and queues, "request" for HTTP, gRPC, SQL and cache calls.
- Change only what was asked, with as few ops as possible. Never write ids or coordinates.`;

// The examples use made-up names (Zephyr, Quill) that no real request names, so the model can't copy
// one into an answer (the leakage guard in pipeline.test.ts checks).
const EXAMPLE_DIAGRAM = `Diagram "Quill"
Nodes (label: kind):
- Quill gateway: Amazon API Gateway
- quill.jobs: Kafka Topic
- Quill worker: .NET Service
- Quill store: PostgreSQL
Connections:
- Quill gateway -> quill.jobs (message)
- quill.jobs -> Quill worker (message)
- Quill worker -> Quill store (request)`;

const answer = (summary: string, ops: object[]) => JSON.stringify({ summary, ops });

/** The system prompt and four short examples: a create with "reads from", two edits, a selection. */
export const INITIAL_PROMPTS: InitialPrompt[] = [
  { role: "system", content: SYSTEM_PROMPT },
  {
    role: "user",
    content: "Empty diagram.\n\nRequest: Zephyr reads events from a NATS subject and saves them to MySQL",
  },
  {
    role: "assistant",
    content: answer("Zephyr reads a NATS subject and writes to MySQL", [
      { op: "add", key: "zephyr-events", kind: "NATS subject", label: "zephyr.events" },
      { op: "add", key: "zephyr", kind: "Go service", label: "Zephyr" },
      { op: "add", key: "zephyr-db", kind: "MySQL", label: "Zephyr db" },
      { op: "connect", from: "zephyr-events", to: "zephyr", flow: "message" },
      { op: "connect", from: "zephyr", to: "zephyr-db", flow: "request" },
    ]),
  },
  {
    role: "user",
    content: `${EXAMPLE_DIAGRAM}\n\nRequest: Add a dead-letter queue after Quill worker and rename Quill store to Quill ledger`,
  },
  {
    role: "assistant",
    content: answer("Added a dead-letter queue after Quill worker and renamed Quill store", [
      { op: "add", key: "quill-dlq", kind: "dead-letter queue", label: "quill-dlq" },
      { op: "connect", from: "Quill worker", to: "quill-dlq", flow: "message" },
      { op: "rename", target: "Quill store", label: "Quill ledger" },
    ]),
  },
  {
    role: "user",
    content: `${EXAMPLE_DIAGRAM}\n\nRequest: Put a Redis cache between Quill worker and Quill store, and make Quill store a MongoDB`,
  },
  {
    role: "assistant",
    content: answer("Put a Redis cache in front of Quill store and made it MongoDB", [
      {
        op: "insert_between",
        key: "quill-cache",
        kind: "Redis cache",
        label: "Quill cache",
        from: "Quill worker",
        to: "Quill store",
      },
      { op: "change_kind", target: "Quill store", kind: "MongoDB" },
    ]),
  },
  {
    role: "user",
    content: `${EXAMPLE_DIAGRAM}\n\nthis = quill-worker "Quill worker"\n\nRequest: Add a retry queue after this`,
  },
  {
    role: "assistant",
    content: answer("Added a retry queue after Quill worker", [
      { op: "add", key: "quill-retry", kind: "queue", label: "quill-retry" },
      { op: "connect", from: "Quill worker", to: "quill-retry", flow: "message" },
    ]),
  },
];

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
  const counts = new Map<string, number>();
  for (const n of diagram.nodes) counts.set(n.label.trim(), (counts.get(n.label.trim()) ?? 0) + 1);
  const name = new Map(
    diagram.nodes.map((n) => [n.id, n.label.trim() && counts.get(n.label.trim()) === 1 ? n.label.trim() : n.id]),
  );
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
    }
  | { ok: false; error: string; attempts: number; tooBig?: boolean; output?: ModelOutput };

/** True for the abort a cancel causes (the caller says nothing then). */
export const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

/** A Prompt API failure worth one more try on a fresh session ("An unknown error occurred: kErrorUnknown"). */
export const isTransient = (err: unknown) =>
  err instanceof Error &&
  !isAbort(err) &&
  !["QuotaExceededError", "NotSupportedError", "SyntaxError", "NotAllowedError"].includes(err.name) &&
  (err.name === "UnknownError" || /kError|unknown error|generic failure|internal/i.test(err.message));

type Session = Pick<ModelSession, "prompt"> & { destroy?: () => void };

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
      let reply: string;
      try {
        const limit = AbortSignal.timeout(replyTimeoutMs);
        const both = signal ? AbortSignal.any([signal, limit]) : limit;
        reply = await withTimeout(
          current.prompt(input, { signal: both, responseConstraint: REPLY_SCHEMA }),
          replyTimeoutMs,
        );
      } catch (err) {
        if (signal?.aborted) throw err instanceof Error ? err : new DOMException("Aborted", "AbortError");
        if (isTimeout(err) || (isAbort(err) && !signal?.aborted)) {
          // Ran over: this session may still be busy, so go on with a fresh one if there is one.
          error = TIMED_OUT;
          if (!freshUsed) {
            if (!(await swapToFresh())) return { ok: false, error: TIMED_OUT, attempts: attempt };
            attempt--;
          }
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
        error = plan.ok
          ? "The ops didn't change anything."
          : `${plan.error.error}${plan.error.hint ? ` ${plan.error.hint}` : ""}${
              plan.error.candidates?.length
                ? ` Labels it could mean: ${plan.error.candidates.map((c) => JSON.stringify(c.label)).join(", ")}.`
                : ""
            }`;
      } else error = parsed.error;
      input = `That failed: ${error}\nReply again with the whole corrected JSON, using exact labels from the diagram and keys for new nodes.`;
    }
    return { ok: false, error, attempts: 2, ...(output ? { output } : {}) };
  } finally {
    replaced?.destroy?.();
  }
}
