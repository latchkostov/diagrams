import { nodeFaultLabel } from "../../model/faultWords";
import { faultTrouble } from "../faultTrouble";
import { boundaryOutage } from "../../model/faultRuntime";
import { t } from "../../i18n";
import { effectiveCallerPolicy } from "../../editor/callerPolicy";
import { useStore } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorApi } from "../../editor/types";
import { notify } from "../../interop/ui/toast";
import { addConsumer, addDeadLetterQueue } from "../addConsumer";
import { capacitySaveCandidate, capacitySaveError } from "../capacityPersistence";
import { troubleLeads, type Trouble, type TroubleAction } from "../observedTrouble";
import { writeLiveParams } from "../urlParams";
import { useObservedTrouble } from "../useObservedTrouble";

import type { Dispatch, SetStateAction } from "react";
import type { CameraController } from "../../canvas/camera";
import type { SessionProps } from "../LiveSession";
import type { CapacityInputs } from "./useCapacityInputs";
import type { LiveCommands } from "./useLiveCommands";
import type { LiveSessionState } from "./useLiveSessionState";
import type { TraceSpotlight } from "./useTraceSpotlight";
import { useFollowing } from "../watchBridge";
import { LiveSync } from "./liveSync";
export function useLiveDiagramChanges({
  session,
  editor,
  privateDiagram,
}: Pick<SessionProps, "editor" | "privateDiagram"> & { session: LiveSessionState }) {
  const { controller, getDiagram, flash, draftRef, simulations, state, draft } = session;
  // ---------------------------------------------------------------- diagram edits while live

  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  // The document's changes into the run, through one boundary that waits while this person follows someone's
  // shared run (the host's ops bring them, on their ticks) and reconciles once following ends.
  const following = useFollowing();
  const sync = useMemo(() => new LiveSync(controller, () => flash(t("liveSession.restarted"))), [controller, flash]);
  useEffect(() => sync.setFollowing(following), [sync, following]);
  useEffect(() => {
    if (!editor) return;
    const timer = window.setTimeout(() => sync.diagram(getDiagram), 200);
    return () => window.clearTimeout(timer);
  }, [nodes, edges, editor, sync, getDiagram]);

  // A saved simulation edited elsewhere (undo, the panel's Save) replays with the new definition; removed, free play.
  useEffect(() => {
    sync.simulations(simulations, () => draftRef.current?.id);
    // Session-owned refs and setters are stable; preserve the original dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulations, sync]);

  // Mirror the live state into the URL (canvas only) so the address is a shareable live link. A private diagram
  // can't be shared as one, and its simulation ids can carry its words: only `live=1` goes in its address.
  const simId = state.simulation && state.simulation.id !== draft?.id ? state.simulation.id : null;
  useEffect(() => {
    if (editor) writeLiveParams(true, privateDiagram ? null : simId);
  }, [editor, simId, privateDiagram]);
}

export function useLiveFixes({
  session,
  commands,
  spotlight,
  capacity: capacityInputs,
  editor,
  camera,
  presenting,
  capturing,
  setCapacityError,
  onSaveDiagram,
}: Pick<SessionProps, "editor" | "presenting" | "onSaveDiagram"> & {
  session: LiveSessionState;
  commands: LiveCommands;
  spotlight: TraceSpotlight;
  capacity: CapacityInputs;
  camera: CameraController;
  capturing: boolean;
  setCapacityError: Dispatch<SetStateAction<string | null>>;
}) {
  const { controller, capacityOpen, flash } = session;
  const { slowRef } = spotlight;
  const { showEvents, saveSimulation } = commands;
  const { showCapacity, capacity, openCapacity } = capacityInputs;
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
  const { trouble: observed, dismiss: dismissTrouble, shown: troubleShown } = useObservedTrouble(controller);
  const [dismissedFault, setDismissedFault] = useState<string | null>(null);
  const top = capacity?.top;
  const capacityFault: Trouble | undefined =
    top && nodeFaultLabel(top.id, session.state.snapshot.faults)
      ? {
          key: `fault:${session.state.generation}:${top.id}:${nodeFaultLabel(top.id, session.state.snapshot.faults)}`,
          kind: "lag",
          node: top.id,
          headline: capacity.headline,
          announce: capacity.headline,
          detail: capacity.detail,
          action: { kind: "inputs" },
        }
      : undefined;
  const trouble = faultTrouble(
    observed ?? capacityFault,
    controller.currentDiagram,
    session.state.snapshot.faults,
    session.state.snapshot.nodes,
  );
  const runTroubleAction = useCallback(
    (action: TroubleAction) => {
      if (slowRef.current?.session.active && action.kind !== "events" && action.kind !== "inputs") return;
      if (action.kind === "restore-boundary")
        controller.setFault({ kind: "boundary", boundary: action.boundary, down: false });
      else if (action.kind === "clear-fault") {
        controller.setFault({ kind: "slow", node: action.node, factor: 1 });
        controller.setFault({ kind: "fail", node: action.node, rate: 0 });
      } else if (action.kind === "revive") {
        if (boundaryOutage(controller.currentDiagram, action.node, controller.snapshot().faults)) return;
        controller.setNodeStatus(action.node, "up");
      } else if (action.kind === "add-consumer") addReader(action.node);
      else if (action.kind === "add-dlq") {
        if (editor && addDeadLetterQueue(editor, action.node)) {
          flash(t("liveSession.addedDeadLetter"));
          revealAdded();
        }
      } else if (action.kind === "free-thread") {
        if (editor) effectiveCallerPolicy(editor, action.edge)?.set({ wait: "non-blocking" });
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
    (observed || trouble.key !== dismissedFault) &&
    !(session.state.run?.note && trouble.action.kind === "restore-boundary") &&
    (!showCapacity || trouble.action.kind === "clear-fault" || troubleLeads(trouble, capacity))
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
    !presenting &&
    (t.action.kind !== "free-thread" || !!(editor && effectiveCallerPolicy(editor, t.action.edge)?.editable)) &&
    (editor || (t.action.kind !== "add-consumer" && t.action.kind !== "add-dlq" && t.action.kind !== "free-thread"));

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
    flash(t("liveSession.savedRates"));
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
    dismissTrouble: () => {
      if (observed) dismissTrouble();
      else if (capacityFault) setDismissedFault(capacityFault.key);
    },
    saveInputs,
  };
}

/** The toast after Add a consumer, with Undo. */
export function sayConsumerAdded(editor: EditorApi, brokerId: string): void {
  const name = editor.getNode(brokerId)?.label || brokerId;
  notify(t("liveSession.addedConsumer", { name }), {
    action: { label: t("shortcuts.undo"), run: () => editor.undo(), testId: "add-consumer-undo", undoes: true },
  });
}
