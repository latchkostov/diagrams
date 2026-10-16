import { contains, type Rect } from "../canvas/membership";

export interface GroupBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  group?: string;
}

export interface HierarchyElementBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  group?: string;
}

export interface PlanBoundaryAdoptionParams {
  bounds: Rect;
  existingGroups: readonly GroupBox[];
  elements: readonly HierarchyElementBox[];
  requestedParentId?: string;
}

export interface BoundaryAdoptionPlan {
  outerGroupId?: string;
  adoptedGroupIds: string[];
  adoptedElementIds: string[];
}

/** Expands several roots with one indexed traversal, regardless of input order. */
export function expandGroupIds(
  rootIds: Iterable<string>,
  groups: readonly { id: string; group?: string }[],
): Set<string> {
  const children = new Map<string, string[]>();
  for (const g of groups) {
    if (!g.group) continue;
    const list = children.get(g.group) ?? [];
    list.push(g.id);
    children.set(g.group, list);
  }
  const result = new Set(rootIds);
  const pending = [...result];
  while (pending.length) {
    for (const id of children.get(pending.pop()!) ?? []) {
      if (result.has(id)) continue;
      result.add(id);
      pending.push(id);
    }
  }
  return result;
}

/** Recursively computes all descendant group IDs of `groupId`. */
export function descendantGroupIds(groupId: string, groups: readonly { id: string; group?: string }[]): Set<string> {
  const result = expandGroupIds([groupId], groups);
  result.delete(groupId);
  return result;
}

/** Selected elements whose existing membership must survive wrapping or moving the selection. */
export function selectionSubtreeIds(selectedGroupIds: Iterable<string>, groups: readonly GroupBox[]): Set<string> {
  return expandGroupIds(selectedGroupIds, groups);
}

/** Reparent only moved subtree roots; all links inside a moved subtree stay intact. */
export function planBoundaryDrop(
  selectedGroupIds: ReadonlySet<string>,
  groups: readonly GroupBox[],
): Map<string, string | undefined> {
  const subtrees = selectionSubtreeIds(selectedGroupIds, groups);
  const candidates = groups.filter((g) => !subtrees.has(g.id));
  const result = new Map<string, string | undefined>();
  for (const g of groups) {
    if (!selectedGroupIds.has(g.id) || (g.group && subtrees.has(g.group))) continue;
    let best: GroupBox | undefined;
    for (const parent of candidates) {
      if (parent.width * parent.height <= g.width * g.height) continue;
      if (!contains(parent, g.x + g.width / 2, g.y + g.height / 2)) continue;
      if (!best || parent.width * parent.height < best.width * best.height) best = parent;
    }
    result.set(g.id, best?.id);
  }
  return result;
}

/** Recursively computes all ancestor group IDs of `groupId`. */
export function ancestorGroupIds(
  groupId: string,
  groups: readonly { id: string; group?: string }[],
  byId: ReadonlyMap<string, { group?: string }> = new Map(groups.map((g) => [g.id, g])),
): Set<string> {
  const result = new Set<string>();
  let cur = byId.get(groupId)?.group;
  const visited = new Set<string>([groupId]);
  while (cur && !visited.has(cur)) {
    result.add(cur);
    visited.add(cur);
    cur = byId.get(cur)?.group;
  }
  return result;
}

/** Constant-space-per-boundary ancestry for placement. Tree intervals avoid materializing
 * every transitive ancestor set in a deep hierarchy. Collapse cycles once so malformed
 * input also gets constant-time queries, with all cycle members sharing ancestry. */
export function indexGroupAncestry(groups: readonly { id: string; group?: string }[]) {
  const parents = new Map(groups.map((g) => [g.id, g.group]));
  const component = new Map<string, string>();
  for (const id of parents.keys()) {
    if (component.has(id)) continue;
    const path: string[] = [];
    const positions = new Map<string, number>();
    let cur: string | undefined = id;
    while (cur && parents.has(cur) && !component.has(cur) && !positions.has(cur)) {
      positions.set(cur, path.length);
      path.push(cur);
      cur = parents.get(cur);
    }
    const cycle = cur === undefined ? undefined : positions.get(cur);
    if (cycle !== undefined) for (let i = cycle; i < path.length; i++) component.set(path[i], path[cycle]);
    for (const member of path) if (!component.has(member)) component.set(member, member);
  }
  const children = new Map<string, string[]>();
  const roots = new Set(component.values());
  for (const [id, parent] of parents) {
    const child = component.get(id)!;
    const ancestor = parent === undefined ? undefined : component.get(parent);
    if (ancestor === undefined || ancestor === child) continue;
    const list = children.get(ancestor) ?? [];
    list.push(child);
    children.set(ancestor, list);
    roots.delete(child);
  }
  const intervals = new Map<string, { start: number; end: number }>();
  const pending = [...roots].map((id) => ({ id, exit: false }));
  let cursor = 0;
  while (pending.length) {
    const { id, exit } = pending.pop()!;
    if (exit) intervals.get(id)!.end = cursor;
    else {
      if (intervals.has(id)) continue;
      intervals.set(id, { start: cursor++, end: 0 });
      pending.push({ id, exit: true });
      for (const child of children.get(id) ?? []) pending.push({ id: child, exit: false });
    }
  }
  return (child: string, ancestor: string): boolean => {
    if (child === ancestor) return true;
    const a = intervals.get(component.get(ancestor) ?? ancestor);
    const c = intervals.get(component.get(child) ?? child);
    return !!a && !!c && a.start <= c.start && c.start < a.end;
  };
}

