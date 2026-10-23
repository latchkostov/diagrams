import {
  messageTypesAt,
  messageTypeScenarios,
  messageTypeBudget,
  type MessageLoop,
  type MessageTypes,
  type TypeStep,
  type MessageTypeBudget,
} from "../model/messageTypes";
import type { DiagramFile } from "../model/types";
import { acceptsType, outputType } from "../sim/topology";
import { stencilRole } from "../stencils/roles";
import type { CheckFix } from "./types";

/** One verifier per check run: indexes, candidate results and work budget are shared across every finding. */
export function createMessageLoopFixer(
  diagram: DiagramFile,
  types: MessageTypes,
  budget: MessageTypeBudget = messageTypeBudget(),
): (loop: MessageLoop) => CheckFix | undefined {
  const nodes = new Map(diagram.nodes.map((node) => [node.id, node]));
  const edges = new Map(diagram.edges.map((edge) => [edge.id, edge]));
  const edgeOrder = new Map(diagram.edges.map((edge, index) => [edge.id, index]));
  const ids = new Map<string, number>();
  const intern = (value: string) => {
    if (!ids.has(value)) ids.set(value, ids.size);
    return ids.get(value)!;
  };
  const signature = (step: TypeStep) => `${edgeOrder.get(step.edge)}:${intern(step.receives)}:${intern(step.sends)}`;
  const allCycles = new Set(types.loops.flatMap((entry) => entry.steps.map(signature)));
  const cycleTypes = (analysis: MessageTypes) => {
    const loopingTypes = new Map<string, Set<string>>();
    for (const entry of analysis.loops)
      for (const step of entry.steps) {
        const set = loopingTypes.get(step.edge) ?? new Set();
        set.add(step.sends);
        loopingTypes.set(step.edge, set);
      }
    return loopingTypes;
  };
  let attempts = 24;
  const available = () => budget.remaining > 0 && attempts > 0;
  const scenarios = [...messageTypeScenarios(diagram, budget)];
  let baselines: MessageTypes[] | undefined;
  let baselineCycles: Map<string, Set<string>>[] | undefined;
  const memo = new Map<string, MessageTypes[] | undefined>();
  const analyses = (edgeId: string, patch: Record<string, unknown>) => {
    const key = `${edgeOrder.get(edgeId)}:${JSON.stringify(Object.entries(patch).map(([key, value]) => [key, Array.isArray(value) ? value.map(intern) : intern(String(value))]))}`;
    if (memo.has(key)) return memo.get(key);
    if (!available()) return;
    attempts--;
    baselines ??= scenarios.map((scenario) =>
      scenarios.length === 1 ? types : messageTypesAt(scenario.diagram, scenario.sources, budget),
    );
    if (baselines.some((baseline) => !baseline.complete) || budget.remaining <= 0) return;
    baselineCycles ??= baselines.map(cycleTypes);
    const after: MessageTypes[] = [];
    for (const scenario of scenarios) {
      if (budget.remaining <= 0) break;
      after.push(
        messageTypesAt(
          {
            ...scenario.diagram,
            edges: scenario.diagram.edges.map((edge) =>
              edge.id === edgeId ? { ...edge, props: { ...edge.props, ...patch } } : edge,
            ),
          },
          scenario.sources,
          budget,
        ),
      );
    }
    const result = after.length === scenarios.length && after.every((a) => a.complete) ? after : undefined;
    memo.set(key, result);
    return result;
  };
  return (loop) => {
    if (!types.complete || !available() || loop.type.length > 256) return;
    // Runtime forwarding edits need temporal proof; a static candidate cannot establish preservation for them.
    if (diagram.simulations?.some((sim) => sim.timeline?.some(({ action }) => action.do === "props"))) return;
    const onLoop = new Set(loop.steps.map(signature));
    const verified = (edgeId: string, patch: Record<string, unknown>) => {
      const after = analyses(edgeId, patch);
      if (!after) return false;
      for (const [index, analysis] of after.entries()) {
        // SCC counts can shrink when a rename merges loops. Every remaining typed cyclic transition must
        // already exist somewhere in the original graph, and none may belong to the targeted component.
        for (const entry of analysis.loops)
          for (const step of entry.steps) {
            if (--budget.remaining <= 0) return false;
            const key = signature(step);
            if (!allCycles.has(key) || onLoop.has(key)) return false;
          }
        for (const [id, carried] of baselines![index].carried)
          for (const type of carried) {
            if (--budget.remaining <= 0) return false;
            if (!baselineCycles![index].get(id)?.has(type) && !analysis.carried.get(id)?.has(type)) return false;
          }
      }
      return true;
    };
    const blocked = new Map<string, Set<string>>();
    for (const step of loop.steps) {
      const set = blocked.get(step.edge) ?? new Set();
      set.add(
        outputType(stencilRole(nodes.get(step.from)!.stencil), nodes.get(step.from)?.props?.emits, step.receives),
      );
      blocked.set(step.edge, set);
    }
    const candidates = [...blocked]
      .map(([id, remove]) => {
        const edge = edges.get(id)!;
        const current = [...(types.upstream.get(id) ?? [])].filter((type) => acceptsType(edge.props?.filter, type));
        return { id, allowed: current.filter((type) => !remove.has(type)), cost: remove.size };
      })
      .filter((entry) => entry.allowed.length && entry.id.length <= 200)
      .sort(
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
      let newType = `${loop.type}Received`;
      for (let i = 2; types.known.has(newType); i++) newType = `${loop.type}Received${i}`;
      for (const id of blocked.keys()) {
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
