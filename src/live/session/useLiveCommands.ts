import { t } from "../../i18n";
import { useStoreApi } from "@xyflow/react";
import { useCallback, useReducer } from "react";
import type { DiagramFlowEdge, FlowNode } from "../../canvas/types";
import { notify } from "../../interop/ui/toast";
import type { Simulation } from "../../model/types";
import { capacitySaveError } from "../capacityPersistence";
import { initialRecordState, isCapturing, recordReducer } from "../record/recordModel";
import { createStormSimulation } from "../storm";
import type { LiveSessionState } from "./useLiveSessionState";
import type { TraceSpotlight } from "./useTraceSpotlight";

import type { Dispatch, SetStateAction } from "react";
import type { SessionProps } from "../LiveSession";
export function useLiveCommands({
  session,
  editor,
  onSaveDiagram,
  spotlight,
  setCapacityError,
}: Pick<SessionProps, "editor" | "onSaveDiagram"> & {
  session: LiveSessionState;
  spotlight: TraceSpotlight;
  setCapacityError: Dispatch<SetStateAction<string | null>>;
}) {
  const { slowRef } = spotlight;
  const { getDiagram, simsRef, draftRef, setDraft, controller, setTrace, setPanel, setEvents, flash } = session;
  const selectSimulation = useCallback(
    (id: string | null) => {
      if (slowRef.current?.session.active) return;
      const sim = id
        ? draftRef.current?.id === id
          ? draftRef.current
          : simsRef.current.find((s) => s.id === id)
        : null;
      setTrace(null);
      setCapacityError(null);
      controller.selectSimulation(sim ?? null);
      if (sim) controller.setTraffic(false);
      controller.setPlaying(true);
    },
    // Session-owned refs and setters are stable; preserve the original dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller],
  );

  /**
   * A saved simulation (or the draft) opened for editing becomes the one that runs, so the live
   * bar's picker and the canvas show what's being edited instead of free play. Play / pause stays.
   */
  const showSimulation = useCallback(
    (sim: Simulation) => {
      if (controller.getState().simulation?.id === sim.id) return;
      const known =
        simsRef.current.find((s) => s.id === sim.id) ?? (draftRef.current?.id === sim.id ? draftRef.current : null);
      if (!known) return;
      setTrace(null);
      setCapacityError(null);
      controller.selectSimulation(known);
      controller.setTraffic(false);
    },
    // Session-owned refs and setters are stable; preserve the original dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller],
  );

  const runDraft = useCallback(
    (sim: Simulation) => {
      if (!controller.selectSimulation(sim)) return;
      const saved = simsRef.current.some((s) => s.id === sim.id && JSON.stringify(s) === JSON.stringify(sim));
      setDraft(saved ? null : sim);
      draftRef.current = saved ? null : sim;
      setTrace(null);
      controller.setTraffic(false);
      setCapacityError(null);
      controller.setPlaying(true);
    },
    // Session-owned refs and setters are stable; preserve the original dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller],
  );

  const saveSimulation = useCallback(
    (sim: Simulation) => {
      if (!editor) return;
      const list = [...(editor.getDiagram().simulations ?? [])];
      const i = list.findIndex((s) => s.id === sim.id);
      if (i >= 0) list[i] = sim;
      else list.push(sim);
      const error = capacitySaveError({ ...editor.getDiagram(), simulations: list });
      if (error) {
        setCapacityError(error);
        notify(error, { kind: "error" });
        return false;
      }
      setCapacityError(null);
      editor.updateMeta({ simulations: list });
      onSaveDiagram?.({ ...editor.getDiagram(), simulations: list });
      if (draftRef.current?.id === sim.id) {
        setDraft(null);
        draftRef.current = null;
      }
      flash(t("liveSession.savedSimulation", { name: sim.title }));
      return true;
    },
    // Session-owned refs and setters are stable; preserve the original dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, flash, onSaveDiagram],
  );

  const deleteSimulation = useCallback(
    (id: string) => {
      if (!editor) return;
      editor.updateMeta({ simulations: (editor.getDiagram().simulations ?? []).filter((s) => s.id !== id) });
      if (draftRef.current?.id === id) setDraft(null);
      if (controller.getState().simulation?.id === id) controller.selectSimulation(null);
    },
    // Session-owned refs and setters are stable; preserve the original dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, controller],
  );

  const startStorm = useCallback(
    (nodeId: string) => {
      const sim = createStormSimulation(getDiagram(), nodeId);
      setPanel({ open: true, kind: "sims", sim });
      runDraft(sim);
    },
    // Session-owned refs and setters are stable; preserve the original dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getDiagram, runDraft],
  );

  // Session-owned refs and setters are stable; preserve the original dependencies.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const showEvents = useCallback((nodeId: string | null, open = true) => setEvents({ open, nodeId }), []);

  return { selectSimulation, showSimulation, runDraft, saveSimulation, deleteSimulation, startStorm, showEvents };
}

export function useLiveRecordingState() {
  // ---------------------------------------------------------------- record video

  const [rec, dispatchRec] = useReducer(recordReducer, initialRecordState);
  const capturing = isCapturing(rec.phase);

  return { rec, dispatchRec, capturing };
}

export function useLiveRecording({
  session,
  dispatchRec,
  store,
}: {
  session: LiveSessionState;
  dispatchRec: ReturnType<typeof useLiveRecordingState>["dispatchRec"];
  store: ReturnType<typeof useStoreApi<FlowNode, DiagramFlowEdge>>;
}) {
  const { setPanel, setEvents, getDiagram } = session;
  /** Opens "Record video" (the panels and the event log close: they'd be in the video). */
  const openRecord = useCallback(() => {
    setPanel((p) => (p.open ? { ...p, open: false } : p));
    setEvents((e) => (e.open ? { ...e, open: false } : e));
    dispatchRec({ type: "open" });
    // Session-owned refs and setters are stable; preserve the original dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** The video is framed to the canvas area: the diagram, its title card and the live overlays. */
  const recordTarget = useCallback(() => {
    const root = store.getState().domNode;
    return root?.closest(".canvas-wrap") ?? root ?? null;
  }, [store]);
  const recordTitle = useCallback(() => getDiagram().title, [getDiagram]);

  return { openRecord, recordTarget, recordTitle };
}

export type LiveCommands = ReturnType<typeof useLiveCommands>;
export type LiveRecording = ReturnType<typeof useLiveRecording>;
