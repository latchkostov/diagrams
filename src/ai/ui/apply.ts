// One AI panel turn: a parsed reply becomes the next diagram (or an error to show), plus what
// changed. Pure, so the dialog, its tests and any later front-end share it.

import type { DiagramFile, DiagramNode } from "../../model/types";
import { migrate, validateDiagram } from "../../interop/native";
import { DIAGRAM_FORMAT } from "../../model/types";
import { checkBudget } from "../validation";
import { diagramDiff, structuralText } from "../../model/diagramDiff";
import { getStencil, FALLBACK_STENCIL } from "../../stencils/registry";
import {
  applyOps,
  buildSimulation,
  fitGroupToContents,
  placeNew,
  ReferenceError,
  resolveKind,
  type AiError,
  type DiagramOp,
  type OpResult,
  type StencilResolution,
} from "../index";
import type { ParsedReply } from "./reply";
import type { TurnStep } from "../turn";

/** A stencil the app picked from the model's words, with how sure it was. */
export interface StencilChoice {
  nodeId: string;
  /** What the model asked for ("Postgres writer"). */
  kind: string;
  stencil: StencilResolution;
  /** Snapshot from this turn; a stale choice must never retarget a changed node. */
  node?: DiagramNode;
  stale?: boolean;
}

export type TurnPlan =
  | {
      ok: true;
      next: DiagramFile;
      hasChanges: boolean;
      summary: string;
      /** Ids of nodes, connections, boundaries and annotations that were added or changed. */
      changed: string[];
      /** Choices worth a second look (medium or low confidence, with alternatives). */
      choices: StencilChoice[];
      warnings: string[];
      /** The reply replaced the whole diagram (a full file). */
      replaced: boolean;
      /** The simulation a simulation reply added or replaced. */
      simulationId?: string;
    }
  | { ok: false; error: AiError };

export interface DiagramDiff {
  added: { nodes: number; edges: number; groups: number; annotations: number };
  removed: { nodes: number; edges: number; groups: number; annotations: number };
  updated: number;
  meta: boolean;
  changed: string[];
}

