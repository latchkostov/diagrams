import { connectionProps } from "../model/connectionDefaults";
import { changeNodeStencil } from "../model/changeNodeStencil";
import { splitEdge } from "../model/edgeSplit";
import type { DiagramFile, DiagramNode } from "../model/types";
import { uniqueId, stencilIdBase } from "../editor/ids";
import { estimateCardSize } from "../canvas/nodes/size";
import { placeFree, overlaps } from "../canvas/placement";
import { resolveRef, ReferenceError, RefIndex, type ElementKind } from "./refs";
import { resolveKind } from "./stencils";
import { reinferRelations, relationChangeText } from "../stencils/relations";
import { connectionDefaults } from "../model/connectionDefaults";
import { placeNew } from "./place";
import { checkBudget, checkSchema, validated } from "./validation";
import { edit_diagramSchema } from "./schemas";
import { diagramDiff } from "../model/diagramDiff";
import { simulationReferenceWarnings } from "../interop/native";
import type { ApplyOpsOptions, ApplyOpsResult, DiagramOp, OpResult } from "./index";
import {
  hasEdgeRouting,
  hasNodeRouting,
  nextAppearance,
  routeTableCapable,
  trafficMixCapable,
  type RequestRoute,
  type RouteTable,
} from "../model/requestRouting";
import { stencilRole } from "../stencils/roles";

/**
 * Request routing settings an op writes on a node: a table only on an HTTP router and a mix only on a source (a
 * table that went dormant with a stencil change stays, but none is added there), and a table's targets named by a
 * batch key resolve to that connection's id (stored tables never hold keys or labels).
 */
function routedProps(n: DiagramNode, keys: ReadonlyMap<string, string>): void {
  const props = n.props;
  if (!props) return;
  const role = stencilRole(n.stencil);
  if (props.routeTable !== undefined && !routeTableCapable(n.stencil, role))
    throw new Error(
      `props.routeTable needs an HTTP router (Kong, API Management, API Gateway, NGINX, Envoy and similar); ${n.stencil} doesn't route by path.`,
    );
  if (props.trafficMix !== undefined && !trafficMixCapable(role))
    throw new Error("props.trafficMix belongs on a source (a client, a webhook, a producer).");
  const table = props.routeTable as RouteTable | undefined;
  if (!table || !Array.isArray(table.rules)) return;
  const resolve = <A extends { targets?: { edgeId: string; weight: number }[] }>(a: A): A =>
    Array.isArray(a.targets)
      ? { ...a, targets: a.targets.map((t) => ({ ...t, edgeId: keys.get(t.edgeId) ?? t.edgeId })) }
      : a;
  props.routeTable = {
    ...table,
    rules: table.rules.map(resolve),
    ...(table.default ? { default: resolve(table.default) } : {}),
  };
}

/** Re-inferred connections listed in one op's result, and in a whole batch's: the rest are counted, not listed. */
export const MAX_RELATIONS_PER_OP = 50;
export const MAX_RELATIONS_PER_BATCH = 200;

/**
 * A node's stencil changed: its edges' relationships follow, and the op's result says which and what to. The list
 * is bounded (`budget` is what the batch may still list); `note` and `relationsOmitted` still count every one.
 */
function reinferEdges(next: DiagramFile, nodeId: string, result: OpResult, budget: { left: number }): void {
  const stencils = new Map(next.nodes.map((n) => [n.id, n.stencil]));
  const changes = reinferRelations(next.edges, (id) => stencils.get(id), new Set([nodeId]));
  if (!changes.length) return;
  const to = new Map(changes.map((c) => [c.id, c.to]));
  for (const e of next.edges) {
    const relation = to.get(e.id);
    if (relation === undefined) continue;
    if (relation === "flow") {
      delete e.relation;
      delete e.relationOrigin;
    } else Object.assign(e, { relation, relationOrigin: "inferred" });
  }
  const listed = changes.slice(0, Math.max(0, Math.min(MAX_RELATIONS_PER_OP, budget.left)));
  budget.left -= listed.length;
  result.relations = listed;
  if (listed.length < changes.length) result.relationsOmitted = changes.length - listed.length;
  result.note = relationChangeText(changes);
}

const mergeProps = (old: Record<string, unknown> | undefined, patch: Record<string, unknown>) =>
  Object.fromEntries(Object.entries({ ...old, ...patch }).filter(([, v]) => v !== null));

