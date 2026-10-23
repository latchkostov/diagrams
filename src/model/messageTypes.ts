import type { DiagramFile, SimRole } from "./types";
import { compileTopology, acceptsType, emittedType, deadLetterRoutes, type CompiledEdge } from "../sim/topology";
import { stencilRole } from "../stencils/roles";
import { stronglyConnected } from "./stronglyConnected";

export interface TypeStep {
  edge: string;
  from: string;
  to: string;
  receives: string;
  sends: string;
}

export interface MessageLoop {
  node: string;
  type: string;
  steps: TypeStep[];
}

export interface MessageTypes {
  arriving: ReadonlyMap<string, ReadonlySet<string>>;
  /** Before this link's filter and rename: the choices for Only pass. */
  upstream: ReadonlyMap<string, ReadonlySet<string>>;
  carried: ReadonlyMap<string, ReadonlySet<string>>;
  known: ReadonlySet<string>;
  loops: MessageLoop[];
  /** A hostile diagram exhausted the work budget: never claim it is loop-free. */
  complete: boolean;
}

export const MESSAGE_TYPE_WORK_LIMIT = 200_000;
const forwards = (role: SimRole) => role !== "store" && role !== "sink" && role !== "source";
const processor = (role: SimRole) => role === "processor" || role === "none";
const stateKey = (node: string, type: string) => JSON.stringify([node, type]);

/**
 * Finite, monotone fixed point: a (node, type) is queued once, with no path enumeration or recursive walks.
 * Work is linear in the typed graph, O(types × (nodes + edges)), which is also the possible output size.
 * A shared work cap bounds adversarial vocabularies/graphs. No traffic rates, retries or redelivery are simulated.
 */
export function messageTypesAt(
  diagram: DiagramFile,
  sources?: readonly { node: string; type: string }[],
): MessageTypes {
  const arriving = new Map(diagram.nodes.map((n) => [n.id, new Set<string>()]));
  const upstream = new Map(diagram.edges.map((e) => [e.id, new Set<string>()]));
  const carried = new Map(diagram.edges.map((e) => [e.id, new Set<string>()]));
  const nodes = new Map(diagram.nodes.map((n) => [n.id, n]));
  const order = new Map(diagram.nodes.map((n, index) => [n.id, index]));
  const roles = new Map(diagram.nodes.map((n) => [n.id, stencilRole(n.stencil)]));
  const topology = compileTopology(diagram);
  const deadLetters = deadLetterRoutes(topology);
  const outgoing = new Map<string, CompiledEdge[]>();
  for (const edge of topology.edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }
  const known = new Set<string>();
  const remember = (value: unknown) => {
    if (typeof value === "string") known.add(value);
  };
  for (const node of diagram.nodes) {
    if (roles.get(node.id) === "source") remember(node.props?.messageType ?? (node.label || "Message"));
    remember(node.props?.messageType);
    const emits = node.props?.emits;
    if (emits && typeof emits === "object" && !Array.isArray(emits)) {
      for (const [input, output] of Object.entries(emits)) {
        if (input !== "*") remember(input);
        remember(output);
      }
    } else remember(emits);
  }
  for (const edge of diagram.edges) {
    remember(edge.props?.emits);
    if (Array.isArray(edge.props?.filter))
      for (const type of edge.props.filter) if (typeof type === "string" && !type.endsWith("*")) remember(type);
  }
  const queue: { node: string; type: string; source?: true }[] = [];
  const states = new Map<string, { node: string; type: string }>();
  const steps = new Map<string, TypeStep[]>();
  let work = 0;
  let complete = true;
  const arrive = (node: string, type: string) => {
    const set = arriving.get(node)!;
    if (set.has(type)) return;
    set.add(type);
    const state = { node, type };
    states.set(stateKey(node, type), state);
    queue.push(state);
  };
  if (sources) {
    const seeded = new Set<string>();
    for (const input of sources)
      if (nodes.has(input.node)) {
        const key = stateKey(input.node, input.type);
        if (seeded.has(key)) continue;
        seeded.add(key);
        known.add(input.type);
        if (roles.get(input.node) === "source") queue.push({ ...input, source: true });
        else arrive(input.node, input.type);
      }
  } else
    for (const node of diagram.nodes)
      if (roles.get(node.id) === "source")
        queue.push({ node: node.id, type: String(node.props?.messageType ?? (node.label || "Message")), source: true });
  for (let at = 0; at < queue.length; at++) {
    const item = queue[at];
    const role = roles.get(item.node)!;
    if (!item.source && !forwards(role)) continue;
    const type = processor(role) ? emittedType(nodes.get(item.node)?.props?.emits, item.type) : item.type;
    for (const edge of outgoing.get(item.node) ?? []) {
      if (++work > MESSAGE_TYPE_WORK_LIMIT) {
        complete = false;
        break;
      }
      upstream.get(edge.id)!.add(type);
      if (
        edge.deny ||
        (edge.share === 0 && role !== "gateway") ||
        (edge.dlq && (processor(role) || deadLetters.get(edge.from)?.id !== edge.id))
      )
        continue;
      if (!acceptsType(edge.filter, type)) continue;
      const sent = edge.emits ?? type;
      carried.get(edge.id)!.add(sent);
      arrive(edge.to, sent);
      // Only forward processor paths count as message loops. Broker redelivery/retry paths and sources do not.
      if (!item.source && !edge.dlq && processor(role) && processor(roles.get(edge.to)!)) {
        const key = stateKey(item.node, item.type);
        const list = steps.get(key) ?? [];
        list.push({ edge: edge.id, from: item.node, to: edge.to, receives: item.type, sends: sent });
        steps.set(key, list);
      }
    }
    if (!complete) break;
  }
  const targets = new Map([...steps].map(([key, list]) => [key, list.map((s) => stateKey(s.to, s.sends))]));
  const loops: MessageLoop[] = [];
  for (const component of stronglyConnected([...states.keys()], (id) => targets.get(id) ?? [])) {
    if (component.length === 1 && !targets.get(component[0])?.includes(component[0])) continue;
    const members = new Set(component);
    const first = component
      .map((id) => states.get(id)!)
      .reduce((best, state) =>
        order.get(state.node)! < order.get(best.node)! || (state.node === best.node && state.type < best.type)
          ? state
          : best,
      );
    loops.push({
      ...first,
      steps: component.flatMap((id) => (steps.get(id) ?? []).filter((s) => members.has(stateKey(s.to, s.sends)))),
    });
  }
  return { arriving, upstream, carried, known, loops, complete };
}
