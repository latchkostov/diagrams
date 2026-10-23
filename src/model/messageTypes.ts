import type { DiagramFile, SimRole } from "./types";
import {
  compileTopology,
  forwardingShare,
  forwardingTargets,
  outputType,
  deadLetterRoutes,
  type CompiledEdge,
} from "../sim/topology";
import {
  compileRoutes,
  compileMix,
  compileTable,
  compileFilter,
  chooseAction,
  type CompiledRoute,
} from "../sim/routeMatching";
import { routeTableCapable } from "./requestRouting";
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
export interface MessageTypeBudget {
  remaining: number;
}
export const messageTypeBudget = (): MessageTypeBudget => ({ remaining: MESSAGE_TYPE_WORK_LIMIT });
const processor = (role: SimRole) => role === "processor" || role === "none";

/** Each run is analyzed with its own overrides: never invent a path by mixing simulation configurations. */
export function* messageTypeScenarios(
  diagram: DiagramFile,
  budget?: MessageTypeBudget,
): Generator<{ diagram: DiagramFile; sources?: { node: string; type: string }[] }> {
  yield { diagram: { ...diagram, simulations: undefined } };
  for (const sim of diagram.simulations ?? []) {
    if (budget) {
      budget.remaining -=
        diagram.nodes.length + diagram.edges.length + sim.traffic.length + (sim.timeline?.length ?? 0);
      if (budget.remaining <= 0) return;
    }
    const configured = {
      ...diagram,
      simulations: undefined,
      nodes: diagram.nodes.map((node) => ({ ...node, props: { ...node.props, ...sim.setup?.props?.[node.id] } })),
      edges: diagram.edges.map((edge) => ({ ...edge, props: { ...edge.props, ...sim.setup?.edges?.[edge.id] } })),
    };
    const nodes = new Map(configured.nodes.map((node) => [node.id, node]));
    const inputs = [
      ...sim.traffic,
      ...(sim.timeline ?? []).flatMap(({ action }) => (action.do === "inject" ? [action] : [])),
    ];
    yield {
      diagram: configured,
      sources: inputs.map((input) => ({
        node: input.node,
        type:
          input.messageType ??
          String(nodes.get(input.node)?.props?.messageType ?? (nodes.get(input.node)?.label || "Message")),
      })),
    };
  }
}

