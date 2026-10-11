import type { DiagramFile } from "../model/types";

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
    removed = empty();
  for (const field of ["nodes", "edges", "groups", "annotations", "simulations"] as const) {
    const old = new Map((before[field] ?? []).map((e) => [e.id, e]));
    const next = new Map((after[field] ?? []).map((e) => [e.id, e]));
    for (const [id, value] of next) {
      if (!old.has(id)) added[field].push(id);
      else if (JSON.stringify(old.get(id)) !== JSON.stringify(value)) updated[field].push(id);
    }
    for (const id of old.keys()) if (!next.has(id)) removed[field].push(id);
  }
  for (const changes of [added, updated, removed]) {
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
    before.title !== after.title || before.description !== after.description || before.direction !== after.direction;
  const names = {
    nodes: "nodes",
    edges: "connections",
    groups: "boundaries",
    annotations: "annotations",
    simulations: "simulations",
  };
  const summary =
    [
      ...(["nodes", "edges", "groups", "annotations", "simulations"] as const).flatMap((field) => [
        added[field].length ? `+${added[field].length} ${names[field]}` : "",
        removed[field].length ? `−${removed[field].length} ${names[field]}` : "",
      ]),
      updated.count ? `${updated.count} updated` : "",
      metaChanged ? "metadata updated" : "",
    ]
      .filter(Boolean)
      .join(", ") || "No changes";
  return { added, updated, removed, metaChanged, summary };
}
