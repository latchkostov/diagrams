import { useStore } from "@xyflow/react";
import { useCallback, useEffect, useRef } from "react";
import type { EditorApi } from "../../editor/types";
import { notify } from "../../interop/ui/toast";
import type { DiagramFile, Simulation } from "../../model/types";
import { addConsumer, addDeadLetterQueue } from "../addConsumer";
import { capacityView } from "../capacityModel";
import { capacitySaveCandidate, capacitySaveError } from "../capacityPersistence";
import { LiveController } from "../controller";
import { troubleLeads, type Trouble, type TroubleAction } from "../observedTrouble";
import { type SlowMotionView } from "../slowmo/useSlowMotion";
import { writeLiveParams } from "../urlParams";
import { useObservedTrouble } from "../useObservedTrouble";

import type { Dispatch, RefObject, SetStateAction } from "react";
import type { CameraController } from "../../canvas/camera";
import type { SessionProps } from "../LiveSession";
import type { LiveState } from "../controller";
export function useLiveDiagramChanges({
  editor,
  controller,
  getDiagram,
  flash,
  draftRef,
  simulations,
  state,
  draft,
  privateDiagram,
}: Pick<SessionProps, "editor" | "privateDiagram"> & {
  controller: LiveController;
  getDiagram: () => DiagramFile;
  flash: (text: string) => void;
  draftRef: RefObject<Simulation | null>;
  simulations: Simulation[];
  state: LiveState;
  draft: Simulation | null;
}) {
  // ---------------------------------------------------------------- diagram edits while live

  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  useEffect(() => {
    if (!editor) return;
    const t = window.setTimeout(() => {
      const result = controller.updateDiagram(getDiagram());
      if (result === "reloaded") flash("The diagram changed, so the simulation restarted.");
    }, 200);
    return () => window.clearTimeout(t);
  }, [nodes, edges, editor, controller, getDiagram, flash]);

  // A saved simulation edited elsewhere (undo, the panel's Save) replays with the new definition.
  useEffect(() => {
    const cur = controller.getState().simulation;
    if (!cur || cur.id === draftRef.current?.id) return;
    const next = simulations.find((s) => s.id === cur.id);
    if (!next) controller.selectSimulation(null);
    // Keep the Inputs & capacity what-ifs; prop changes (Apply fix, undo) patch the run live.
    else if (JSON.stringify(next) !== JSON.stringify(cur)) controller.setBase(next);
    // Session-owned refs and setters are stable; preserve the original dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulations, controller]);

  // Mirror the live state into the URL (canvas only) so the address is a shareable live link. A private diagram
  // can't be shared as one, and its simulation ids can carry its words: only `live=1` goes in its address.
  const simId = state.simulation && state.simulation.id !== draft?.id ? state.simulation.id : null;
  useEffect(() => {
    if (editor) writeLiveParams(true, privateDiagram ? null : simId);
  }, [editor, simId, privateDiagram]);
}

export function useLiveFixes({
  editor,
  controller,
  slowRef,
  camera,
  capacityOpen,
  presenting,
  capturing,
  showCapacity,
  capacity,
  flash,
  showEvents,
  openCapacity,
  saveSimulation,
  setCapacityError,
  onSaveDiagram,
}: Pick<SessionProps, "editor" | "presenting" | "onSaveDiagram"> & {
  controller: LiveController;
  slowRef: RefObject<SlowMotionView | null>;
  camera: CameraController;
  capacityOpen: boolean;
  capturing: boolean;
  showCapacity: boolean;
  capacity: ReturnType<typeof capacityView> | null;
  flash: (text: string) => void;
  showEvents: (nodeId: string | null, open?: boolean) => void;
  openCapacity: (open?: boolean) => void;
  saveSimulation: (sim: Simulation) => boolean | undefined;
  setCapacityError: Dispatch<SetStateAction<string | null>>;
}) {
  /** A node added one gap downstream may land past the view's edge: bring it in, clear of an open panel (as addEntry). */
  const revealAdded = useCallback(
    () => camera.dispatch({ type: "live.added", panel: capacityOpen }),
    [camera, capacityOpen],
  );

  /** "Nobody reads X" › Add a consumer: a service reading it, one undoable edit (the run restarts with it). */
  const addReader = useCallback(
    (brokerId: string) => {
      if (slowRef.current?.session.active || !editor) return;
      if (!addConsumer(editor, brokerId)) return;
      sayConsumerAdded(editor, brokerId);
      revealAdded();
    },
    // Session-owned refs and setters are stable; preserve the original dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, revealAdded],
  );

  // ---------------------------------------------------------------- what playback shows going wrong

  // The run's trouble the plan can't see (a node down, messages lost, a lag that keeps rising), for the callout.
  const { trouble, dismiss: dismissTrouble, shown: troubleShown } = useObservedTrouble(controller);
  const runTroubleAction = useCallback(
    (action: TroubleAction) => {
      if (slowRef.current?.session.active && action.kind !== "events" && action.kind !== "inputs") return;
      if (action.kind === "revive") controller.setNodeStatus(action.node, "up");
      else if (action.kind === "add-consumer") addReader(action.node);
      else if (action.kind === "add-dlq") {
        if (editor && addDeadLetterQueue(editor, action.node)) {
          flash("Added a dead-letter queue: messages that run out of deliveries go there (undo with Ctrl+Z).");
          revealAdded();
        }
      } else if (action.kind === "events") showEvents(action.node);
      else openCapacity();
    },
    // Session-owned refs and setters are stable; preserve the original dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, addReader, editor, flash, showEvents, openCapacity, revealAdded],
  );
  // Only while editing in live view (never presenting, recording, embedded or in the Lab, heat map or not). With the
  // heat map on, a callout is already there: trouble leads it, unless the plan diagnoses the same lag (troubleLeads).
  const troubleOnScreen =
    trouble &&
    editor &&
    !presenting &&
    !capturing &&
    !capacityOpen &&
    (!showCapacity || troubleLeads(trouble, capacity))
      ? trouble
      : undefined;
  const troubleAnnouncement = useRef<HTMLSpanElement>(null);
  const announcement = troubleOnScreen?.announce ?? "";
  useEffect(() => {
    // Even a run that starts with trouble mounts an empty region before its announcement changes.
    if (troubleAnnouncement.current) troubleAnnouncement.current.textContent = announcement;
  }, [announcement]);
  // Editing the diagram (a consumer, a dead-letter queue) needs the editor; reviving and reading don't.
  const troubleActionHere = (t: Trouble) =>
    !presenting && (editor || (t.action.kind !== "add-consumer" && t.action.kind !== "add-dlq"));

  /** "Save to simulation" (or "Save to diagram" in free play): one undoable edit, then the inputs reset. */
  const saveInputs = useCallback(() => {
    if (slowRef.current?.session.active) return;
    if (!editor) return;
    const st = controller.getState();
    const candidate = capacitySaveCandidate(editor.getDiagram(), st.simulation, st.inputs);
    const error = capacitySaveError(candidate.diagram);
    setCapacityError(error);
    if (error) return;
    controller.flush();
    if (candidate.saved) {
      if (saveSimulation(candidate.saved)) controller.commitInputs(candidate.saved, candidate.diagram);
      return;
    }
    const merge = "capacity:save:" + Date.now();
    for (const [id, props] of Object.entries(candidate.patches)) editor.setNodeProps(id, props, { merge });
    onSaveDiagram?.(candidate.diagram);
    controller.commitInputs(null, candidate.diagram);
    flash("Saved rates and sizes to the diagram (undo with Ctrl+Z).");
    // Session-owned refs and setters are stable; preserve the original dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, editor, saveSimulation, flash, onSaveDiagram]);

  return {
    addReader,
    runTroubleAction,
    troubleOnScreen,
    troubleAnnouncement,
    troubleActionHere,
    troubleShown,
    dismissTrouble,
    saveInputs,
  };
}

/** The toast after Add a consumer, with Undo. */
export function sayConsumerAdded(editor: EditorApi, brokerId: string): void {
  const name = editor.getNode(brokerId)?.label || brokerId;
  notify(`Added a consumer of ${name}.`, {
    // eslint-disable-next-line local/no-literal-ui-text -- Existing LiveSession copy, moved verbatim.
    action: { label: "Undo", run: () => editor.undo(), testId: "add-consumer-undo", undoes: true },
  });
}
