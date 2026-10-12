// The reply's shape for one request, as `responseConstraint`. Every field that names an existing element
// is an enum of the diagram's own names, so constrained decoding can't wander off inside a string (run 3:
// a rename's target looped "Payments service apart from that connection to …" until it ran out). Keys
// for new nodes follow a short pattern. Chrome doesn't document which schema keywords it supports, so
// there are three tiers, tried in order; a NotSupportedError moves to the next (see pipeline.ts).

import type { DiagramFile } from "../../model/types";
import type { ScopeItem } from "../ui/context";
import { COMPACT_OPS, MAX_OPS } from "./compactOps";

export const NAME_CHARS = 60;
export const SUMMARY_CHARS = 160;
export const KEY_CHARS = 30;
/** A new node's key: short, lower case. */
export const KEY_PATTERN = `^[a-z][a-z0-9_-]{0,${KEY_CHARS - 1}}$`;
/** The most names an enum lists (a big diagram: the selection, its neighbours, what the request names first). */
export const ENUM_BUDGET = 120;

/** "rich": enums, anyOf and patterns; "enums": enums only; "plain": bounded strings only. */
export type SchemaTier = "rich" | "enums" | "plain";
export const SCHEMA_TIERS: readonly SchemaTier[] = ["rich", "enums", "plain"];

/** Each node by the name the prompt shows: its label, or its id where labels repeat. */
export function nodeNames(diagram: DiagramFile): Map<string, string> {
  const counts = new Map<string, number>();
  for (const n of diagram.nodes) counts.set(n.label.trim(), (counts.get(n.label.trim()) ?? 0) + 1);
  return new Map(
    diagram.nodes.map((n) => [n.id, n.label.trim() && counts.get(n.label.trim()) === 1 ? n.label.trim() : n.id]),
  );
}

const lower = (s: string) => s.toLowerCase();

/**
 * The names a reply may use for existing elements: nodes (the selection, its neighbours and those the
 * request names first, then the rest, up to ENUM_BUDGET) and the connections between them ("A -> B").
 */
export function elementNames(
  diagram: DiagramFile,
  request: string,
  scope: readonly ScopeItem[] = [],
): { nodes: string[]; edges: string[] } {
  const names = nodeNames(diagram);
  const focus = new Set(scope.map((s) => s.id));
  const near = new Set(focus);
  for (const e of diagram.edges) if (focus.has(e.from) || focus.has(e.to)) near.add(e.from).add(e.to);
  // Named in the request as a whole name ("Node 2" isn't in "Node 250").
  const named = (name: string) =>
    new RegExp(`(^|[^a-z0-9])${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(
      lower(request),
    );
  const rank = (id: string) => (focus.has(id) ? 0 : near.has(id) ? 1 : named(names.get(id) ?? "") ? 2 : 3);
  const ordered = [...diagram.nodes].sort((a, b) => rank(a.id) - rank(b.id)).slice(0, ENUM_BUDGET);
  const kept = new Set(ordered.map((n) => n.id));
  const edges = diagram.edges
    .filter((e) => kept.has(e.from) && kept.has(e.to))
    .map((e) => `${names.get(e.from)} -> ${names.get(e.to)}`)
    .slice(0, ENUM_BUDGET);
  return { nodes: ordered.map((n) => names.get(n.id)!), edges: [...new Set(edges)] };
}

/** The reply schema for this request, at this tier. */
export function replySchema(
  diagram: DiagramFile,
  request: string,
  scope: readonly ScopeItem[] = [],
  tier: SchemaTier = "rich",
): object {
  const { nodes, edges } = elementNames(diagram, request, scope);
  const self = scope.length === 1 ? ["this"] : [];
  const nodeEnum = [...nodes, ...self];
  const key =
    tier === "rich"
      ? { type: "string", pattern: KEY_PATTERN, maxLength: KEY_CHARS }
      : { type: "string", maxLength: KEY_CHARS };
  const free = { type: "string", maxLength: NAME_CHARS };
  // A target names an existing element only (rename, change_kind, remove). Nothing to name: a key.
  const names = [...nodeEnum, ...edges];
  const target =
    tier === "plain"
      ? { type: "string", maxLength: 2 * NAME_CHARS + 4 }
      : names.length
        ? { type: "string", enum: names }
        : key;
  // A connection's end: an existing node, or a new node's key (an enum alone can't allow keys).
  const end = tier === "rich" ? (nodeEnum.length ? { anyOf: [{ type: "string", enum: nodeEnum }, key] } : key) : free;
  return {
    type: "object",
    properties: {
      summary: { type: "string", maxLength: SUMMARY_CHARS },
      ops: {
        type: "array",
        minItems: 1,
        maxItems: MAX_OPS,
        ...(tier === "rich" ? { uniqueItems: true } : {}),
        items: {
          type: "object",
          properties: {
            op: { type: "string", enum: [...COMPACT_OPS] },
            key,
            kind: free,
            label: free,
            sublabel: free,
            from: end,
            to: end,
            flow: { type: "string", enum: ["message", "request"] },
            target,
          },
          required: ["op"],
          additionalProperties: false,
        },
      },
    },
    required: ["summary", "ops"],
    additionalProperties: false,
  };
}
