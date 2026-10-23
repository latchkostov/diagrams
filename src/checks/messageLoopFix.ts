import { messageTypesAt, type MessageLoop, type MessageTypes, type TypeStep } from "../model/messageTypes";
import type { DiagramFile } from "../model/types";
import { acceptsType, emittedType } from "../sim/topology";
import type { CheckFix } from "./types";

const signature = (step: TypeStep) => JSON.stringify([step.edge, step.receives, step.sends]);

/** Cheap candidates first; every offered edit is confirmed by the shared fixed point. */
export function messageLoopFix(diagram: DiagramFile, types: MessageTypes, loop: MessageLoop): CheckFix | undefined {
  if (!types.complete) return;
  const nodes = new Map(diagram.nodes.map((node) => [node.id, node]));
  const edges = new Map(diagram.edges.map((edge) => [edge.id, edge]));
  const edgeOrder = new Map(diagram.edges.map((edge, index) => [edge.id, index]));
  const onLoop = new Set(loop.steps.map(signature));
  const loopingTypes = new Map<string, Set<string>>();
  for (const entry of types.loops)
    for (const step of entry.steps) {
      const set = loopingTypes.get(step.edge) ?? new Set();
      set.add(step.sends);
      loopingTypes.set(step.edge, set);
    }
  const verified = (edgeId: string, patch: Record<string, unknown>) => {
    const after = messageTypesAt({
      ...diagram,
      edges: diagram.edges.map((edge) => (edge.id === edgeId ? { ...edge, props: { ...edge.props, ...patch } } : edge)),
    });
    if (
      !after.complete ||
      after.loops.length >= types.loops.length ||
      after.loops.some((entry) => entry.steps.some((step) => onLoop.has(signature(step))))
    )
      return false;
    // A filter may remove looping traffic, but must keep every carried type on the other paths.
    for (const [id, carried] of types.carried)
      for (const type of carried)
        if (!loopingTypes.get(id)?.has(type) && !after.carried.get(id)?.has(type)) return false;
    return true;
  };
  const blocked = new Map<string, Set<string>>();
  for (const step of loop.steps) {
    const set = blocked.get(step.edge) ?? new Set();
    set.add(emittedType(nodes.get(step.from)?.props?.emits, step.receives));
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
  for (const candidate of candidates.slice(0, 24)) {
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
    for (const id of [...blocked.keys()].slice(0, 24)) {
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
    return fix;
  }
}
