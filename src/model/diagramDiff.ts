import type { DiagramFile } from "./types";

export interface ChangeSet {
  count: number;
  ids: string[];
  nodes: string[];
  edges: string[];
  groups: string[];
  annotations: string[];
  simulations: string[];
}
export interface DiagramDiff {
  added: ChangeSet;
  updated: ChangeSet;
  moved: ChangeSet;
  hasChanges: boolean;
  removed: ChangeSet;
  metaChanged: boolean;
  summary: string;
}
const empty = (): ChangeSet => ({
  count: 0,
  ids: [],
  nodes: [],
  edges: [],
  groups: [],
  annotations: [],
  simulations: [],
});

export function diagramDiff(before: DiagramFile, after: DiagramFile): DiagramDiff {
  const added = empty(),
    updated = empty(),
    moved = empty(),
    removed = empty();
  for (const field of ["nodes", "edges", "groups", "annotations", "simulations"] as const) {
    const old = new Map((before[field] ?? []).map((e) => [e.id, e]));
    const next = new Map((after[field] ?? []).map((e) => [e.id, e]));
    for (const [id, value] of next) {
      if (!old.has(id)) added[field].push(id);
      else if (structuralText(old.get(id)) !== structuralText(value)) {
        if (structuralText(content(old.get(id), field)) !== structuralText(content(value, field)))
          updated[field].push(id);
        else moved[field].push(id);
      }
    }
    for (const id of old.keys()) if (!next.has(id)) removed[field].push(id);
  }
  for (const changes of [added, updated, removed, moved]) {
    changes.ids = [
      ...changes.nodes,
      ...changes.edges,
      ...changes.groups,
      ...changes.annotations,
      ...changes.simulations,
    ];
    changes.count = changes.ids.length;
  }
  const metaChanged =
    before.title !== after.title ||
    before.description !== after.description ||
    before.direction !== after.direction ||
    before.format !== after.format ||
    structuralText(before.planning) !== structuralText(after.planning);
  const names = {
    nodes: ["node", "nodes"],
    edges: ["connection", "connections"],
    groups: ["boundary", "boundaries"],
    annotations: ["note", "notes"],
    simulations: ["simulation", "simulations"],
  };
  const fields = ["nodes", "edges", "groups", "annotations", "simulations"] as const;
  const count = (n: number, field: (typeof fields)[number]) => `${n} ${names[field][n === 1 ? 0 : 1]}`;
  const summary =
    [
      ...fields.map((field) => (added[field].length ? `+${count(added[field].length, field)}` : "")),
      ...fields.map((field) => (removed[field].length ? `−${count(removed[field].length, field)}` : "")),
      updated.count ? `${updated.count} changed` : "",
      metaChanged && !added.count && !removed.count && !updated.count ? "title or direction changed" : "",
    ]
      .filter(Boolean)
      .join(", ") || (moved.count ? "layout changed" : "no changes");
  return {
    added,
    updated,
    removed,
    moved,
    metaChanged,
    summary,
    hasChanges: structuralText(before) !== structuralText(after),
  };
}

/** Compare persisted structure without treating property order as a change. */
export function structuralText(value: unknown): string {
  return JSON.stringify(value, (_key, child: unknown) => {
    if (child && typeof child === "object" && !Array.isArray(child))
      return Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b)));
    return child;
  });
}
function content(value: unknown, field: string): unknown {
  if (!["nodes", "groups", "annotations"].includes(field)) return value;
  const { x: _x, y: _y, ...rest } = value as Record<string, unknown>;
  if (field === "groups") {
    delete rest.width;
    delete rest.height;
  }
  return rest;
}