/** Checks whether setting `proposedParentId` as parent of `childId` would create a parent cycle. */
export function wouldCreateCycle(
  childId: string,
  proposedParentId: string | undefined,
  groups: readonly { id: string; group?: string }[],
): boolean {
  if (!proposedParentId || childId === proposedParentId) return true;
  const descendants = descendantGroupIds(childId, groups);
  return descendants.has(proposedParentId);
}

/** Returns the set of group IDs that can safely be a parent of `childId` without forming a cycle. */
export function eligibleParentGroupIds(
  childId: string,
  groups: readonly { id: string; group?: string }[],
): Set<string> {
  const descendants = descendantGroupIds(childId, groups);
  const eligible = new Set<string>();
  for (const g of groups) {
    if (g.id !== childId && !descendants.has(g.id)) {
      eligible.add(g.id);
    }
  }
  return eligible;
}

/**
 * Plans the adoption of enclosed elements and determines the parent for a newly created or converted
 * boundary, strictly guaranteeing an acyclic hierarchy.
 */
export function planBoundaryAdoption(params: PlanBoundaryAdoptionParams): BoundaryAdoptionPlan {
  const { bounds, existingGroups, elements, requestedParentId } = params;
  const bw = bounds.width;
  const bh = bounds.height;
  const bArea = bw * bh;
  const bc = { x: bounds.x + bw / 2, y: bounds.y + bh / 2 };

  // 1. Determine all enclosed groups (strictly smaller in area and center is inside bounds).
  const enclosedGroupIds = new Set<string>();
  for (const g of existingGroups) {
    const gc = { x: g.x + g.width / 2, y: g.y + g.height / 2 };
    if (g.width * g.height < bArea && contains(bounds, gc.x, gc.y)) {
      enclosedGroupIds.add(g.id);
    }
  }

  // 2. All descendants of enclosed groups are also part of the enclosed subtree.
  const allEnclosedSubtreeGroupIds = expandGroupIds(enclosedGroupIds, existingGroups);

  // Preserve existing nesting: adopt only roots of the enclosed subtrees.
  const adoptedGroupIds = existingGroups
    .filter((g) => enclosedGroupIds.has(g.id) && (!g.group || !allEnclosedSubtreeGroupIds.has(g.group)))
    .map((g) => g.id);

  // 4. Candidate parent groups: Must exclude all enclosed groups and their descendants.
  const parentCandidates = existingGroups.filter(
    (g) => !allEnclosedSubtreeGroupIds.has(g.id) && g.width * g.height > bArea,
  );

  let outerGroupId: string | undefined;
  if (requestedParentId && parentCandidates.some((g) => g.id === requestedParentId)) {
    outerGroupId = requestedParentId;
  } else {
    // Pick the smallest candidate containing the center of bounds.
    let best: GroupBox | undefined;
    for (const g of parentCandidates) {
      if (contains({ x: g.x, y: g.y, width: g.width, height: g.height }, bc.x, bc.y)) {
        if (!best || g.width * g.height < best.width * best.height) {
          best = g;
        }
      }
    }
    outerGroupId = best?.id;
  }

  // 5. Adopted elements (nodes and annotations):
  // Must be geometrically inside bounds, not the converted element itself, and NOT already
  // a member of any enclosed group.
  const adoptedElementIds: string[] = [];
  for (const el of elements) {
    if (el.group && allEnclosedSubtreeGroupIds.has(el.group)) continue;
    const ec = { x: el.x + el.width / 2, y: el.y + el.height / 2 };
    if (contains(bounds, ec.x, ec.y)) {
      adoptedElementIds.push(el.id);
    }
  }

  return {
    outerGroupId,
    adoptedGroupIds,
    adoptedElementIds,
  };
}

/** Input parents are untrusted. Keep only existing references and break cycles before rendering. */
export function sanitizeGroupParents<T extends { id: string; group?: string }>(
  groups: readonly T[],
  externalIds: ReadonlySet<string>,
): T[] {
  const ids = new Set([...externalIds, ...groups.map((g) => g.id)]);
  const clean = groups.map((g) => ({
    ...g,
    group: typeof g.group === "string" && ids.has(g.group) ? g.group : undefined,
  }));
  const byId = new Map(clean.map((g) => [g.id, g]));
  const done = new Set<string>();
  for (const g of clean) {
    const path = new Set<string>();
    let cur: typeof g | undefined = g;
    while (cur && !done.has(cur.id)) {
      path.add(cur.id);
      if (cur.group && path.has(cur.group)) {
        cur.group = undefined;
        break;
      }
      cur = cur.group ? byId.get(cur.group) : undefined;
    }
    for (const id of path) done.add(id);
  }
  return clean;
}
