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

/** Recursively computes all descendant group IDs of `groupId`. */
export function descendantGroupIds(groupId: string, groups: readonly { id: string; group?: string }[]): Set<string> {
  const result = new Set<string>();
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const g of groups) {
      if (g.group && (g.group === groupId || result.has(g.group)) && !result.has(g.id)) {
        result.add(g.id);
        expanded = true;
      }
    }
  }
  return result;
}

/** Recursively computes all ancestor group IDs of `groupId`. */
export function ancestorGroupIds(groupId: string, groups: readonly { id: string; group?: string }[]): Set<string> {
  const byId = new Map(groups.map((g) => [g.id, g]));
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
  const allEnclosedSubtreeGroupIds = new Set<string>(enclosedGroupIds);
  for (const gid of enclosedGroupIds) {
    for (const desc of descendantGroupIds(gid, existingGroups)) {
      allEnclosedSubtreeGroupIds.add(desc);
    }
  }

  // 3. Adopted groups: To preserve existing nesting, only groups whose parent is NOT
  // already in the enclosed subtree are adopted as direct children of the new boundary.
  const adoptedGroupIds: string[] = [];
  for (const gid of enclosedGroupIds) {
    const g = existingGroups.find((x) => x.id === gid);
    if (!g?.group || !allEnclosedSubtreeGroupIds.has(g.group)) {
      adoptedGroupIds.push(gid);
    }
  }

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
