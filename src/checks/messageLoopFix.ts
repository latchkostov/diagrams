import {
  messageTypesAt,
  messageTypeBudget,
  typeTable,
  type MessageLoop,
  type MessageTypes,
  type MessageTypeBudget,
  type TypeGraph,
  type TypeTable,
} from "../model/messageTypes";
import type { DiagramFile } from "../model/types";
import { compileTypeFilter, typeFilterAccepts } from "../model/typeFilter";
import type { CheckFix } from "./types";

interface Baseline {
  graph: TypeGraph;
  /** Transitions inside a loop, by `edge>from state>to state`. */
  cyclic: Set<string>;
  /**
   * Legitimate traffic: every transition that doesn't go round a loop. The graph holds only states reachable from
   * the run's inputs, so this includes exits and branches that leave a loop's component: a message's first pass
   * through a cycle delivers there before it ever comes back.
   */
  required: number[];
}

/**
 * One verifier per check run. Candidates are proven on exactly what playback runs: each one edits the base diagram,
 * then every saved simulation applies its own overrides to the edited diagram (configuredDiagram), with request
 * routes and routing context kept in every state. Indexes, baselines, candidate results and one work budget are
 * shared across all findings; when the budget runs out, findings stay and only their fixes are dropped.
 */
export function createMessageLoopFixer(
  diagram: DiagramFile,
  types: MessageTypes,
  budget: MessageTypeBudget = messageTypeBudget(),
  /** The graphs `types` was computed with (CheckContext.messageGraphs): reused, never recomputed. */
  analyzed?: { table: TypeTable; graphs: readonly TypeGraph[] },
): (loops: readonly MessageLoop[]) => CheckFix | undefined {
  const edges = new Map(diagram.edges.map((edge) => [edge.id, edge]));
  const edgeOrder = new Map(diagram.edges.map((edge, index) => [edge.id, index]));
  const table = analyzed?.table ?? typeTable();
  const spend = (amount = 1) => (budget.remaining -= amount) > 0;
  let attempts = 24;
  const available = () => budget.remaining > 0 && attempts > 0;
  const key = (graph: TypeGraph, t: number) =>
    `${graph.edge[t]}>${graph.states[graph.from[t]]}>${graph.states[graph.to[t]]}`;
  const typed = (graph: TypeGraph, t: number) =>
    `${graph.edge[t]}:${graph.types[graph.from[t]]}:${graph.types[graph.to[t]]}`;

  let baselines: Baseline[] | null | undefined;
  const baseline = (): Baseline[] | null => {
    if (baselines !== undefined) return baselines;
    let graphs = analyzed?.graphs;
    if (!graphs) {
      const fresh: TypeGraph[] = [];
      if (!messageTypesAt(diagram, undefined, budget, { table, graphs: fresh }).complete) return (baselines = null);
      graphs = fresh;
    }
    if (budget.remaining <= 0) return (baselines = null);
    const result: Baseline[] = [];
    for (const graph of graphs) {
      if (!spend(2 * graph.edge.length)) return (baselines = null);
      const cyclic = new Set<string>();
      const required: number[] = [];
      for (let t = 0; t < graph.edge.length; t++)
        if (graph.cyclic.has(t)) cyclic.add(key(graph, t));
        else required.push(t);
      result.push({ graph, cyclic, required });
    }
    return (baselines = result);
  };

  const ids = new Map<string, number>();
  const intern = (value: string) => {
    if (!ids.has(value)) ids.set(value, ids.size);
    return ids.get(value)!;
  };
  const memo = new Map<string, TypeGraph[] | null>();
  /** Every run's graph after the candidate edit, or null when the edit could not be analyzed completely. */
  const analyze = (edgeId: string, patch: { filter: string[] } | { emits: string }) => {
    const id = `${edgeOrder.get(edgeId)}:${"filter" in patch ? patch.filter.map(intern).join(",") : `=${intern(patch.emits)}`}`;
    if (memo.has(id)) return memo.get(id)!;
    if (!available()) return null;
    attempts--;
    const edited: DiagramFile = {
      ...diagram,
      edges: diagram.edges.map((edge) => (edge.id === edgeId ? { ...edge, props: { ...edge.props, ...patch } } : edge)),
    };
    const graphs: TypeGraph[] = [];
    const analysis = messageTypesAt(edited, undefined, budget, { table, graphs });
    const result = analysis.complete && budget.remaining > 0 && graphs.length === baselines!.length ? graphs : null;
    memo.set(id, result);
    return result;
  };

  return (loops) => {
    if (!types.complete || !available() || !loops.length || loops.some((loop) => loop.type.length > 256)) return;
    // Runtime forwarding edits need temporal proof; a static candidate cannot establish preservation for them.
    if (diagram.simulations?.some((sim) => sim.timeline?.some(({ action }) => action.do === "props"))) return;
    const base = baseline();
    if (!base) return;
    // The finding is every loop reported at its node: a fix must stop all of them, in every run.
    const target = new Set<string>();
    for (const loop of loops)
      for (const step of loop.steps)
        target.add(`${edgeOrder.get(step.edge)}:${table.ids.get(step.receives)}:${table.ids.get(step.sends)}`);
    const blocked = new Map<number, Set<number>>();
    const looping: Set<number>[] = [];
    for (const { graph } of base) {
      if (!spend(graph.cyclic.size)) return;
      const states = new Set<number>();
      for (const t of graph.cyclic) {
        if (!target.has(typed(graph, t))) continue;
        const set = blocked.get(graph.edge[t]) ?? new Set();
        set.add(graph.output[t]);
        blocked.set(graph.edge[t], set);
        states.add(graph.from[t]);
        states.add(graph.to[t]);
      }
      looping.push(states);
    }
    const loopEdges = [...blocked.keys()].sort((a, b) => a - b).map((index) => diagram.edges[index].id);

    const verified = (edgeId: string, patch: { filter: string[] } | { emits: string }) => {
      const after = analyze(edgeId, patch);
      if (!after) return false;
      const renamed = "emits" in patch ? table.ids.get(patch.emits) : undefined;
      const edgeIndex = edgeOrder.get(edgeId)!;
      for (const [i, graph] of after.entries()) {
        const { graph: before, cyclic, required } = base[i];
        if (!spend(2 * graph.edge.length + 4 * required.length)) return false;
        const present = new Set<string>();
        for (let t = 0; t < graph.edge.length; t++) {
          present.add(key(graph, t));
          // No new loop (a merged or renamed one included), and nothing left of the finding's loops.
          if (graph.cyclic.has(t) && (!cyclic.has(key(graph, t)) || target.has(typed(graph, t)))) return false;
        }
        // A rename stands for what crossed its edge only into the finding's loops: that traffic keeps its paths
        // under the new name. Anything else that crossed the edge must keep its own name.
        let alias: Set<number> | undefined;
        if (renamed !== undefined) {
          alias = new Set();
          const kept = new Set<number>();
          for (let t = 0; t < before.edge.length; t++)
            if (before.edge[t] === edgeIndex)
              (looping[i].has(before.to[t]) ? alias : kept).add(before.types[before.to[t]]);
          for (const type of kept) alias.delete(type);
        }
        for (const t of required) {
          if (present.has(key(before, t))) continue;
          if (!alias) return false;
          const names = (state: number) =>
            alias!.has(before.types[state])
              ? [before.states[state], `${before.contexts[state]}|${renamed}`]
              : [before.states[state]];
          const to = names(before.to[t]);
          if (
            !names(before.from[t]).some((from) => to.some((into) => present.has(`${before.edge[t]}>${from}>${into}`)))
          )
            return false;
        }
      }
      return true;
    };

    const candidates: { id: string; allowed: string[]; cost: number }[] = [];
    for (const index of [...blocked.keys()].sort((a, b) => a - b)) {
      const id = diagram.edges[index].id;
      const remove = new Set([...blocked.get(index)!].map((type) => table.names[type]));
      const raw = edges.get(id)?.props?.filter;
      const filter = Array.isArray(raw) ? compileTypeFilter(raw) : undefined;
      if (filter && !spend(filter.cost)) return;
      const allowed: string[] = [];
      for (const type of types.upstream.get(id) ?? []) {
        const accepted = filter ? typeFilterAccepts(filter, type, spend) : true;
        if (accepted === undefined) return;
        if (accepted && !remove.has(type)) allowed.push(type);
      }
      if (allowed.length && id.length <= 200) candidates.push({ id, allowed, cost: remove.size });
    }
    candidates.sort(
      (a, b) => a.cost - b.cost || a.allowed.length - b.allowed.length || edgeOrder.get(a.id)! - edgeOrder.get(b.id)!,
    );
    // Checking a dense, adversarial component never triggers unbounded candidate replays.
    for (const candidate of candidates) {
      if (!available()) return;
      if (!verified(candidate.id, { filter: candidate.allowed })) continue;
      const fix: CheckFix = {
        label: `Only pass ${candidate.allowed.join(", ")}`,
        messageLabel: { kind: "filter", types: candidate.allowed },
        ops: [{ op: "update", target: candidate.id, props: { filter: candidate.allowed } }],
      };
      // A rename is useful only when an existing downstream filter stops the new type. An unfiltered
      // cycle would simply circulate NewType too, so it never gets a misleading option chip.
      let newType = `${loops[0].type}Received`;
      for (let i = 2; types.known.has(newType); i++) newType = `${loops[0].type}Received${i}`;
      for (const id of loopEdges) {
        if (!available()) break;
        if (id.length > 200 || !verified(id, { emits: newType })) continue;
        fix.options = [
          {
            label: `Send as ${newType}`,
            short: `Send as ${newType}`,
            messageLabel: { kind: "rename", types: [newType] },
            ops: [{ op: "update", target: id, props: { emits: newType } }],
          },
        ];
        break;
      }
      return budget.remaining > 0 ? fix : undefined;
    }
  };
}