/** Finite monotone fixed point. All scenarios share a work/allocation budget, including authored vocabulary. */
export function messageTypesAt(
  diagram: DiagramFile,
  sources?: readonly { node: string; type: string }[],
  budget = messageTypeBudget(),
): MessageTypes {
  if (sources || !diagram.simulations?.length) return propagateTypes(diagram, sources, budget);
  const analyses: MessageTypes[] = [];
  for (const scenario of messageTypeScenarios(diagram, budget)) {
    if (budget.remaining <= 0) break;
    analyses.push(propagateTypes(scenario.diagram, scenario.sources, budget));
  }
  const result = analyses[0];
  if (!result) return propagateTypes({ ...diagram, simulations: undefined }, [], budget);
  for (const analysis of analyses.slice(1)) {
    for (const field of ["arriving", "upstream", "carried"] as const)
      for (const [id, types] of analysis[field]) {
        const set = result[field].get(id) as Set<string>;
        for (const type of types) set.add(type);
      }
    for (const type of analysis.known) (result.known as Set<string>).add(type);
    result.loops.push(...analysis.loops);
    result.complete &&= analysis.complete;
  }
  result.complete &&= budget.remaining > 0;
  // The same typed component may be reachable in several saved runs.
  const seen = new Set<string>();
  const ids = new Map<string, number>();
  const intern = (value: string) => {
    if (!ids.has(value)) ids.set(value, ids.size);
    return ids.get(value)!;
  };
  result.loops = result.loops.filter((loop) => {
    const key = loop.steps
      .map((s) => [intern(s.edge), intern(s.receives), intern(s.sends)].join(":"))
      .sort()
      .join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return result;
}

function propagateTypes(
  diagram: DiagramFile,
  sources: readonly { node: string; type: string }[] | undefined,
  budget: MessageTypeBudget,
): MessageTypes {
  const arriving = new Map(diagram.nodes.map((n) => [n.id, new Set<string>()]));
  const upstream = new Map(diagram.edges.map((e) => [e.id, new Set<string>()]));
  const carried = new Map(diagram.edges.map((e) => [e.id, new Set<string>()]));
  const nodes = new Map(diagram.nodes.map((n) => [n.id, n]));
  const order = new Map(diagram.nodes.map((n, index) => [n.id, index]));
  const roles = new Map(diagram.nodes.map((n) => [n.id, stencilRole(n.stencil)]));
  const topology = compileTopology(diagram);
  const targetEdges = new Map(topology.edges.filter((edge) => !edge.dlq).map((edge) => [edge.id, edge]));
  const deadLetters = deadLetterRoutes(topology);
  const outgoing = new Map<string, CompiledEdge[]>();
  for (const edge of topology.edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }
  let complete = true;
  const spend = (amount = 1) => {
    budget.remaining -= amount;
    if (budget.remaining < 0) complete = false;
    return complete;
  };
  spend(diagram.nodes.length + diagram.edges.length);
  const known = new Set<string>();
  const typeIds = new Map<string, number>();
  const remember = (value: unknown) => {
    if (typeof value !== "string" || typeIds.has(value)) return;
    // Retain each authored string once. State keys below contain only interned integers.
    if (!spend(1 + Math.ceil(value.length / 16))) return;
    typeIds.set(value, typeIds.size);
    known.add(value);
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
  const routes = compileRoutes(diagram.planning);
  const tables = new Map(
    diagram.nodes.flatMap((node) =>
      routes && node.props?.routeTable !== undefined && routeTableCapable(node.stencil, roles.get(node.id)!)
        ? [[node.id, compileTable(node.props.routeTable)] as const]
        : [],
    ),
  );
  const routeIds = new Map([...(routes?.values() ?? [])].map((route, i) => [route, i + 1]));
  const filters = new Map(
    diagram.edges.map((edge) => [edge.id, routes ? compileFilter(edge.props?.requestFilter) : undefined]),
  );
  const addresses = new Map(
    diagram.edges.flatMap((edge) => {
      const role = roles.get(edge.from);
      return routes &&
        edge.kind === "sync" &&
        (role === "source" || processor(role!)) &&
        typeof edge.props?.requestRouteId === "string"
        ? [[edge.id, routes.get(edge.props.requestRouteId)] as const]
        : [];
    }),
  );
  interface State {
    node: string;
    type: string;
    route?: CompiledRoute;
    sync?: boolean;
    injected?: boolean;
  }
  const queue: State[] = [];
  const states = new Map<string, State>();
  const steps = new Map<string, { step: TypeStep; target: string }[]>();
  const keyOf = (state: State) =>
    `${order.get(state.node)}:${typeIds.get(state.type)}:${routeIds.get(state.route!) ?? 0}:${+!!state.sync}:${+!!state.injected}`;
  const arrive = (state: State) => {
    remember(state.type);
    const key = keyOf(state);
    if (states.has(key) || !spend()) return key;
    if (!(state.injected && roles.get(state.node) === "source")) arriving.get(state.node)!.add(state.type);
    states.set(key, state);
    queue.push(state);
    return key;
  };
  const seed = (node: string, type: string) => {
    if (!nodes.has(node)) return;
    const mix = roles.get(node) === "source" ? compileMix(nodes.get(node)?.props?.trafficMix, routes) : undefined;
    if (mix)
      mix.routes.forEach((route, i) => {
        if (mix.proportions[i] > 0) arrive({ node, type, route, injected: true });
      });
    else arrive({ node, type, injected: true });
  };
  if (sources) for (const input of sources) seed(input.node, input.type);
  else
    for (const node of diagram.nodes)
      if (roles.get(node.id) === "source") seed(node.id, String(node.props?.messageType ?? (node.label || "Message")));
  for (let at = 0; at < queue.length && complete; at++) {
    const item = queue[at];
    const role = roles.get(item.node)!;
    const type = outputType(role, nodes.get(item.node)?.props?.emits, item.type);
    const table = tables.get(item.node);
    const choice = table ? chooseAction(table, item.route, !!item.sync) : undefined;
    const routed = !!choice && !("legacy" in choice);
    const targets =
      choice && "action" in choice
        ? new Set(
            forwardingTargets(
              choice.action.targets,
              (id) => {
                const edge = targetEdges.get(id);
                return edge?.from === item.node ? edge : undefined;
              },
              (edge) => forwardingShare(role, edge, type, "routed", filters.get(edge.id), item.route) > 0,
            ).eligible.map((edge) => edge.id),
          )
        : undefined;
    for (const edge of outgoing.get(item.node) ?? []) {
      if (!spend()) break;
      upstream.get(edge.id)!.add(type);
      if (edge.deny || (edge.dlq && (processor(role) || deadLetters.get(edge.from)?.id !== edge.id))) continue;
      if (routed && !targets?.has(edge.id)) continue;
      const route = !routed && addresses.has(edge.id) ? addresses.get(edge.id) : item.route;
      const filter = filters.get(edge.id);
      if (!forwardingShare(role, edge, type, routed ? "routed" : item.injected ? "injected" : "output", filter, route))
        continue;
      const sent = edge.emits ?? type;
      carried.get(edge.id)!.add(sent);
      const target = arrive({ node: edge.to, type: sent, route, sync: !route && edge.sync && !!tables.get(edge.to) });
      if (!item.injected && !edge.dlq && processor(role) && processor(roles.get(edge.to)!)) {
        const key = keyOf(item);
        const list = steps.get(key) ?? [];
        list.push({ target, step: { edge: edge.id, from: item.node, to: edge.to, receives: item.type, sends: sent } });
        steps.set(key, list);
      }
    }
  }
  const targets = new Map([...steps].map(([key, list]) => [key, list.map((s) => s.target)]));
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
      node: first.node,
      type: first.type,
      steps: component.flatMap((id) => (steps.get(id) ?? []).filter((s) => members.has(s.target)).map((s) => s.step)),
    });
  }
  return { arriving, upstream, carried, known, loops, complete };
}