/** Presentation projection; structural application decisions use the model's hasChanges. */
export function diffDiagrams(before: DiagramFile, after: DiagramFile): DiagramDiff {
  const d = diagramDiff(before, after);
  const counts = (change: typeof d.added) => ({
    nodes: change.nodes.length,
    edges: change.edges.length,
    groups: change.groups.length,
    annotations: change.annotations.length,
  });
  return {
    added: counts(d.added),
    removed: counts(d.removed),
    updated: d.updated.count,
    meta: d.metaChanged,
    changed: [...d.added.ids, ...d.updated.ids],
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "+3 nodes, +2 connections, 1 changed": the words on the toast and in the turn history. */
export function summarize(diff: DiagramDiff): string {
  const parts: string[] = [];
  const { added: a, removed: r } = diff;
  if (a.nodes) parts.push(`+${plural(a.nodes, "node")}`);
  if (a.edges) parts.push(`+${plural(a.edges, "connection")}`);
  if (a.groups) parts.push(`+${plural(a.groups, "boundary", "boundaries")}`);
  if (a.annotations) parts.push(`+${plural(a.annotations, "note")}`);
  if (r.nodes) parts.push(`−${plural(r.nodes, "node")}`);
  if (r.edges) parts.push(`−${plural(r.edges, "connection")}`);
  if (r.groups) parts.push(`−${plural(r.groups, "boundary", "boundaries")}`);
  if (r.annotations) parts.push(`−${plural(r.annotations, "note")}`);
  if (diff.updated) parts.push(`${diff.updated} changed`);
  if (diff.meta && !parts.length) parts.push("title or direction changed");
  return parts.length ? parts.join(", ") : "no changes";
}

/** Choices the user may want to swap: anything the resolver wasn't sure of. */
export function choicesFrom(
  results: readonly OpResult[],
  ops: readonly { op: string; kind?: unknown }[],
): StencilChoice[] {
  const out: StencilChoice[] = [];
  for (const r of results) {
    if (r.op !== "add_node" || !r.id || !r.stencil) continue;
    if (r.stencil.confidence === "high") continue;
    const kind = ops[r.i]?.kind;
    out.push({ nodeId: r.id, kind: typeof kind === "string" ? kind : r.stencil.id, stencil: r.stencil });
  }
  return out;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * A diagrams/v1 file from a chatbot, which usually has no coordinates and may name kinds in plain
 * words ("Kafka topic") instead of stencil ids. Unknown stencils are resolved like add_node kinds.
 * Positions and boundary boxes the file gives are kept exactly: a file without any coordinates is
 * laid out, otherwise only the nodes without them are placed, and only boundaries without a box (or
 * that receive a placed node) are fitted around their members.
 */
export function fileToDiagram(
  file: Record<string, unknown>,
): { ok: true; diagram: DiagramFile; choices: StencilChoice[]; warnings: string[] } | { ok: false; error: string } {
  try {
    checkBudget(file);
    file = migrate({ ...file, ...(!Object.hasOwn(file, "format") ? { format: DIAGRAM_FORMAT } : {}) });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const choices: StencilChoice[] = [];
  const unplaced: string[] = [];
  const nodes = Array.isArray(file.nodes) ? file.nodes : [];
  const fixedNodes = nodes.map((raw, i) => {
    if (!raw || typeof raw !== "object") return raw;
    const n = { ...(raw as Record<string, unknown>) };
    if (typeof n.id !== "string" || !n.id) n.id = `n${i + 1}`;
    const wanted = typeof n.stencil === "string" ? n.stencil : typeof n.kind === "string" ? n.kind : "";
    delete n.kind;
    if (!wanted || getStencil(wanted) === FALLBACK_STENCIL) {
      const r = resolveKind(wanted || "service", typeof n.label === "string" ? n.label : undefined);
      n.stencil = r.id;
      if (r.confidence !== "high") choices.push({ nodeId: n.id as string, kind: wanted || "(none)", stencil: r });
    }
    if (!isNum(n.x) || !isNum(n.y)) {
      unplaced.push(n.id as string);
      n.x = 0;
      n.y = 0;
    }
    if (typeof n.label !== "string") n.label = typeof n.id === "string" ? n.id : "";
    return n;
  });
  const edges = (Array.isArray(file.edges) ? file.edges : []).map((raw, i) => {
    if (!raw || typeof raw !== "object") return raw;
    const e = { ...(raw as Record<string, unknown>) };
    if (typeof e.id !== "string" || !e.id) e.id = `e${i + 1}`;
    return e;
  });
  const unboxed: string[] = [];
  const groups = Array.isArray(file.groups)
    ? file.groups.map((raw) => {
        if (!raw || typeof raw !== "object") return raw;
        const g = { ...(raw as Record<string, unknown>) };
        const box = ["x", "y", "width", "height"];
        if (typeof g.id === "string" && box.some((k) => !isNum(g[k]))) unboxed.push(g.id);
        for (const k of box) if (!isNum(g[k])) g[k] = 0;
        return g;
      })
    : undefined;
  const result = validateDiagram({
    ...file,
    nodes: fixedNodes,
    edges,
    ...(groups ? { groups } : {}),
  });
  if (!result.ok) return { ok: false, error: result.error };
  let diagram = result.diagram;
  try {
    checkBudget(diagram);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  // A file's boundary membership is deliberate: every placed node is kept outside the boundaries it
  // doesn't name, unlike an added node, which joins its only neighbour's boundary.
  if (unplaced.length && unplaced.length === diagram.nodes.length)
    diagram = placeNew(diagram, unplaced, "full", [], unplaced);
  else if (unplaced.length) diagram = placeNew(diagram, unplaced, "incremental", unboxed, unplaced);
  else for (const id of unboxed) diagram = fitGroupToContents(diagram, id);
  try {
    checkBudget(diagram);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, diagram, choices, warnings: result.warnings };
}

/** Plans one turn against the current diagram. Nothing is applied here. */
export function planTurn(current: DiagramFile, reply: ParsedReply): TurnPlan {
  if (!reply.ok) return { ok: false, error: { i: -1, error: reply.error, hint: reply.hint } };
  if (reply.kind === "file") {
    const f = fileToDiagram(reply.file);
    if (!f.ok)
      return {
        ok: false,
        error: {
          i: -1,
          error: `The diagram file in the reply isn't valid: ${f.error}`,
          hint: "Ask for a JSON array of ops instead; they're checked one by one with clearer errors.",
        },
      };
    // A whole file replaces the diagram, simulations included (old ones would name missing nodes).
    const next = f.diagram;
    const diff = diffDiagrams(current, next);
    return {
      ok: true,
      next,
      hasChanges: diagramDiff(current, next).hasChanges,
      summary: `Replaced the diagram: ${plural(next.nodes.length, "node")}, ${plural(next.edges.length, "connection")}`,
      changed: diff.changed,
      choices: f.choices.map((c) => ({ ...c, node: next.nodes.find((n) => n.id === c.nodeId) })),
      warnings: f.warnings,
      replaced: true,
    };
  }
  if (reply.kind === "simulation") return planSimulation(current, reply.spec);
  const result = applyOps(current, reply.ops, reply.layout ? { layout: reply.layout } : {});
  if (!result.ok) return { ok: false, error: result.errors[0] ?? { i: -1, error: "The ops couldn't be applied." } };
  const diff = diffDiagrams(current, result.diagram);
  return {
    ok: true,
    next: result.diagram,
    hasChanges: diagramDiff(current, result.diagram).hasChanges,
    summary: result.summary,
    changed: diff.changed,
    choices: choicesFrom(result.results, reply.ops).map((c) => ({
      ...c,
      node: result.diagram.nodes.find((n) => n.id === c.nodeId),
    })),
    warnings: result.warnings,
    replaced: false,
  };
}

/**
 * Plans a whole turn: its steps in order, each on the result of the last (a pasted reply is one step;
 * a model's turn is its successful tool calls). One plan, so both paths record the same kind of turn.
 */
export function planSteps(current: DiagramFile, steps: readonly TurnStep[]): TurnPlan {
  let next = current;
  const plans: Extract<TurnPlan, { ok: true }>[] = [];
  for (const step of steps) {
    const plan = planTurn(next, { ok: true, ...step } as ParsedReply);
    if (!plan.ok) return plan;
    plans.push(plan);
    next = plan.next;
  }
  if (plans.length === 1) return plans[0];
  const d = diagramDiff(current, next);
  const simulationId = plans.find((p) => p.simulationId)?.simulationId;
  return {
    ok: true,
    next,
    hasChanges: d.hasChanges,
    summary: d.summary,
    changed: [...new Set(plans.flatMap((p) => p.changed))].filter(
      (id) => next.nodes.some((n) => n.id === id) || next.edges.some((e) => e.id === id) || d.added.ids.includes(id),
    ),
    choices: plans.flatMap((p) => p.choices),
    warnings: plans.flatMap((p) => p.warnings),
    replaced: plans.some((p) => p.replaced),
    ...(simulationId ? { simulationId } : {}),
  };
}

/** A simulation reply (live view): added, or replacing the one it names, through the same core as WebMCP. */
function planSimulation(current: DiagramFile, spec: Extract<ParsedReply, { kind: "simulation" }>["spec"]): TurnPlan {
  let sim;
  try {
    sim = buildSimulation(current, spec);
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof ReferenceError
          ? { i: -1, ref: error.ref, error: error.message, candidates: error.candidates, hint: error.hint }
          : { i: -1, error: error instanceof Error ? error.message : String(error) },
    };
  }
  const sims = current.simulations ?? [];
  const replaced = sims.some((s) => s.id === sim.id);
  const next = { ...current, simulations: replaced ? sims.map((s) => (s.id === sim.id ? sim : s)) : [...sims, sim] };
  return {
    ok: true,
    next,
    hasChanges: true,
    summary: `${replaced ? "Updated" : "Added"} simulation “${sim.title}”`,
    changed: [...new Set(sim.traffic.map((t) => t.node))],
    choices: [],
    warnings: [],
    replaced: false,
    simulationId: sim.id,
  };
}

/** One click on an alternative: the node takes that stencil (as its own undo step). */
export function choiceIsCurrent(current: DiagramFile, choice: StencilChoice): boolean {
  const node = current.nodes.find((n) => n.id === choice.nodeId);
  return !!node && !!choice.node && structuralText(node) === structuralText(choice.node);
}

export function swapStencil(current: DiagramFile, nodeId: string, stencilId: string, expected?: DiagramNode): TurnPlan {
  const node = current.nodes.find((n) => n.id === nodeId);
  if (!node || (expected && structuralText(node) !== structuralText(expected)))
    return {
      ok: false,
      error: { i: -1, error: "This stencil choice is stale: its node changed or was removed. Ask for a new turn." },
    };
  return planTurn(current, { ok: true, kind: "ops", ops: [{ op: "update", target: nodeId, kind: stencilId }] });
}

/** The reference an error is about, read from the core's message (`"billing" matches 2 elements.`). */
export function failedRef(message: string): string | undefined {
  const m = /^("(?:[^"\\]|\\.)*") matches|reference ("(?:[^"\\]|\\.)*")/.exec(message);
  const quoted = m?.[1] ?? m?.[2];
  if (!quoted) return undefined;
  try {
    return JSON.parse(quoted) as string;
  } catch {
    return undefined;
  }
}

const REF_FIELDS = ["from", "to", "target", "in", "near", "members", "targets"] as const;

/**
 * One click on a candidate: op `i` now names `id` wherever it used the reference that failed
 * (including one end of "A -> B"). Null when the op doesn't contain that reference.
 */
export function pickCandidate(ops: readonly DiagramOp[], i: number, ref: string, id: string): DiagramOp[] | null {
  const op = ops[i] as Record<string, unknown> | undefined;
  if (!op) return null;
  let hit = false;
  const swap = (v: unknown): unknown => {
    if (typeof v !== "string") return v;
    if (v === ref) {
      hit = true;
      return id;
    }
    if (v.includes("->")) {
      const parts = v.split("->").map((p) => p.trim());
      if (parts.includes(ref)) {
        hit = true;
        return parts.map((p) => (p === ref ? id : p)).join(" -> ");
      }
    }
    return v;
  };
  const next: Record<string, unknown> = { ...op };
  for (const f of REF_FIELDS) {
    if (!(f in next)) continue;
    next[f] = Array.isArray(next[f]) ? (next[f] as unknown[]).map(swap) : swap(next[f]);
  }
  if (!hit) return null;
  return ops.map((o, j) => (j === i ? (next as DiagramOp) : o));
}
