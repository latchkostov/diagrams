import type { DiagramFile, Simulation } from "../model/types";
import type { EditorApi } from "../editor/types";
import type { LiveUi } from "../live/context";
import { simulationEdges } from "../sim/topology";
import { authoredSimulation } from "./simulations";
import { equal, patchProps } from "./paths";
import type { Demo, LiveInput, PropPatch, RunRef } from "./types";

/**
 * Tutorial repairs: the one place a demo (Skip, a near miss's fix, Continue's reconstruction) changes what Live runs.
 * Design: docs/design-review/2026-10-25-tutorial-repair-api.md.
 *
 * A repair names the props it needs (edit-preserving patches) and the runs that must not override them. It edits the
 * diagram first, as the inspector does outside Live. Then, for each run, it reads the copy the learner is working on:
 * an unsaved draft of that run when Live has one (the Simulations panel's Run without Save), the saved run otherwise.
 * Only keys that copy still overrides with another value are merged into its own setup, so untouched keys and sparse
 * overrides stay as they are. The result is persisted through the Simulations panel's own commands: Run for a draft
 * (it stays a draft), Save for a saved run (Live replays it with the new definition). With Live off there's no session,
 * so the document is the copy. Nothing here writes Live's state directly.
 *
 * A session write lands on Live's next render. Until the session shows it, the repair says "waiting" without writing
 * again, so a demo retries on Live's next publish and every later repair reads the copy the earlier one made.
 */

/** What a repair edits: a node's or connection's props (and runs' overrides of them), or runs' own settings. */
export type RepairTarget = { node: string } | { edge: string } | { run: true };

export interface RepairRequest {
  target: RepairTarget;
  patches: readonly PropPatch[];
  /** Runs whose own setup must not override the patched values. Required (non-empty) for a run target. */
  runs?: readonly RunRef[];
}

/** The app's own writers: the editor's document edits, and Live's session commands while Live is on. */
export interface RepairPorts {
  editor: Pick<EditorApi, "getDiagram" | "setNodeProps" | "setEdgeProps" | "updateMeta">;
  /** Live's published session (planningHost) while Live is on; null when it's off. */
  live: Pick<LiveUi, "controller" | "simulations" | "draft" | "saveSimulation" | "runDraft" | "editPanelCopy"> | null;
  /** Live is on, though its session may not have published yet. */
  liveOn: boolean;
}

/** done: nothing (more) to change. waiting: written, or not writable yet; ask again once Live republishes. */
export type RepairResult = "done" | "waiting";

/** The copy of a run the learner is working on. */
interface RunCopy {
  sim: Simulation;
  draft: boolean;
}

type Props = Record<string, unknown>;
const isRecord = (v: unknown): v is Props => !!v && typeof v === "object" && !Array.isArray(v);

/** `current` with the keys that differ between `before` and `after`; the same object when none do. */
function mergeDelta(current: Props | undefined, before: Props | undefined, after: Props): Props | undefined {
  const delta = Object.entries(after).filter(([key, value]) => !equal(value, before?.[key]));
  return delta.length ? { ...current, ...Object.fromEntries(delta) } : current;
}

/** A run's own settings with their defaults, as playback reads them. */
const runSettings = (sim: Simulation): Props => ({
  multipliers: { traffic: sim.multipliers?.traffic ?? 1, capacity: sim.multipliers?.capacity ?? 1 },
});

