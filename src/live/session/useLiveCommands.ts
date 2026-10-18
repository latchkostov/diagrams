import { useStoreApi } from "@xyflow/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { aiDock, collapseDock } from "../../ai/ui/dock";
import type { DiagramFlowEdge, FlowNode } from "../../canvas/types";
import { notify } from "../../interop/ui/toast";
import type { DiagramFile, Simulation } from "../../model/types";
import { useLiveSessionHost } from "../../palette/host";
import { type InjectRequest } from "../InjectDialog";
import { emptyInputs } from "../capacityModel";
import { capacitySaveError } from "../capacityPersistence";
import { useLiveState } from "../context";
import { LiveController } from "../controller";
import { liveMutationGuard } from "../liveActions";
import { initialRecordState, isCapturing, recordReducer } from "../record/recordModel";
import { type SlowMotionView } from "../slowmo/useSlowMotion";
import { createStormSimulation } from "../storm";
import { useTraceState } from "./useTraceSpotlight";

import type { Dispatch, RefObject, SetStateAction } from "react";
import type { SessionProps } from "../LiveSession";
export type LivePanel = { open: boolean; kind: "sims" | "capacity"; sim: Simulation | null };

export function useLiveSetup({
  editor,
  diagram,
  params,
  simulations: simsProp,
}: Pick<SessionProps, "editor" | "diagram" | "params" | "simulations">) {
  const getDiagram = useCallback((): DiagramFile => (editor ? editor.getDiagram() : diagram!), [editor, diagram]);
  const simulations = useMemo(() => simsProp ?? diagram?.simulations ?? [], [simsProp, diagram]);
  const simsRef = useRef(simulations);
  useLayoutEffect(() => {
    simsRef.current = simulations;
  }, [simulations]);

  const [draft, setDraft] = useState<Simulation | null>(null);
  const draftRef = useRef(draft);
  useLayoutEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const [controller] = useState(() => {
    const c = new LiveController(getDiagram());
    if (params.speed) c.setSpeed(params.speed);
    const sim = params.sim ? simulations.find((s) => s.id === params.sim) : undefined;
    if (sim) c.selectSimulation(sim);
    // Free play starts with gentle continuous traffic so something is always flowing.
    else if (params.traffic !== false) c.setTraffic(true);
    if (params.traffic === false) c.setTraffic(false);
    if (params.trace === "next") c.traceNext();
    else if (params.trace === "deadletter") c.traceDeadLettered();
    if (params.inputs) c.setInputs({ ...emptyInputs(), ...params.inputs });
    if (sim && params.seekMs) c.seek(params.seekMs);
    if (!params.paused) c.setPlaying(true);
    return c;
  });
  const state = useLiveState(controller);

  const [panel, setPanel] = useState<{ open: boolean; kind: "sims" | "capacity"; sim: Simulation | null }>(() => ({
    open: params.panel === "capacity",
    kind: params.panel === "capacity" ? "capacity" : "sims",
    sim: null,
  }));
  const capacityOpen = panel.open && panel.kind === "capacity";
  const panelDraft = useRef<Simulation | null>(null);
  const suspendedPanelRef = useRef<{ sim: Simulation | null } | null>(null);
  const takePanelDraft = useCallback((sim: Simulation | null) => {
    panelDraft.current = sim;
  }, []);
  useEffect(() => () => controller.dispose(), [controller]);
  const [events, setEvents] = useState<{ open: boolean; nodeId: string | null }>({ open: false, nodeId: null });
  const { trace, traceRef, setTrace } = useTraceState();
  const [inject, setInject] = useState<InjectRequest | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  const flash = useCallback((text: string) => {
    setNotice(text);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3200);
  }, []);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);
  const previousTraffic = useRef(state.traffic);
  useEffect(() => {
    const stopped = previousTraffic.current && !state.traffic;
    previousTraffic.current = state.traffic;
    if (!stopped) return;
    const hint = controller.trafficHint();
    if (!hint) return;
    // Shown right after this commit, not during it (no synchronous re-render from the effect). A microtask, not a
    // timer: a paused clock (presenting a frozen frame, a test's fake clock) must not hold the notice back.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) flash(hint);
    });
    return () => {
      cancelled = true;
    };
  }, [state.traffic, controller, flash]);

  return {
    getDiagram,
    simulations,
    simsRef,
    draft,
    setDraft,
    draftRef,
    controller,
    state,
    panel,
    setPanel,
    capacityOpen,
    panelDraft,
    suspendedPanelRef,
    takePanelDraft,
    events,
    setEvents,
    trace,
    traceRef,
    setTrace,
    inject,
    setInject,
    notice,
    flash,
  };
}

