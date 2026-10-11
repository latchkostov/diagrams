import type { DiagramFile, DiagramNode } from "../model/types";
import { uniqueId, stencilIdBase } from "../editor/ids";
import { estimateCardSize } from "../canvas/nodes/size";
import { placeFree, overlaps } from "../canvas/placement";
import { resolveRef, ReferenceError } from "./refs";
import { resolveKind } from "./stencils";
import { placeNew } from "./place";
import { checkBudget, checkSchema, validated } from "./validation";
import { edit_diagramSchema } from "./schemas";
import { diagramDiff } from "../editor/diagramDiff";
import { simulationReferenceWarnings } from "../interop/native";
import type { ApplyOpsOptions, ApplyOpsResult, DiagramOp, OpResult } from "./index";

const mergeProps = (old: Record<string, unknown> | undefined, patch: Record<string, unknown>) =>
  Object.fromEntries(Object.entries({ ...old, ...patch }).filter(([, v]) => v !== null));

export function applyOps(diagram: DiagramFile, ops: readonly DiagramOp[], opts: ApplyOpsOptions = {}): ApplyOpsResult {
  let i = -1;
  const results: OpResult[] = [];
  const warnings: string[] = [];
  try {
    checkBudget({ diagram, ops });
    const properties = edit_diagramSchema.properties as Record<string, Record<string, unknown>>;
    const opSchema = properties.ops.items as Record<string, unknown>;
    checkSchema(
      { ops, ...opts },
      { ...edit_diagramSchema, properties: { ...properties, ops: { ...properties.ops, items: undefined } } },
    );
    // Validate the original before cloning; all writes below belong to the proposal.
    let next = structuredClone(validated(diagram));
    const keys = new Map<string, string>();
    const fresh: string[] = [];
    const newNotes: { id: string; near?: string }[] = [];
    const touched = new Set<string>();
    const allIds = () =>
      new Set([...next.nodes, ...next.edges, ...(next.groups ?? []), ...(next.annotations ?? [])].map((e) => e.id));
    const ref = (r: string) => resolveRef(next, r, keys);
    const node = (r: string): DiagramNode => {
      const id = ref(r);
      const n = next.nodes.find((n) => n.id === id);
      if (!n) throw new Error(`${JSON.stringify(r)} must refer to a node.`);
      return n;
    };
    const boundary = (r: string) => {
      const id = ref(r);
      if (!next.groups?.some((g) => g.id === id)) throw new Error(`${JSON.stringify(r)} must refer to a boundary.`);
      return id;
    };
    const noteAnchor = (id?: string) => {
      const n = next.nodes.find((n) => n.id === id);
      const a = next.annotations?.find((a) => a.id === id);
      const g = next.groups?.find((g) => g.id === id);
      if (n) return { x: n.x + 120, y: n.y + 200 };
      const box = a ?? g;
      if (box) return { x: box.x + box.width + 160, y: box.y + box.height / 2 };
      const edge = next.edges.find((e) => e.id === id);
      const from = edge && next.nodes.find((n) => n.id === edge.from),
        to = edge && next.nodes.find((n) => n.id === edge.to);
      if (from && to) return { x: (from.x + to.x) / 2 + 110, y: (from.y + to.y) / 2 + 200 };
      return { x: 150, y: 250 };
    };
    for (i = 0; i < ops.length; i++) {
      const op = ops[i];
      checkSchema(op, opSchema, `ops[${i}]`);
      const result: OpResult = { i, op: op.op };
      switch (op.op) {
        case "add_node": {
          const stencil = resolveKind(op.kind, op.label);
          const id = uniqueId(stencilIdBase(stencil.id), allIds());
          next.nodes.push({
            id,
            stencil: stencil.id,
            label: op.label,
            x: 0,
            y: 0,
            ...(op.sublabel !== undefined ? { sublabel: op.sublabel } : {}),
            ...(op.in ? { group: boundary(op.in) } : {}),
            ...(op.props ? { props: op.props } : {}),
          });
          fresh.push(id);
          Object.assign(result, { id, label: op.label, stencil });
          if (stencil.confidence === "low")
            warnings.push(`Kind ${JSON.stringify(op.kind)} resolved to ${stencil.id} with low confidence.`);
          break;
        }
        case "connect": {
          const from = ref(op.from),
            to = ref(op.to);
          for (const id of [from, to])
            if (
              !next.nodes.some((n) => n.id === id) &&
              !next.annotations?.some((a) => a.id === id && a.kind === "shape")
            )
              throw new Error("Connections must end on nodes or shapes.");
          const id = uniqueId("e", allIds());
          next.edges.push({
            id,
            from,
            to,
            kind: op.kind ?? "async",
            ...(op.label !== undefined ? { label: op.label } : {}),
          });
          Object.assign(result, { id, from, to });
          break;
        }
        case "update": {
          const id = ref(op.target);
          result.id = id;
          const n = next.nodes.find((n) => n.id === id),
            e = next.edges.find((e) => e.id === id),
            g = next.groups?.find((g) => g.id === id),
            a = next.annotations?.find((a) => a.id === id);
          if (n) {
            if (n.group) touched.add(n.group);
            if (op.members || op.tone) throw new Error("members and tone require a boundary.");
            if (op.label !== undefined) n.label = op.label;
            if (op.sublabel === null) delete n.sublabel;
            else if (op.sublabel !== undefined) n.sublabel = op.sublabel;
            if (op.kind !== undefined) {
              result.stencil = resolveKind(op.kind, n.label);
              n.stencil = result.stencil.id;
            }
            if (op.props) n.props = mergeProps(n.props, op.props);
            if (op.in === null) delete n.group;
            else if (op.in !== undefined) n.group = boundary(op.in);
            if (n.group) touched.add(n.group);
          } else if (e) {
            if (op.in !== undefined || op.sublabel !== undefined || op.members || op.tone)
              throw new Error("Connection updates support label, kind and props.");
            if (op.kind !== undefined && op.kind !== "async" && op.kind !== "sync")
              throw new Error("Connection kind must be async or sync.");
            if (op.kind !== undefined) e.kind = op.kind as "async" | "sync";
            if (op.label !== undefined) e.label = op.label;
            if (op.props) e.props = mergeProps(e.props, op.props);
          } else if (g) {
            touched.add(g.id);
            if (op.kind !== undefined || op.in !== undefined || op.props || op.sublabel !== undefined)
              throw new Error("Boundary updates support label, members and tone.");
            if (op.label !== undefined) g.label = op.label;
            if (op.tone !== undefined) g.tone = op.tone;
            if (op.members) {
              const members = new Set(op.members.map((r) => node(r).id));
              for (const n of next.nodes) {
                if (members.has(n.id)) {
                  if (n.group) touched.add(n.group);
                  n.group = id;
                } else if (n.group === id) delete n.group;
              }
            }
          } else if (a) {
            if (
              op.kind !== undefined ||
              op.in !== undefined ||
              op.props ||
              op.sublabel !== undefined ||
              op.members ||
              op.tone
            )
              throw new Error("Note updates support label (text).");
            if (op.label !== undefined) a.text = op.label;
          }
          break;
        }
        case "remove": {
          const ids = new Set(op.targets.map(ref));
          for (const n of next.nodes) if (ids.has(n.id) && n.group) touched.add(n.group);
          const incident = next.edges.filter((e) => ids.has(e.from) || ids.has(e.to)).map((e) => e.id);
          incident.forEach((id) => ids.add(id));
          next.nodes = next.nodes
            .filter((n) => !ids.has(n.id))
            .map((n) => {
              if (n.group && ids.has(n.group)) delete n.group;
              return n;
            });
          next.edges = next.edges.filter((e) => !ids.has(e.id));
          next.groups = next.groups?.filter((g) => !ids.has(g.id));
          next.annotations = next.annotations?.filter((a) => !ids.has(a.id));
          next.layerOrder = next.layerOrder?.filter((id) => !ids.has(id));
          result.ids = [...ids];
          break;
        }
        case "add_boundary": {
          const members = op.members.map(node);
          const id = uniqueId("boundary", allIds());
          (next.groups ??= []).push({
            id,
            label: op.label,
            tone: op.tone ?? "neutral",
            x: 0,
            y: 0,
            width: 0,
            height: 0,
          });
          members.forEach((n) => {
            if (n.group) touched.add(n.group);
            n.group = id;
          });
          touched.add(id);
          Object.assign(result, { id, label: op.label });
          break;
        }
        case "add_note": {
          const id = uniqueId(op.style ?? "note", allIds());
          const near = op.near ? ref(op.near) : undefined;
          const size = { width: 240, height: op.style === "text" ? 80 : 160 };
          const center = placeFree(noteAnchor(near), size, [
            ...next.nodes.map((n) => ({ ...n, ...estimateCardSize(n.label, n.sublabel) })),
            ...(next.annotations ?? []),
          ]);
          (next.annotations ??= []).push({
            id,
            kind: op.style ?? "note",
            text: op.text,
            x: center.x - size.width / 2,
            y: center.y - size.height / 2,
            ...size,
          });
          result.id = id;
          newNotes.push({ id, near });
          break;
        }
        case "set_meta": {
          if (op.title !== undefined) next.title = op.title;
          if (op.description !== undefined) next.description = op.description;
          if (op.direction !== undefined) next.direction = op.direction;
          break;
        }
      }
      if ("key" in op && op.key !== undefined) {
        if (!op.key.trim() || keys.has(op.key))
          throw new Error(`Duplicate or empty batch key ${JSON.stringify(op.key)}.`);
        keys.set(op.key, result.id!);
      }
      results.push(result);
    }
    i = ops.length - 1;
    next = placeNew(
      next,
      fresh.filter((id) => next.nodes.some((n) => n.id === id)),
      opts.layout,
      [...touched],
    );
    // Notes follow the final card positions, including full/TB layouts in this same batch.
    for (const note of newNotes) {
      const annotation = next.annotations?.find((a) => a.id === note.id);
      if (!annotation) continue;
      const occupied = [
        ...next.nodes.map((n) => ({ ...n, ...estimateCardSize(n.label, n.sublabel) })),
        ...(next.annotations ?? []).filter((a) => a.id !== note.id),
      ];
      let center = placeFree(noteAnchor(note.near), annotation, occupied);
      const box = { ...annotation, x: center.x - annotation.width / 2, y: center.y - annotation.height / 2 };
      if (occupied.some((o) => overlaps(box, o)))
        center = { x: Math.max(0, ...occupied.map((o) => o.x + o.width)) + 80 + annotation.width / 2, y: center.y };
      annotation.x = center.x - annotation.width / 2;
      annotation.y = center.y - annotation.height / 2;
    }
    next = validated(next);
    const nodeIds = new Set(next.nodes.map((n) => n.id));
    for (const sim of next.simulations ?? []) warnings.push(...simulationReferenceWarnings(sim, nodeIds));
    return {
      ok: true,
      diagram: next,
      results,
      errors: [],
      warnings,
      summary: diagramDiff(diagram, next).summary,
      dryRun: opts.dryRun ?? false,
    };
  } catch (error) {
    return {
      ok: false,
      diagram,
      results: [],
      errors: [
        {
          i,
          error: error instanceof Error ? error.message : String(error),
          ...(error instanceof ReferenceError ? { candidates: error.candidates, hint: error.hint } : {}),
        },
      ],
      warnings: [],
      summary: "No changes applied",
    };
  }
}
