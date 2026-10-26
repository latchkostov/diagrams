import type { DiagramFile } from "../model/types";
import { emitsMapping, validRule } from "../model/emitsMapping";
import type { LiveState } from "../live/controller";
import { stencilRole } from "../stencils/roles";
import { edgeSemanticSignature, isDependency } from "../model/relations";
import { iterationBound } from "../sim/iterationBound";

/** Planning has a fixed input/work ceiling, checked BEFORE serializing or compiling (planning/budget.ts), and
 * before any synchronous analysis outside it (the live hover's waiting details).
 * The routing solver runs at most 256 iterations; broker allocation includes quadratic scans
 * and type-compatible flow graphs. Conservative worst-case estimates include those passes
 * and sizing verification. Larger graphs can still be edited and played. */
export const MAX_PLANNING_WORK = 2_000_000;
const MAX_ITEMS = 4096;
const MAX_TEXT = 64_000;

// Rule IDs are identity metadata: wherever props live (diagram, live configuration, inputs, saved setup),
// budget and plan the behavioral mapping only. Untouched props keep their object.
type Props = Record<string, unknown> | undefined;
const behavioral = (props: Props): Props =>
  Array.isArray(props?.emits) ? { ...props, emits: emitsMapping(props.emits) } : props;
const byNode = (props?: Record<string, Props>) =>
  props && Object.fromEntries(Object.entries(props).map(([id, p]) => [id, behavioral(p)]));

/**
 * The input a plan of `d` (with the live `state`) is computed from, when it is within the input and work ceilings;
 * undefined when it isn't. Cheap and bounded: it stops reading at the caps. The one source of the limits.
 */
export function planningInput(d: DiagramFile, state?: LiveState | null): unknown[] | undefined {
  if (d.nodes.length > 256 || d.edges.length > 512) return undefined;
  // Bound authored lists BEFORE making lookup tables. Duplicate types and invalid rows also cost work,
  // even though the behavioral mapping collapses or drops them. IDs remain outside the text budget.
  let rows = 0,
    characters = 0;
  const canMap = (props: Props): boolean => {
    const emits = props?.emits;
    if (!Array.isArray(emits)) return true;
    rows += emits.length;
    if (rows > MAX_ITEMS) return false;
    for (const rule of emits) {
      if (validRule(rule)) characters += rule.receives.length + rule.sends.length;
      if (characters > MAX_TEXT) return false;
    }
    return true;
  };
  for (const node of d.nodes) if (!canMap(node.props)) return undefined;
  for (const props of [state?.running?.setup?.props, state?.inputs?.props, state?.configuration])
    if (props) for (const id in props) if (!canMap(props[id])) return undefined;
  const nodes = new Map(d.nodes.map((node) => [node.id, node]));
  const setup = state?.running?.setup;
  const config = [
    d.planning,
    d.nodes.map((n) => [n.id, n.stencil, n.label, n.sublabel, behavioral(n.props)]),
    d.edges.map(edgeSemanticSignature),
    state?.running && [
      state.running.traffic,
      state.running.multipliers,
      setup && { ...setup, props: byNode(setup.props) },
    ],
    state?.inputs && { ...state.inputs, props: byNode(state.inputs.props) },
    byNode(state?.configuration),
  ];
  // Bound strings, nested property maps and type cardinality too. Stop reading at the cap.
  let items = 0,
    text = 0;
  const types = new Set<string>();
  const visit = (value: unknown, depth = 0): boolean => {
    if (++items > MAX_ITEMS || depth > 16) return false;
    if (typeof value === "string") {
      text += value.length;
      return text <= MAX_TEXT;
    }
    if (value && typeof value === "object") {
      for (const key in value) {
        text += key.length;
        if (text > MAX_TEXT || !visit((value as Record<string, unknown>)[key], depth + 1)) return false;
      }
    }
    return true;
  };
  if (!visit(config)) return undefined;
  const collect = (props: Record<string, unknown> | undefined, label?: string) => {
    if (label) types.add(label);
    for (const value of [props?.messageType, emitsMapping(props?.emits)]) {
      if (typeof value === "string") types.add(value);
      else if (value && typeof value === "object")
        for (const name of Object.values(value)) if (typeof name === "string") types.add(name);
    }
  };
  for (const n of d.nodes)
    collect(
      { ...n.props, ...state?.running?.setup?.props?.[n.id], ...state?.configuration[n.id] },
      stencilRole(n.stencil) === "source" ? n.label : undefined,
    );
  for (const e of d.edges) collect(e.props);
  for (const traffic of state?.running?.traffic ?? [])
    types.add(traffic.messageType ?? nodes.get(traffic.node)?.label ?? "Message");
  const count = Math.max(1, types.size);
  const degrees = new Map<string, number>();
  for (const edge of d.edges) degrees.set(edge.from, (degrees.get(edge.from) ?? 0) + 1);
  const squares = [...degrees.values()].reduce((sum, n) => sum + n * n, 0);
  const flowWork = d.nodes.reduce((sum, node) => {
    const role = stencilRole(node.stencil);
    const degree = degrees.get(node.id) ?? 0;
    return sum + (role === "topic" || role === "stream" || role === "queue" ? degree ** 2 * (degree + count) : 0);
  }, 0);
  // Wildcard prefix comparisons cost characters as well as route visits.
  const comparisons = [...types].map((type) => type.length);
  for (const edge of d.edges)
    if (Array.isArray(edge.props?.filter))
      for (const pattern of edge.props.filter) if (typeof pattern === "string") comparisons.push(pattern.length);
  const comparisonCharacters = Math.max(1, ...comparisons);
  const filters = d.edges.reduce(
    (sum, edge) => sum + (Array.isArray(edge.props?.filter) ? edge.props.filter.length : 0),
    0,
  );
  // 3 passes covers initial analysis and the sizing verifier's candidate analyses.
  const iterations = iterationBound(
    nodes.keys(),
    d.edges.filter((edge) => !isDependency(edge)),
  );
  const work =
    3 *
    comparisonCharacters *
    (iterations * count * (d.nodes.length + d.edges.length + squares + filters) + count ** 3 * flowWork);
  return work > MAX_PLANNING_WORK ? undefined : config;
}

/** Whether a plan of `d` is within the ceilings, so synchronous analysis of it is affordable. */
export const withinPlanningBudget = (d: DiagramFile, state?: LiveState | null): boolean =>
  planningInput(d, state) !== undefined;
