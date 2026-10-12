// The on-device model's job, kept small: read a compact description of the diagram and the request, and
// answer with a few plain-word ops (what to add, connect, rename, change or remove, by label). The ops
// core does the rest: it resolves "Kafka topic" to a stencil, places new nodes, validates, and the panel
// commits the result as one turn with Undo, exactly like an agent's change.

import type { DiagramFile } from "../../model/types";
import type { DiagramOp } from "../index";
import { getStencil } from "../../stencils/registry";
import { planTurn, type TurnPlan } from "../ui/apply";
import { referenceText, type ScopeItem } from "../ui/context";
import type { InitialPrompt, ModelSession } from "./promptApi";

/** At most this many ops per reply (checked in code: hard limits in a schema make small models odd). */
export const MAX_OPS = 16;
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
          op: { type: "string", enum: ["add", "connect", "rename", "change", "remove"] },
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
- {"op":"add","kind":"<plain words: Kafka topic, queue, PostgreSQL, Redis cache, .NET service, Node.js service, Lambda, API gateway>","label":"<short name>"}
- {"op":"connect","from":"<label>","to":"<label>","flow":"message" or "request"} (message: events and queues; request: HTTP, gRPC, SQL)
- {"op":"rename","target":"<label>","label":"<new label>"}
- {"op":"change","target":"<label>","kind":"<plain words>"}
- {"op":"remove","target":"<label>"} (a connection: "<from label> -> <to label>")
Refer to nodes by their exact label in the diagram, or by the label of a node you add. Change only what was asked, with as few ops as possible. Never write ids or coordinates.`;

const EXAMPLE_DIAGRAM = `Diagram "Orders"
Nodes (label: kind):
- Orders API: Node.js Service
- orders.created: Kafka Topic
- billing-worker: .NET Service
- orders-db: PostgreSQL
Connections:
- Orders API -> orders.created (message)
- orders.created -> billing-worker (message)
- Orders API -> orders-db (request)`;

/** The system prompt and three short examples: a create, an edit by label, an insert between two nodes. */
export const INITIAL_PROMPTS: InitialPrompt[] = [
  { role: "system", content: SYSTEM_PROMPT },
  { role: "user", content: `Empty diagram.\n\nRequest: A browser calls a Python API that stores files in S3` },
  {
    role: "assistant",
    content: JSON.stringify({
      summary: "Added a browser, a Python API and S3",
      ops: [
        { op: "add", kind: "browser", label: "Web" },
        { op: "add", kind: "Python service", label: "API" },
        { op: "add", kind: "S3", label: "Files" },
        { op: "connect", from: "Web", to: "API", flow: "request" },
        { op: "connect", from: "API", to: "Files", flow: "request" },
      ],
    }),
  },
  {
    role: "user",
    content: `${EXAMPLE_DIAGRAM}\n\nRequest: Add a dead-letter queue after billing-worker and rename it to Billing`,
  },
  {
    role: "assistant",
    content: JSON.stringify({
      summary: "Added a dead-letter queue after billing-worker and renamed it Billing",
      ops: [
        { op: "add", kind: "dead-letter queue", label: "billing-dlq" },
        { op: "connect", from: "billing-worker", to: "billing-dlq", flow: "message" },
        { op: "rename", target: "billing-worker", label: "Billing" },
      ],
    }),
  },
  { role: "user", content: `${EXAMPLE_DIAGRAM}\n\nRequest: Put a Redis cache between Orders API and orders-db` },
  {
    role: "assistant",
    content: JSON.stringify({
      summary: "Put a Redis cache between Orders API and orders-db",
      ops: [
        { op: "add", kind: "Redis cache", label: "orders-cache" },
        { op: "remove", target: "Orders API -> orders-db" },
        { op: "connect", from: "Orders API", to: "orders-cache", flow: "request" },
        { op: "connect", from: "orders-cache", to: "orders-db", flow: "request" },
      ],
    }),
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

/** One request: the diagram, the selection (as Copy for AI names it), and the person's words. */
export function requestPrompt(diagram: DiagramFile, request: string, scope: readonly ScopeItem[] = []): string {
  const parts = [
    diagramContext(
      diagram,
      scope.map((s) => s.id),
    ),
  ];
  // Copy for AI's element lines, under a heading of their own.
  if (scope.length) parts.push(["Selected:", ...referenceText(diagram.title, scope).split("\n").slice(1)].join("\n"));
  parts.push(`Request: ${request.trim()}`);
  return parts.join("\n\n");
}

export interface CompactOp {
  op: "add" | "connect" | "rename" | "change" | "remove";
  kind?: string;
  label?: string;
  sublabel?: string;
  from?: string;
  to?: string;
  flow?: "message" | "request";
  target?: string;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** The model's reply as ops for the core, or what's wrong with it (fed back for one retry). */
export function toOps(reply: string): { ok: true; ops: DiagramOp[]; summary: string } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    return { ok: false, error: "The reply wasn't JSON." };
  }
  const body = parsed as { summary?: unknown; ops?: unknown };
  if (!body || !Array.isArray(body.ops)) return { ok: false, error: 'The reply needs an "ops" array.' };
  if (!body.ops.length) return { ok: false, error: "The reply has no ops." };
  if (body.ops.length > MAX_OPS) return { ok: false, error: `Use at most ${MAX_OPS} ops.` };
  const ops: DiagramOp[] = [];
  for (const [i, raw] of (body.ops as CompactOp[]).entries()) {
    const at = `Op ${i + 1} (${String(raw?.op)})`;
    const kind = text(raw?.kind);
    const label = text(raw?.label);
    const target = text(raw?.target);
    switch (raw?.op) {
      case "add":
        if (!kind || !label) return { ok: false, error: `${at} needs "kind" and "label".` };
        ops.push({ op: "add_node", kind, label, ...(text(raw.sublabel) ? { sublabel: text(raw.sublabel) } : {}) });
        break;
      case "connect": {
        const from = text(raw.from);
        const to = text(raw.to);
        if (!from || !to) return { ok: false, error: `${at} needs "from" and "to".` };
        ops.push({
          op: "connect",
          from,
          to,
          ...(raw.flow === "request"
            ? { kind: "sync" as const }
            : raw.flow === "message"
              ? { kind: "async" as const }
              : {}),
          ...(label ? { label } : {}),
        });
        break;
      }
      case "rename":
        if (!target || !label) return { ok: false, error: `${at} needs "target" and the new "label".` };
        ops.push({ op: "update", target, label });
        break;
      case "change":
        if (!target || !kind) return { ok: false, error: `${at} needs "target" and "kind".` };
        ops.push({ op: "update", target, kind, ...(text(raw.sublabel) ? { sublabel: text(raw.sublabel) } : {}) });
        break;
      case "remove":
        if (!target) return { ok: false, error: `${at} needs "target".` };
        ops.push({ op: "remove", targets: [target] });
        break;
      default:
        return { ok: false, error: `${at}: "op" must be add, connect, rename, change or remove.` };
    }
  }
  return { ok: true, ops, summary: text(body.summary)?.slice(0, 200) ?? "" };
}

export type OnDeviceStatus = "thinking" | "retrying" | "applying";

export type OnDeviceResult =
  | { ok: true; plan: Extract<TurnPlan, { ok: true }>; summary: string; attempts: number; ops: DiagramOp[] }
  | { ok: false; error: string; attempts: number; tooBig?: boolean };

/** True for the abort a cancel causes (the caller says nothing then). */
export const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

/**
 * Asks the model, checks the reply against the ops core, and on failure asks once more with the error.
 * Applies nothing: the caller commits `plan` (one turn, one undo step). Throws only an AbortError.
 */
export async function runOnDevice({
  session,
  diagram,
  request,
  scope = [],
  signal,
  onStatus,
}: {
  /** A fresh session per request (a clone of the primed one): retries share its context. */
  session: Pick<ModelSession, "prompt">;
  diagram: DiagramFile;
  request: string;
  scope?: readonly ScopeItem[];
  signal?: AbortSignal;
  onStatus?: (s: OnDeviceStatus) => void;
}): Promise<OnDeviceResult> {
  let input = requestPrompt(diagram, request, scope);
  let error = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    onStatus?.(attempt === 1 ? "thinking" : "retrying");
    let reply: string;
    try {
      reply = await session.prompt(input, { signal, responseConstraint: REPLY_SCHEMA });
    } catch (err) {
      if (isAbort(err) || signal?.aborted) throw err instanceof Error ? err : new DOMException("Aborted", "AbortError");
      if (err instanceof DOMException && err.name === "QuotaExceededError")
        return {
          ok: false,
          error: "This diagram is too big for the on-device model.",
          attempts: attempt,
          tooBig: true,
        };
      // The model never answered this prompt: ask the same again.
      error = err instanceof Error ? err.message : String(err);
      continue;
    }
    signal?.throwIfAborted();
    const parsed = toOps(reply);
    if (parsed.ok) {
      onStatus?.("applying");
      const plan = planTurn(diagram, { ok: true, kind: "ops", ops: parsed.ops });
      if (plan.ok && plan.hasChanges)
        return { ok: true, plan, summary: parsed.summary, attempts: attempt, ops: parsed.ops };
      error = plan.ok
        ? "The ops didn't change anything."
        : `${plan.error.error}${plan.error.hint ? ` ${plan.error.hint}` : ""}${
            plan.error.candidates?.length
              ? ` Labels it could mean: ${plan.error.candidates.map((c) => JSON.stringify(c.label)).join(", ")}.`
              : ""
          }`;
    } else error = parsed.error;
    input = `That failed: ${error}\nReply again with the whole corrected JSON, using exact labels from the diagram.`;
  }
  return { ok: false, error, attempts: 2 };
}
