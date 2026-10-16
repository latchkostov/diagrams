import type { CanvasSnapshot } from "./useHistory";

/** Immutable records share nested values across projections. Only changed branches need comparing. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length && keys.every((k) => Object.hasOwn(right, k) && same(left[k], right[k]))
  );
}

/** Indexed once per projection, including large bulk selections. IDs are React Flow IDs. */
export function remoteTargetRemoved(
  current: CanvasSnapshot,
  next: CanvasSnapshot,
  focus: { inspector?: boolean; id?: string },
): boolean {
  const nodes = new Set(next.nodes.map((n) => n.id)),
    edges = new Set(next.edges.map((e) => e.id));
  if (focus.id) return !nodes.has(focus.id) && !edges.has(focus.id);
  return (
    !!focus.inspector &&
    (current.nodes.some((n) => n.selected && !nodes.has(n.id)) ||
      current.edges.some((e) => e.selected && !edges.has(e.id)))
  );
}

/** Keep local selection, measurements and unchanged record identities across a room projection. */
export function retainRemoteSelection(current: CanvasSnapshot, next: CanvasSnapshot): CanvasSnapshot {
  const nodes = new Map(current.nodes.map((n) => [n.id, n]));
  const edges = new Map(current.edges.map((e) => [e.id, e]));
  return {
    meta: same(current.meta, next.meta) ? current.meta : next.meta,
    nodes: next.nodes.map((n) => {
      const old = nodes.get(n.id);
      if (!old) return n;
      if (
        old.type === n.type &&
        old.parentId === n.parentId &&
        old.width === n.width &&
        old.height === n.height &&
        same(old.data, n.data) &&
        old.position.x === n.position.x &&
        old.position.y === n.position.y
      )
        return old;
      return { ...n, selected: old.selected, measured: old.measured };
    }),
    edges: next.edges.map((e) => {
      const old = edges.get(e.id);
      if (!old) return e;
      if (
        old.source === e.source &&
        old.target === e.target &&
        old.type === e.type &&
        old.ariaLabel === e.ariaLabel &&
        same(old.data, e.data) &&
        same(old.domAttributes, e.domAttributes)
      )
        return old;
      return { ...e, selected: old.selected };
    }),
  };
}