/** `sim` with the patches wherever it still overrides them; the same object when it doesn't. */
export function repairedRun(
  diagram: DiagramFile,
  sim: Simulation,
  target: RepairTarget,
  patches: readonly PropPatch[],
): Simulation {
  if ("run" in target) {
    const before = runSettings(sim);
    const changed = patchProps(before, patches);
    if (!changed || !isRecord(changed.multipliers)) return sim;
    const multipliers = mergeDelta(sim.multipliers, before.multipliers as Props, changed.multipliers);
    return multipliers === sim.multipliers ? sim : { ...sim, multipliers: multipliers as Simulation["multipliers"] };
  }
  if ("node" in target) {
    const node = diagram.nodes.find((n) => n.id === target.node);
    if (!node) return sim;
    const own = sim.setup?.props?.[node.id];
    const before = { ...node.props, ...own };
    const changed = patchProps(before, patches);
    // Keys the run doesn't set follow the (repaired) diagram: merging them would pin them.
    const overridden =
      changed && Object.fromEntries(Object.entries(changed).filter(([key]) => Object.hasOwn(own ?? {}, key)));
    const props = overridden && mergeDelta(own, own, overridden);
    if (!props || props === own) return sim;
    return { ...sim, setup: { ...sim.setup, props: { ...sim.setup?.props, [node.id]: props } } };
  }
  // A connection's run-only settings are its caller's top-level fields (simulationEdges): only those can override.
  const props = simulationEdges(diagram, sim).edges.find((e) => e.id === target.edge)?.props;
  const before = props?.caller as Props | undefined;
  const changed = patchProps(props, patches)?.caller;
  if (!isRecord(changed)) return sim;
  const override = sim.setup?.edges?.[target.edge];
  const own = override?.caller as Props | undefined;
  const fromRun = Object.fromEntries(Object.entries(changed).filter(([key]) => Object.hasOwn(own ?? {}, key)));
  const caller = mergeDelta(own, before, fromRun);
  if (caller === own) return sim;
  return {
    ...sim,
    setup: { ...sim.setup, edges: { ...sim.setup?.edges, [target.edge]: { ...override, caller } } },
  } as Simulation;
}

/**
 * One runner's repairs. Writes a session hasn't shown yet are remembered by run until it does, until that session
 * is gone (Live off, or remounted: what it would have shown went with it), or a reset.
 */
