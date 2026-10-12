// The on-device model's eval gate: requests run through the same prompt, schema and ops core as the AI
// panel's box, each scored on what the diagram looks like afterwards. It needs a real Chrome with the
// built-in model, so it runs by hand in the Lab (?view=lab&preset=ondevice-evals), never in CI. The
// rate decides whether the box ships on by default (src/ai/ondevice/onDevicePref.ts).

import type { DiagramFile } from "../../model/types";
import { validateDiagram } from "../../interop/native";
import { getStencil } from "../../stencils/registry";
import kafka from "../../examples/kafka-order-pipeline.json";
import { runOnDevice } from "../ondevice/pipeline";
import type { ModelSession } from "../ondevice/promptApi";
import type { ScopeItem } from "../ui/context";
import { diagramEvals } from "./corpus";
import { checkGraph } from "./graphCheck";

export interface OnDeviceCase {
  id: string;
  request: string;
  start: DiagramFile;
  scope?: ScopeItem[];
  /** Why the diagram afterwards fails the case, or null when it passes. */
  check: (before: DiagramFile, after: DiagramFile) => string | null;
}

const EMPTY: DiagramFile = { format: "diagrams/v1", title: "Eval", nodes: [], edges: [] };
const KAFKA = kafka as unknown as DiagramFile;

const added = (before: DiagramFile, after: DiagramFile) =>
  after.nodes.filter((n) => !before.nodes.some((b) => b.id === n.id));
const hasEdge = (d: DiagramFile, from: string, to: string) => d.edges.some((e) => e.from === from && e.to === to);
const node = (d: DiagramFile, id: string) => d.nodes.find((n) => n.id === id);

/** A new node of one of these categories or stencils, connected from `from` (or to `to`). */
function addedNear(
  before: DiagramFile,
  after: DiagramFile,
  ok: (stencil: string) => boolean,
  opts: { from?: string; to?: string },
): string | null {
  const fresh = added(before, after).filter((n) => ok(n.stencil));
  if (!fresh.length)
    return `no new node of the right kind (added: ${
      added(before, after)
        .map((n) => n.stencil)
        .join(", ") || "none"
    })`;
  const linked = fresh.some(
    (n) => (!opts.from || hasEdge(after, opts.from, n.id)) && (!opts.to || hasEdge(after, n.id, opts.to)),
  );
  return linked ? null : "the new node isn't connected where asked";
}

/** A queue, topic or stream, whatever the vendor (generic.queue's category is "generic"). */
const messaging = (s: string) => ["queue", "topic", "stream"].includes(getStencil(s).simRole);

/** Editing requests on the Kafka example (the panel's main use), plus one with a selection. */
const editCases: OnDeviceCase[] = [
  {
    id: "edit-dlq",
    request: "Add a dead-letter queue after Inventory service",
    start: KAFKA,
    check: (b, a) => addedNear(b, a, messaging, { from: "inventory" }),
  },
  {
    id: "edit-rename",
    request: "Rename Payments service to Billing service",
    start: KAFKA,
    check: (_b, a) =>
      node(a, "payments")?.label === "Billing service" ? null : `payments is "${node(a, "payments")?.label}"`,
  },
  {
    id: "edit-remove",
    request: "Remove Notification dedupe",
    start: KAFKA,
    check: (b, a) =>
      node(a, "notify-cache")
        ? "Notification dedupe is still there"
        : a.nodes.length === b.nodes.length - 1
          ? null
          : "removed more than asked",
  },
  {
    id: "edit-between",
    request: "Put a Redis cache between Order service and Orders database",
    start: KAFKA,
    check: (b, a) =>
      addedNear(b, a, (s) => s === "redis.cache" || s === "azure.redis", { from: "orders", to: "order-db" }) ??
      (hasEdge(a, "orders", "order-db") ? "the direct connection is still there" : null),
  },
  {
    id: "edit-connect",
    request: "Connect Payments service to Commerce metrics",
    start: KAFKA,
    check: (_b, a) =>
      hasEdge(a, "payments", "metrics") || hasEdge(a, "metrics", "payments") ? null : "no such connection",
  },
  {
    id: "edit-change",
    request: "Make Orders database a MongoDB",
    start: KAFKA,
    check: (_b, a) => (node(a, "order-db")?.stencil === "mongodb" ? null : `it's ${node(a, "order-db")?.stencil}`),
  },
  {
    id: "edit-email",
    request: "Notification service sends email through a new email service",
    start: KAFKA,
    check: (b, a) => addedNear(b, a, (s) => s === "generic.email" || s === "sendgrid", { from: "notifications" }),
  },
  {
    id: "edit-selection",
    request: "Add a retry queue after this",
    start: KAFKA,
    scope: [{ id: "payments", label: "Payments service", kind: "node" }],
    check: (b, a) => addedNear(b, a, messaging, { from: "payments" }),
  },
];

