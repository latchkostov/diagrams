import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { aiDock, collapseDock } from "../../ai/ui/dock";
import type { Simulation } from "../../model/types";
import { useLiveSessionHost } from "../../palette/host";
import type { InjectRequest } from "../InjectDialog";
import { emptyInputs } from "../capacityModel";
import { useLiveState } from "../context";
import { LiveController } from "../controller";
import { liveMutationGuard } from "../liveActions";
import type { SlowMotionView } from "../slowmo/useSlowMotion";
import { useTraceState } from "./useTraceSpotlight";
import { liveDiagramReader } from "../diagramReader";

import type { SessionProps } from "../LiveSession";
import type { LiveCommands } from "./useLiveCommands";
export type LivePanel = { open: boolean; kind: "sims" | "capacity"; sim: Simulation | null };

export function useLiveSessionState({
  editor,
  diagram,
  params,
  simulations: simsProp,
}: Pick<SessionProps, "editor" | "diagram" | "params" | "simulations">) {
  const getDiagram = useMemo(() => liveDiagramReader(editor, diagram), [editor, diagram]);
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
    // Free play uses the diagram's configured rates, through a logged, budget-checked control op.
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

  const [panel, setPanel] = useState<LivePanel>(() => ({
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

export function useLiveSessionBridge({
  session,
  onSession,
  commands,
  editor,
  alwaysOn,
  slow,
}: Pick<SessionProps, "onSession" | "editor" | "alwaysOn"> & {
  session: LiveSessionState;
  commands: LiveCommands;
  slow: SlowMotionView;
}) {
  const { controller, panel, setPanel, suspendedPanelRef, panelDraft } = session;
  const { selectSimulation } = commands;
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

export function useLivePanelLayout({ panel, setPanel, suspendedPanelRef, panelDraft }: LiveSessionState) {
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

export type LiveSessionState = ReturnType<typeof useLiveSessionState>;