export function createRepairs(authored: readonly Simulation[] = []) {
  // The lesson's definitions, never the learner's saved document or a session's working copy.
  const multipliers = new Map(authored.map((sim) => [sim.id, { ...sim.multipliers }]));
  const pending = new Map<string, { sim: Simulation; session: object }>();

  function resolve(ports: RepairPorts, ref: RunRef): RunCopy | undefined {
    const live = ports.live;
    const id = typeof ref === "string" ? ref : live?.controller.getState().simulation?.id;
    if (!id) return undefined;
    if (live?.draft?.id === id) return { sim: live.draft, draft: true };
    const sim = (live ? live.simulations : (ports.editor.getDiagram().simulations ?? [])).find((s) => s.id === id);
    return sim && { sim, draft: false };
  }

  /** True while the session hasn't shown this run's last write: nothing is read from, or written to, it then. */
  function inFlight(ports: RepairPorts, id: string, copy: RunCopy | undefined) {
    const wrote = pending.get(id);
    if (!wrote) return false;
    if (ports.live?.controller !== wrote.session || (copy && equal(copy.sim, wrote.sim))) {
      pending.delete(id);
      return false;
    }
    return true;
  }

  /** The panel's own command for this copy: Run keeps a draft a draft, Save saves (and ends a draft of that id). */
  function persist(
    ports: RepairPorts,
    copy: RunCopy | undefined,
    next: Simulation,
    how: "keep" | "save",
  ): RepairResult {
    const live = ports.live;
    if (!ports.liveOn) {
      const list = ports.editor.getDiagram().simulations ?? [];
      ports.editor.updateMeta({
        simulations: list.some((s) => s.id === next.id)
          ? list.map((s) => (s.id === next.id ? next : s))
          : [...list, next],
      });
      return "done";
    }
    if (copy?.draft && how === "keep") {
      if (!live?.runDraft) return "waiting";
      live.runDraft(next);
      // Run refused it (an invalid copy): Live says why, and the draft stays the learner's.
      if (!equal(live.controller.getState().simulation, next)) return "done";
    } else {
      if (!live?.saveSimulation) return "waiting";
      if (live.saveSimulation(next) === false) return "done";
    }
    pending.set(next.id, { sim: next, session: live.controller });
    return "waiting";
  }

  function runs(ports: RepairPorts, request: RepairRequest): RepairResult {
    let result: RepairResult = "done";
    for (const ref of request.runs ?? []) {
      if (ports.liveOn && !ports.live) return "waiting";
      const copy = resolve(ports, ref);
      if (copy && inFlight(ports, copy.sim.id, copy)) {
        result = "waiting";
        continue;
      }
      if (!copy) continue;
      const diagram = ports.editor.getDiagram();
      const edit = (sim: Simulation) => repairedRun(diagram, sim, request.target, request.patches);
      // The Simulations panel's working copy of this run gets the same merge, so its Run and Save keep the repair.
      ports.live?.editPanelCopy?.(copy.sim.id, edit);
      const next = edit(copy.sim);
      if (next !== copy.sim && persist(ports, copy, next, "keep") === "waiting") result = "waiting";
    }
    return result;
  }

  return {
    /** The diagram's props first (only what's missing), then each run's own overrides of them. */
    repair(ports: RepairPorts, request: RepairRequest): RepairResult {
      const { editor } = ports;
      const diagram = editor.getDiagram();
      let hasTarget = false;
      if ("node" in request.target) {
        const node = diagram.nodes.find((n) => n.id === (request.target as { node: string }).node);
        hasTarget = !!node;
        const changed = node && patchProps(node.props, request.patches);
        if (node && changed) editor.setNodeProps(node.id, changed);
      } else if ("edge" in request.target) {
        const edge = diagram.edges.find((e) => e.id === (request.target as { edge: string }).edge);
        hasTarget = !!edge;
        const changed = edge && patchProps(edge.props, request.patches);
        if (edge && changed) editor.setEdgeProps(edge.id, changed);
      }
      // Editor writes precede Live's render. A run inheriting these props must
      // not launch against the previous configuration and retain its rejections.
      if (hasTarget && ports.liveOn) {
        const current = ports.live?.controller.currentDiagram;
        const target = request.target;
        const applied =
          "node" in target
            ? current?.nodes.find((n) => n.id === target.node)
            : "edge" in target
              ? current?.edges.find((e) => e.id === target.edge)
              : undefined;
        if (!applied || patchProps(applied.props, request.patches)) return "waiting";
      }
      return runs(ports, request);
    },

    /**
     * Save a simulation as Simulations… does: the learner's copy of that id (an unsaved draft, else the saved one)
     * gains only the Drill steps and expectations it lacks, and is saved. Nothing to do when it's saved complete.
     */
    saveSimulation(ports: RepairPorts, demo: Extract<Demo, { kind: "saveSimulation" }>): RepairResult {
      if (ports.liveOn && !ports.live) return "waiting";
      const copy = resolve(ports, demo.id);
      if (inFlight(ports, demo.id, copy)) return "waiting";
      const diagram = ports.editor.getDiagram();
      const next = authoredSimulation(diagram, copy?.sim, demo);
      ports.live?.editPanelCopy?.(demo.id, (sim) => authoredSimulation(diagram, sim, demo) ?? sim);
      if (!next && !copy?.draft) return "done";
      return persist(ports, copy, next ?? copy!.sim, "save");
    },

    /** Before a reference replay: restore the lesson's authored multipliers wherever the run is kept. */
    reference(ports: RepairPorts, run: string): RepairResult {
      const original = multipliers.get(run);
      return runs(ports, {
        target: { run: true },
        patches: [
          { op: "set", path: ["multipliers", "capacity"], value: original?.capacity ?? 1 },
          { op: "set", path: ["multipliers", "traffic"], value: original?.traffic ?? 1 },
        ],
        runs: [run],
      });
    },

    /** One of Live's what-if inputs, as the Inputs panel sets it (unsaved: Save to simulation keeps it). */
    inputs(ports: RepairPorts, input: LiveInput, value: number): RepairResult {
      const live = ports.live;
      if (!ports.liveOn || !live) return "waiting";
      const inputs = live.controller.getState().inputs;
      if ((inputs[input] ?? 1) !== value) live.controller.setInputs({ ...inputs, [input]: value });
      return "done";
    },

    /** Restart or Exit: an earlier attempt's writes are no longer waited for. */
    reset() {
      pending.clear();
    },
  };
}

export type Repairs = ReturnType<typeof createRepairs>;