/** The corpus's one-turn descriptions, each drawn from an empty diagram, scored as a directed graph. */
const createCases: OnDeviceCase[] = diagramEvals
  .filter((e) => e.turns.length === 1)
  .map((e, i) => {
    const expected = e.turns[0].expected;
    return {
      id: `create-${i + 1}`,
      request: e.description,
      start: EMPTY,
      // Stencils matched one to one, and every connection between the right nodes, the right way round.
      check: (_b, a) => checkGraph(a, expected),
    };
  });

export const onDeviceCases: OnDeviceCase[] = [...editCases, ...createCases];

export interface CaseResult {
  id: string;
  request: string;
  pass: boolean;
  attempts: number;
  /** Why it failed; the model's summary when it passed. */
  note: string;
  ms: number;
}

/**
 * Runs the cases one by one, each in a fresh session from `newSession` (a clone of the primed one).
 * The diagram afterwards must pass the case's check and validate.
 */
export async function runOnDeviceEvals(
  newSession: () => Promise<Pick<ModelSession, "prompt"> & { destroy?: () => void }>,
  cases: readonly OnDeviceCase[] = onDeviceCases,
  onResult?: (r: CaseResult, done: number) => void,
  signal?: AbortSignal,
): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const c of cases) {
    signal?.throwIfAborted();
    const t0 = performance.now();
    const session = await newSession();
    let r: CaseResult;
    try {
      const out = await runOnDevice({ session, diagram: c.start, request: c.request, scope: c.scope, signal });
      if (!out.ok) r = { id: c.id, request: c.request, pass: false, attempts: out.attempts, note: out.error, ms: 0 };
      else {
        const why = c.check(c.start, out.plan.next) ?? (validateDiagram(out.plan.next).ok ? null : "invalid diagram");
        r = { id: c.id, request: c.request, pass: !why, attempts: out.attempts, note: why ?? out.summary, ms: 0 };
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      r = { id: c.id, request: c.request, pass: false, attempts: 0, note: String(err), ms: 0 };
    } finally {
      session.destroy?.();
    }
    r.ms = Math.round(performance.now() - t0);
    results.push(r);
    onResult?.(r, results.length);
  }
  return results;
}

/** The results as a Markdown table, for docs/research/on-device-model.md. */
export function resultsMarkdown(results: readonly CaseResult[], meta = ""): string {
  const passed = results.filter((r) => r.pass).length;
  const firstTry = results.filter((r) => r.pass && r.attempts === 1).length;
  const pct = (n: number) => `${results.length ? Math.round((n / results.length) * 100) : 0}%`;
  return [
    `Pass rate: **${passed}/${results.length} (${pct(passed)})**, ${firstTry} on the first try (${pct(firstTry)}).${meta ? ` ${meta}` : ""}`,
    "",
    "| Case | Request | Result | Tries | ms | Note |",
    "| --- | --- | --- | --- | --- | --- |",
    ...results.map(
      (r) =>
        `| ${r.id} | ${r.request.replace(/\|/g, "\\|")} | ${r.pass ? "pass" : "FAIL"} | ${r.attempts} | ${r.ms} | ${r.note.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`,
    ),
  ].join("\n");
}