export function applyOps(diagram: DiagramFile, ops: readonly DiagramOp[], opts: ApplyOpsOptions = {}): ApplyOpsResult {
  let i = -1;
  const results: OpResult[] = [];
  const warnings: string[] = [];
  try {
    checkBudget({ diagram, ops });
    if (Array.isArray(ops) && !ops.length && opts.layout !== "full")
      throw new Error("An empty operation batch needs layout: full.");
    const properties = edit_diagramSchema.properties as Record<string, Record<string, unknown>>;
    const opSchema = properties.ops.items as Record<string, unknown>;
    checkSchema(
      { ops, ...opts },
      { ...edit_diagramSchema, properties: { ...properties, ops: { ...properties.ops, items: undefined } } },
    );
    // Validate the original before cloning; all writes below belong to the proposal.
    let next = structuredClone(validated(diagram));
    const keys = new Map<string, string>();
    const index = new RefIndex(next);
    const fresh: string[] = [];
    const keepOutside = new Set<string>();
    const newNotes: { id: string; near?: string }[] = [];
    const touched = new Set<string>();
    const relationBudget = { left: MAX_RELATIONS_PER_BATCH };
    const allIds = () => new Set(index.elements.keys());
    // Kind-aware: each op resolves a name only to the kinds it acts on, and acts on the kind its target is.
    const ref = (r: string, kinds?: readonly ElementKind[]) => resolveRef(next, r, keys, index, kinds);
    const kindOf = (id: string) => index.elements.get(id)?.kind;
    const node = (r: string): DiagramNode => {
      const id = ref(r, ["node"]);
      const n = index.nodes.get(id);
      if (!n) throw new Error(`${JSON.stringify(r)} must refer to a node.`);
      return n;
    };
    const boundary = (r: string) => {
      const id = ref(r, ["group"]);
      if (!next.groups?.some((g) => g.id === id)) throw new Error(`${JSON.stringify(r)} must refer to a boundary.`);
      return id;
    };
    const noteAnchor = (id?: string) => {
      const n = id ? next.nodes.find((n) => n.id === id) : undefined;
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
          routedProps(next.nodes.at(-1)!, keys);
          fresh.push(id);
          Object.assign(result, { id, label: op.label, stencil });
          if (stencil.confidence === "low")
            warnings.push(`Kind ${JSON.stringify(op.kind)} resolved to ${stencil.id} with low confidence.`);
          break;
        }
        case "connect": {
          const from = ref(op.from, ["node", "note"]),
            to = ref(op.to, ["node", "note"]);
          for (const id of [from, to])
            if (
              !next.nodes.some((n) => n.id === id) &&
              !next.annotations?.some((a) => a.id === id && a.kind === "shape")
            )
              throw new Error("Connections must end on nodes or shapes.");
          const id = uniqueId("e", allIds());
          // Omitted kind/relation: the same defaults as drawing a connection in the editor.
          const stencil = (ref: string) => next.nodes.find((n) => n.id === ref)?.stencil;
          next.edges.push({
            id,
            from,
            to,
            ...connectionDefaults(
              { id: from, stencil: stencil(from) },
              { id: to, stencil: stencil(to) },
              next.planning,
              { kind: op.kind, relation: op.relation },
            ),
            ...(op.label !== undefined ? { label: op.label } : {}),
          });
          Object.assign(result, { id, from, to });
          break;
        }
        case "update": {
          const id = ref(op.target);
          result.id = id;
          const kind = kindOf(id);
          const n = kind === "node" && next.nodes.find((n) => n.id === id),
            e = kind === "edge" && next.edges.find((e) => e.id === id),
            g = kind === "group" && next.groups?.find((g) => g.id === id),
            a = kind === "note" && next.annotations?.find((a) => a.id === id);
          if (n) {
            if (n.group) touched.add(n.group);
            if (op.members || op.tone) throw new Error("members and tone require a boundary.");
            if (op.sublabel === null) delete n.sublabel;
            else if (op.sublabel !== undefined) n.sublabel = op.sublabel;
            if (op.kind !== undefined) {
              result.stencil = resolveKind(op.kind, op.label ?? n.label);
              const before = n.stencil;
              Object.assign(n, changeNodeStencil(n, result.stencil.id));
              // As on the canvas: the node's connections follow its new stencil (src/stencils/relations.ts).
              if (n.stencil !== before) reinferEdges(next, n.id, result, relationBudget);
            }
            if (op.label !== undefined) n.label = op.label;
            if (op.props) {
              n.props = mergeProps(n.props, op.props);
              if (op.props.routeTable || op.props.trafficMix) routedProps(n, keys);
            }
            if (op.in === null) {
              delete n.group;
              keepOutside.add(n.id);
            } else if (op.in !== undefined) n.group = boundary(op.in);
            if (n.group) touched.add(n.group);
          } else if (e) {
            if (op.in !== undefined || op.sublabel !== undefined || op.members || op.tone)
              throw new Error("Connection updates support label, kind and props.");
            if (op.kind !== undefined && op.kind !== "async" && op.kind !== "sync")
              throw new Error("Connection kind must be async or sync.");
            if (op.kind !== undefined) e.kind = op.kind as "async" | "sync";
            if (op.label !== undefined) e.label = op.label;
            if (op.props) e.props = mergeProps(e.props, connectionProps(e.props, op.props));
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
          // Each target removes only the element of its own kind: removing a connection never takes a node with it.
          const targets = op.targets.map((r) => ref(r));
          const of = (kind: ElementKind) => new Set(targets.filter((id) => kindOf(id) === kind));
          const [nodes, edges, groups, notes] = (["node", "edge", "group", "note"] as const).map(of);
          for (const n of next.nodes) if (nodes.has(n.id) && n.group) touched.add(n.group);
          const ends = (id: string) => nodes.has(id) || notes.has(id);
          for (const e of next.edges) if (ends(e.from) || ends(e.to)) edges.add(e.id);
          next.nodes = next.nodes
            .filter((n) => !nodes.has(n.id))
            .map((n) => {
              if (n.group && groups.has(n.group)) delete n.group;
              return n;
            });
          next.edges = next.edges.filter((e) => !edges.has(e.id));
          next.groups = next.groups?.filter((g) => !groups.has(g.id));
          next.annotations = next.annotations?.filter((a) => !notes.has(a.id));
          next.layerOrder = next.layerOrder?.filter((id) => !ends(id));
          result.ids = [...new Set([...targets, ...edges])];
          break;
        }
        case "insert_between": {
          // Against the batch so far: the ends and the connection as they are at this op.
          let a = node(op.from).id;
          let b = node(op.to).id;
          let between = next.edges.filter((e) => e.from === a && e.to === b);
          if (!between.length) {
            // Named the other way round: follow the connection that exists.
            const back = next.edges.filter((e) => e.from === b && e.to === a);
            if (back.length) [a, b, between] = [b, a, back];
          }
          if (!between.length)
            throw new Error(
              `No connection from ${JSON.stringify(op.from)} to ${JSON.stringify(op.to)} to insert into.`,
            );
          if (between.length > 1)
            throw new Error(
              `${between.length} connections join ${JSON.stringify(op.from)} and ${JSON.stringify(op.to)}: remove one, or add and connect instead.`,
            );
          const old = between[0];
          const stencil = resolveKind(op.kind, op.label);
          const id = uniqueId(stencilIdBase(stencil.id), allIds());
          const from = next.nodes.find((n) => n.id === a);
          const to = next.nodes.find((n) => n.id === b);
          next.nodes.push({
            id,
            stencil: stencil.id,
            label: op.label,
            x: 0,
            y: 0,
            ...(op.sublabel !== undefined ? { sublabel: op.sublabel } : {}),
            // Between two nodes of one boundary, it joins that boundary.
            ...(from?.group && from.group === to?.group ? { group: from.group } : {}),
          });
          if (from?.group && from.group === to?.group) touched.add(from.group);
          fresh.push(id);
          // The replaced connection's meaning carries over (src/model/edgeSplit.ts, shared with the canvas).
          next.edges = next.edges.filter((e) => e.id !== old.id);
          index.remove(old.id);
          const first = uniqueId("e", allIds());
          const second = uniqueId("e", new Set([...allIds(), first]));
          const [one, two] = splitEdge(old, id, { first, second });
          next.edges.push(one);
          index.refresh(next, first);
          next.edges.push(two);
          index.refresh(next, second);
          Object.assign(result, { id, label: op.label, stencil, from: a, to: b });
          if (stencil.confidence === "low")
            warnings.push(`Kind ${JSON.stringify(op.kind)} resolved to ${stencil.id} with low confidence.`);
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
          if (op.requestRoutes !== undefined) {
            if (next.planning?.revision !== "p3-a1" && next.planning?.revision !== "p3-w1")
              throw new Error("requestRoutes needs the current planning model (p3-a1): upgrade the diagram first.");
            // A route keeps its colour and marker by id; a new one gets the next free pair.
            const before = new Map((next.planning.requestRoutes ?? []).map((r) => [r.id, r]));
            const routes: RequestRoute[] = [];
            for (const route of op.requestRoutes) {
              const appearance = route.appearance ?? before.get(route.id)?.appearance ?? nextAppearance(routes);
              routes.push({ ...route, appearance });
            }
            next.planning = { ...next.planning, requestRoutes: routes };
          }
          break;
        }
      }
      if ("key" in op && op.key !== undefined) {
        if (!op.key.trim() || keys.has(op.key))
          throw new Error(`Duplicate or empty batch key ${JSON.stringify(op.key)}.`);
        keys.set(op.key, result.id!);
      }
      if (result.ids) for (const id of result.ids) index.remove(id);
      if (result.id) index.refresh(next, result.id);
      results.push(result);
    }
    i = ops.length - 1;
    next = placeNew(
      next,
      fresh.filter((id) => next.nodes.some((n) => n.id === id)),
      opts.layout,
      [...touched],
      [...keepOutside],
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
    // Routing settings opt the document into request routing (on the current planning model).
    if (
      (next.planning?.revision === "p3-a1" || next.planning?.revision === "p3-w1") &&
      !next.planning.requestRoutes &&
      (next.nodes.some((n) => hasNodeRouting(n.props)) || next.edges.some((e) => hasEdgeRouting(e.props)))
    )
      next.planning = { ...next.planning, requestRoutes: [] };
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
          ...(error instanceof ReferenceError
            ? { ref: error.ref, candidates: error.candidates, hint: error.hint }
            : {}),
        },
      ],
      warnings: [],
      summary: "No changes applied",
    };
  }
}
