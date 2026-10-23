import type { DiagramFile, DiagramNode, SimRole } from "./types";
import {
  compileTopology,
  compileTypeFilter,
  forwardingFraction,
  forwardingTargets,
  forwardsFrom,
  outputType,
  deadLetterRoutes,
  typeFilterAccepts,
  type CompiledEdge,
  type ForwardingMode,
  type TypeFilter,
} from "../sim/topology";
import {
  compileRoutes,
  compileMix,
  compileTable,
  compileFilter,
  chooseAction,
  matchesRequest,
  type CompiledMatch,
  type CompiledRoute,
  type CompiledTable,
  type RouteChoice,
} from "../sim/routeMatching";
import { configuredDiagram } from "../sim/simulationSetup";
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
export const messageTypeBudget = (limit = MESSAGE_TYPE_WORK_LIMIT): MessageTypeBudget => ({ remaining: limit });

/** Type names interned once per comparison session, so analyses of edited diagrams share state identities. */
export interface TypeTable {
  ids: Map<string, number>;
  names: string[];
}
export const typeTable = (): TypeTable => ({ ids: new Map(), names: [] });

/**
 * One run's typed state graph. A state is a node, a type and the routing context playback keeps with a message:
 * its request route, whether it is an unaddressed request into a router, and whether it was injected there.
 * Keys are `context|type id`, comparable between analyses that share a TypeTable and the same nodes, edges and
 * request routes (a fix edits only an edge's properties).
 */
export interface TypeGraph {
  states: string[];
  contexts: string[];
  types: number[];
  seeds: number[];
  /** Transition i: from states[from[i]] along the diagram's edges[edge[i]] to states[to[i]]. */
  edge: number[];
  from: number[];
  to: number[];
  /** The type that left the node before the edge's filter and rename. */
  output: number[];
  /** Transitions inside a message loop (a processor cycle's strongly connected component). */
  cyclic: Set<number>;
}

export interface MessageTypeOptions {
  /** Shared by analyses whose graphs are compared. */
  table?: TypeTable;
  /** Receives each analyzed run's graph: free play, then each saved simulation in order. */
  graphs?: TypeGraph[];
}

interface MessageScenario {
  diagram: DiagramFile;
  sources?: { node: string; type: string }[];
}

const processor = (role: SimRole) => role === "processor" || role === "none";
/** The type a node's own traffic carries, as the engine resolves it (src/sim/defaults.ts). */
const ownType = (node: DiagramNode | undefined) =>
  typeof node?.props?.messageType === "string" ? node.props.messageType : node?.label || "Message";

/**
 * Free play, then each saved simulation configured exactly as playback configures it (configuredDiagram): edits to
 * `diagram` come first and the run's overrides after. Each run is analyzed alone: never invent a path by mixing
 * simulation configurations.
 */
function messageTypeScenarios(diagram: DiagramFile, budget?: MessageTypeBudget): MessageScenario[] {
  const scenarios: MessageScenario[] = [{ diagram: { ...diagram, simulations: undefined } }];
  for (const sim of diagram.simulations ?? []) {
    if (budget) {
      budget.remaining -=
        diagram.nodes.length + diagram.edges.length + sim.traffic.length + (sim.timeline?.length ?? 0);
      if (budget.remaining <= 0) break;
    }
    const configured = configuredDiagram(diagram, sim);
    const nodes = new Map(configured.nodes.map((node) => [node.id, node]));
    const inputs = [
      ...sim.traffic,
      ...(sim.timeline ?? []).flatMap(({ action }) => (action.do === "inject" ? [action] : [])),
    ];
    scenarios.push({
      diagram: configured,
      sources: inputs.map((input) => ({
        node: input.node,
        type: String(input.messageType ?? ownType(nodes.get(input.node))),
      })),
    });
  }
  return scenarios;
}

