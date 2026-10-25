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

const area = (r: Rect) => r.width * r.height;
const around = (parent: Rect, child: Rect) => contains(parent, child.x + child.width / 2, child.y + child.height / 2);
/** The smallest larger boundary around this box's centre. Equal areas keep diagram order. */
export function parentBoundary(bounds: Rect, candidates: readonly GroupBox[]): string | undefined {
  return candidates.reduce<GroupBox | undefined>(
    (best, g) => (area(g) > area(bounds) && around(g, bounds) && (!best || area(g) < area(best)) ? g : best),
    undefined,
  )?.id;
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
  return new Map(
    groups
      .filter((g) => selectedGroupIds.has(g.id) && (!g.group || !subtrees.has(g.group)))
      .map((g) => [g.id, parentBoundary(g, candidates)]),
  );
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
  const bArea = area(bounds);

  // 1. Determine all enclosed groups (strictly smaller in area and center is inside bounds).
  const enclosed = existingGroups.filter((g) => area(g) < bArea && around(bounds, g));
  const enclosedGroupIds = new Set(enclosed.map((g) => g.id));

  // 2. All descendants of enclosed groups are also part of the enclosed subtree.
  const allEnclosedSubtreeGroupIds = expandGroupIds(enclosedGroupIds, existingGroups);

  // Preserve existing nesting: adopt only roots of the enclosed subtrees.
  const adoptedGroupIds = enclosed.filter((g) => !g.group || !allEnclosedSubtreeGroupIds.has(g.group)).map((g) => g.id);

  // 4. Candidate parent groups: Must exclude all enclosed groups and their descendants.
  const parentCandidates = existingGroups.filter((g) => !allEnclosedSubtreeGroupIds.has(g.id) && area(g) > bArea);

  const outerGroupId =
    requestedParentId && parentCandidates.some((g) => g.id === requestedParentId)
      ? requestedParentId
      : parentBoundary(bounds, parentCandidates);

  // 5. Adopted elements (nodes and annotations):
  // Must be geometrically inside bounds, not the converted element itself, and NOT already
  // a member of any enclosed group.
  const adoptedElementIds = elements
    .filter((el) => (!el.group || !allEnclosedSubtreeGroupIds.has(el.group)) && around(bounds, el))
    .map((el) => el.id);

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
