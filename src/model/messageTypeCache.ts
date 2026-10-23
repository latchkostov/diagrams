import type { DiagramFile } from "./types";
import { messageTypesAt, type MessageTypes } from "./messageTypes";

const cache = new Map<string, MessageTypes>();
const longStrings = new Map<string, number>();
let nextId = 0,
  retained = 0;

/** Bound serialized strings, including object keys. Intern long authored values once, without truncation collisions. */
function compact(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.length <= 256) return value;
    let id = longStrings.get(value);
    if (id === undefined) {
      if (retained + value.length > 1_000_000) {
        longStrings.clear();
        cache.clear();
        retained = 0;
      }
      id = ++nextId;
      if (value.length <= 1_000_000) {
        longStrings.set(value, id);
        retained += value.length;
      }
    }
    return ["interned", id];
  }
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === "object")
    return Object.entries(value).map(([key, entry]) => [compact(key), compact(entry)]);
  return value;
}

/** Geometry, selection and measurements never invalidate message semantics. Shared by inspector and hover readers. */
export function routingContentKey(diagram: DiagramFile): string {
  return JSON.stringify(
    compact([
      diagram.nodes.map((node) => [
        node.id,
        node.stencil,
        node.label,
        node.sublabel,
        node.props?.messageType,
        node.props?.emits,
        node.props?.trafficMix,
        node.props?.routeTable,
      ]),
      diagram.edges.map((edge) => [edge.id, edge.from, edge.to, edge.kind, edge.relation, edge.props]),
      diagram.planning,
      diagram.simulations?.map((sim) => [
        sim.traffic,
        sim.setup,
        sim.timeline?.filter(({ action }) => action.do === "inject" || action.do === "props"),
      ]),
    ]),
  );
}

export function cachedMessageTypesAt(diagram: DiagramFile): MessageTypes {
  const key = routingContentKey(diagram);
  const previous = cache.get(key);
  if (previous) return previous;
  const result = messageTypesAt(diagram);
  // A few recent semantic snapshots cover undo and several simultaneous canvases without retaining a history.
  if (cache.size >= 4) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