/** Finite monotone fixed point. All scenarios share a work/allocation budget, including authored vocabulary. */
export function messageTypesAt(
  diagram: DiagramFile,
  sources?: readonly { node: string; type: string }[],
  budget = messageTypeBudget(),
  options: MessageTypeOptions = {},
): MessageTypes {
  const table = options.table ?? typeTable();
  if (sources || !diagram.simulations?.length) return propagateTypes(diagram, sources, budget, table, options.graphs);
  const analyses: MessageTypes[] = [];
  for (const scenario of messageTypeScenarios(diagram, budget)) {
    if (budget.remaining <= 0) break;
    analyses.push(propagateTypes(scenario.diagram, scenario.sources, budget, table, options.graphs));
  }
  const result = analyses[0];
  if (!result) return propagateTypes({ ...diagram, simulations: undefined }, [], budget, table);
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

/** Predicates a request filter or rule evaluates: what matching it costs. */
const matchCost = (match: CompiledMatch | undefined) =>
  1 +
  (match?.methods?.length ?? 0) +
  (match?.segments?.length ?? 0) +
  (match?.hosts?.length ?? 0) +
  (match?.headers?.length ?? 0) +
  (match?.query?.length ?? 0);

function propagateTypes(
  diagram: DiagramFile,
  sources: readonly { node: string; type: string }[] | undefined,
  budget: MessageTypeBudget,
  table: TypeTable,
  graphs?: TypeGraph[],
): MessageTypes {
  const arriving = new Map(diagram.nodes.map((n) => [n.id, new Set<string>()]));
  const upstream = new Map(diagram.edges.map((e) => [e.id, new Set<string>()]));
  const carried = new Map(diagram.edges.map((e) => [e.id, new Set<string>()]));
  const nodes = new Map(diagram.nodes.map((n) => [n.id, n]));
  const order = new Map(diagram.nodes.map((n, index) => [n.id, index]));
  const edgeOrder = new Map(diagram.edges.map((e, index) => [e.id, index]));
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
  // Every step below that grows with authored input (names, patterns, rules, states, transitions) spends here.
  const spend = (amount = 1) => {
    budget.remaining -= amount;
    if (budget.remaining < 0) complete = false;
    return complete;
  };
  spend(diagram.nodes.length + diagram.edges.length);
  const known = new Set<string>();
  const remember = (value: unknown) => {
    if (typeof value !== "string" || known.has(value)) return;
    if (!table.ids.has(value)) {
      // Retain each authored string once. State keys below contain only interned integers.
      if (!spend(1 + Math.ceil(value.length / 16))) return;
      table.ids.set(value, table.names.length);
      table.names.push(value);
    } else if (!spend()) return;
    known.add(value);
  };
  for (const node of diagram.nodes) {
    if (roles.get(node.id) === "source") remember(ownType(node));
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
  // Type filters compile once per analysis, wildcard patterns included, and every check below is charged.
  const typeFilters = new Map<string, TypeFilter>();
  for (const edge of topology.edges) {
    if (!edge.filter) continue;
    // Refuse before allocating when the patterns alone exceed what is left.
    if (budget.remaining < edge.filter.length) {
      spend(edge.filter.length);
      continue;
    }
    const compiled = compileTypeFilter(edge.filter);
    if (spend(compiled.cost)) typeFilters.set(edge.id, compiled);
  }
  const typeChecks = new Map<string, Map<number, boolean>>();
  const typeAccepted = (edge: CompiledEdge, type: string, typeId: number): boolean => {
    if (!edge.filter) return true;
    const filter = typeFilters.get(edge.id);
    if (!filter) return false;
    let checks = typeChecks.get(edge.id);
    const cached = checks?.get(typeId);
    if (cached !== undefined) return cached;
    const accepted = typeFilterAccepts(filter, type, spend);
    if (accepted === undefined) return false;
    if (!checks) typeChecks.set(edge.id, (checks = new Map()));
    checks.set(typeId, accepted);
    return accepted;
  };
  const routes = compileRoutes(diagram.planning);
  const tables = new Map<string, CompiledTable | undefined>();
  const tableCost = new Map<string, number>();
  for (const node of diagram.nodes) {
    if (!routes || node.props?.routeTable === undefined || !routeTableCapable(node.stencil, roles.get(node.id)!))
      continue;
    const compiled = compileTable(node.props.routeTable);
    const cost =
      1 + (compiled?.rules.reduce((sum, rule) => sum + matchCost(rule.match) + rule.action.targets.length, 0) ?? 0);
    spend(cost);
    tables.set(node.id, compiled);
    tableCost.set(node.id, cost);
  }
  const routeIds = new Map([...(routes?.values() ?? [])].map((route, i) => [route, i + 1]));
  const filters = new Map(
    diagram.edges.map((edge) => {
      const filter = routes ? compileFilter(edge.props?.requestFilter) : undefined;
      spend(matchCost(filter));
      return [edge.id, filter] as const;
    }),
  );
  const requestChecks = new Map<string, Map<number, boolean>>();
  const requestAccepted = (edgeId: string, route: CompiledRoute | undefined): boolean => {
    const filter = filters.get(edgeId);
    if (!filter) return true;
    const id = routeIds.get(route!) ?? 0;
    let checks = requestChecks.get(edgeId);
    const cached = checks?.get(id);
    if (cached !== undefined) return cached;
    if (!spend(matchCost(filter))) return false;
    const accepted = matchesRequest(filter, route);
    if (!checks) requestChecks.set(edgeId, (checks = new Map()));
    checks.set(id, accepted);
    return accepted;
  };
  const choices = new Map<string, RouteChoice>();
  const choose = (node: string, compiled: CompiledTable, route: CompiledRoute | undefined, sync: boolean) => {
    const key = `${order.get(node)}:${routeIds.get(route!) ?? 0}:${+sync}`;
    let choice = choices.get(key);
    if (!choice) {
      spend(tableCost.get(node));
      choices.set(key, (choice = chooseAction(compiled, route, sync)));
    }
    return choice;
  };
  // forwardingShare's decision, composed from the same steps with each filter check budgeted and memoized.
  const share = (
    role: SimRole,
    edge: CompiledEdge,
    type: string,
    typeId: number,
    mode: ForwardingMode,
    route: CompiledRoute | undefined,
  ) =>
    forwardsFrom(role, edge, mode) && typeAccepted(edge, type, typeId) && requestAccepted(edge.id, route)
      ? forwardingFraction(role, edge, mode)
      : 0;
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
    key: string;
    index: number;
    node: string;
    type: string;
    typeId: number;
    route?: CompiledRoute;
    sync: boolean;
    injected: boolean;
  }
  const graph: TypeGraph | undefined = graphs && {
    states: [],
    contexts: [],
    types: [],
    seeds: [],
    edge: [],
    from: [],
    to: [],
    output: [],
    cyclic: new Set(),
  };
  const queue: State[] = [];
  const states = new Map<string, State>();
  const steps = new Map<string, { step: TypeStep; target: string; transition: number }[]>();
  let stepCount = 0;
  const arrive = (node: string, type: string, route: CompiledRoute | undefined, sync: boolean, injected: boolean) => {
    remember(type);
    const typeId = table.ids.get(type);
    if (typeId === undefined) return undefined;
    const context = `${order.get(node)}:${routeIds.get(route!) ?? 0}:${+sync}:${+injected}`;
    const key = `${context}|${typeId}`;
    const existing = states.get(key);
    if (existing || !spend()) return existing;
    if (!(injected && roles.get(node) === "source")) arriving.get(node)!.add(type);
    const state: State = { key, index: states.size, node, type, typeId, route, sync, injected };
    states.set(key, state);
    queue.push(state);
    if (graph) {
      graph.states.push(key);
      graph.contexts.push(context);
      graph.types.push(typeId);
    }
    return state;
  };
  const seed = (node: string, type: string) => {
    if (!nodes.has(node)) return;
    const mix = roles.get(node) === "source" ? compileMix(nodes.get(node)?.props?.trafficMix, routes) : undefined;
    const routesOut = mix ? mix.routes.filter((_, i) => mix.proportions[i] > 0) : [undefined];
    for (const route of routesOut) {
      const state = arrive(node, type, route, false, true);
      if (state) graph?.seeds.push(state.index);
    }
  };
  if (sources) for (const input of sources) seed(input.node, input.type);
  else for (const node of diagram.nodes) if (roles.get(node.id) === "source") seed(node.id, ownType(node));
  for (let at = 0; at < queue.length && complete; at++) {
    const item = queue[at];
    const role = roles.get(item.node)!;
    const type = outputType(role, nodes.get(item.node)?.props?.emits, item.type);
    remember(type);
    const typeId = table.ids.get(type);
    if (typeId === undefined) break;
    const compiled = tables.get(item.node);
    const choice = compiled ? choose(item.node, compiled, item.route, item.sync) : undefined;
    const routed = !!choice && !("legacy" in choice);
    let targets: Set<string> | undefined;
    if (choice && "action" in choice) {
      spend(choice.action.targets.length);
      targets = new Set(
        forwardingTargets(
          choice.action.targets,
          (id) => {
            const edge = targetEdges.get(id);
            return edge?.from === item.node ? edge : undefined;
          },
          (edge) => share(role, edge, type, typeId, "routed", item.route) > 0,
        ).eligible.map((edge) => edge.id),
      );
    }
    for (const edge of outgoing.get(item.node) ?? []) {
      if (!spend()) break;
      upstream.get(edge.id)!.add(type);
      if (edge.deny || (edge.dlq && (processor(role) || deadLetters.get(edge.from)?.id !== edge.id))) continue;
      if (routed && !targets?.has(edge.id)) continue;
      const route = !routed && addresses.has(edge.id) ? addresses.get(edge.id) : item.route;
      if (!share(role, edge, type, typeId, routed ? "routed" : item.injected ? "injected" : "output", route)) continue;
      const sent = edge.emits ?? type;
      carried.get(edge.id)!.add(sent);
      const target = arrive(edge.to, sent, route, !route && edge.sync && !!tables.get(edge.to), false);
      if (!target) continue;
      const transition = graph ? graph.edge.length : -1;
      if (graph) {
        graph.edge.push(edgeOrder.get(edge.id)!);
        graph.from.push(item.index);
        graph.to.push(target.index);
        graph.output.push(typeId);
      }
      if (!item.injected && !edge.dlq && processor(role) && processor(roles.get(edge.to)!)) {
        const list = steps.get(item.key) ?? [];
        list.push({
          target: target.key,
          transition,
          step: { edge: edge.id, from: item.node, to: edge.to, receives: item.type, sends: sent },
        });
        steps.set(item.key, list);
        stepCount++;
      }
    }
  }
  // Tarjan's linear pass over the states and processor steps.
  spend(states.size + stepCount);
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
    const inside = component.flatMap((id) => (steps.get(id) ?? []).filter((s) => members.has(s.target)));
    if (graph) for (const s of inside) graph.cyclic.add(s.transition);
    loops.push({ node: first.node, type: first.type, steps: inside.map((s) => s.step) });
  }
  graphs?.push(graph!);
  return { arriving, upstream, carried, known, loops, complete };
}