export function useLiveCommands({
  setup,
  editor,
  onSaveDiagram,
  slowRef,
  setCapacityError,
}: Pick<SessionProps, "editor" | "onSaveDiagram"> & {
  setup: ReturnType<typeof useLiveSetup>;
  slowRef: RefObject<SlowMotionView | null>;
  setCapacityError: Dispatch<SetStateAction<string | null>>;
}) {
  const { getDiagram, simsRef, draftRef, setDraft, controller, setTrace, setPanel, setEvents, flash } = setup;
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
      flash(`Saved “${sim.title}” to this diagram.`);
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

export function useLiveSessionBridge({
  setup,
  onSession,
  selectSimulation,
  editor,
  alwaysOn,
  slow,
}: Pick<SessionProps, "onSession" | "editor" | "alwaysOn"> & {
  setup: ReturnType<typeof useLiveSetup>;
  selectSimulation: (id: string | null) => void;
  slow: SlowMotionView;
}) {
  const { controller, panel, setPanel, suspendedPanelRef, panelDraft } = setup;
  // A page driving live view from outside (the host-supplied embed) gets the controller and the bar's switch.
  const closePanel = useCallback(() => {
    if (!panel.open) return;
    if (panel.kind === "sims") suspendedPanelRef.current = { sim: panelDraft.current };
    setPanel({ ...panel, open: false });
    // Session-owned refs and setters are stable; preserve the original dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);
  useEffect(() => {
    if (!onSession) return;
    onSession({ controller, selectSimulation, closePanel });
    return () => onSession(null);
  }, [onSession, controller, selectSimulation, closePanel]);
  // Simulation switching uses the same availability as the registry's engine-changing actions.
  useLiveSessionHost(
    selectSimulation,
    !!editor && !alwaysOn,
    liveMutationGuard(() => slow.session.active).hint(),
    controller.getState,
  );
}

export function useLiveRecording({
  setup,
  dispatchRec,
  store,
}: {
  setup: ReturnType<typeof useLiveSetup>;
  dispatchRec: ReturnType<typeof useLiveRecordingState>["dispatchRec"];
  store: ReturnType<typeof useStoreApi<FlowNode, DiagramFlowEdge>>;
}) {
  const { setPanel, setEvents, getDiagram } = setup;
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

export function useLivePanelLayout({
  panel,
  setPanel,
  suspendedPanelRef,
  panelDraft,
}: ReturnType<typeof useLiveSetup>) {
  // On a phone the side panel and the AI panel share one slot.
  useEffect(() => {
    if (!panel.open) return;
    const phone = window.matchMedia("(max-width: 640px)");
    const fold = () => {
      if (phone.matches) collapseDock();
    };
    fold();
    phone.addEventListener("change", fold);
    return () => phone.removeEventListener("change", fold);
  }, [panel.open]);
  useEffect(
    () =>
      aiDock.subscribe(() => {
        if (!aiDock.get().open || !window.matchMedia("(max-width: 640px)").matches) return;
        // Explicit AI opening owns the phone's one panel slot. Preserve a simulation draft
        // exactly as closing its panel does, so switching back can resume it.
        setPanel((current) => {
          if (!current.open) return current;
          if (current.kind === "sims") suspendedPanelRef.current = { sim: panelDraft.current };
          return { ...current, open: false };
        });
      }),
    // Session-owned refs and setters are stable; preserve the original dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}
