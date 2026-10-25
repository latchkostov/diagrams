import { defineLazySurface } from "../lib/lazySurface";
import { boundaryRestoreHint } from "../model/faultWords";
import { ViewportPortal, useStoreApi } from "@xyflow/react";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useCameraController } from "../canvas/camera";
import { InteractionContext, useInteractionOrLocal } from "../canvas/interaction";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import { actionRegistry } from "../editor/actions";
import { useSettings } from "../harness/settings";
import { t, useLocale } from "../i18n";
import { planningHost } from "../planning/host";
import { BottleneckCallout } from "./lazyBottleneckCallout";
// A failed download's notice and Retry are part of this chunk: recovering never waits for another download.
import { CalloutUnavailable, TroubleDownloadError } from "./TroubleDownloadError";
const TroubleCallout = defineLazySurface({
  id: "live.trouble",
  load: () => import("./TroubleCallout").then((m) => m.TroubleCallout),
  placeholder: {
    render: (_, status) => <CalloutUnavailable status={status} />,
  },
  focus: {},
  export: "skip",
  retryToast: true,
});
import { CapacityPanel } from "./lazyCapacityPanel";
import { CapacityAnalysis } from "./lazyCapacityAnalysis";
import { ControlBar } from "./ControlBar";
const EventLog = defineLazySurface({
  id: "live.events",
  load: () => import("./EventLog").then((m) => m.EventLog),
  placeholder: {},
  focus: {},
  export: "skip",
  retryToast: true,
});
import { InjectLoading } from "./InjectLoading";
const InjectDialog = defineLazySurface({
  id: "live.inject",
  load: () => import("./InjectDialog").then((m) => m.InjectDialog),
  placeholder: {
    render: (props, status) => <InjectLoading {...props} status={status} />,
  },
  focus: {},
  export: "skip",
  retryToast: true,
});
import { NodeBadges } from "./NodeBadges";
const NoteCallout = defineLazySurface({
  id: "live.note",
  load: () => import("./NoteCallout").then((m) => m.NoteCallout),
  placeholder: {},
  focus: {},
  export: "await",
  retryToast: true,
});
import { SimPanelFrame } from "./SimPanelFrame";
import { SimPanel } from "./lazySimPanel";
import { TraceCard } from "./lazyTraceCard";
import { LiveContext, type LiveUi } from "./context";
import { LiveIcon } from "./icons";
import { liveMutationGuard } from "./liveActions";
import { useWatchBridge } from "./watchBridge";
import { useCapacityEntry, useCapacityError, useCapacityInputs } from "./session/useCapacityInputs";
import { useFrameLoop } from "./session/useFrameLoop";
import { useLiveCommands, useLiveRecording, useLiveRecordingState } from "./session/useLiveCommands";
import { useLiveContextMenu } from "./session/useLiveContextMenu";
import { useLiveDiagramChanges, useLiveFixes } from "./session/useLiveFixes";
import { useLiveKeyboard } from "./session/useLiveKeyboard";
import { useLivePanelLayout, useLiveSessionBridge, useLiveSessionState } from "./session/useLiveSessionState";
import { useTraceActions, useTraceSpotlight } from "./session/useTraceSpotlight";
import { TraceRuntime } from "./session/useTraceRuntime";
import { SlowCaption } from "./slowmo/SlowBar";
// Loaded on first use: the sequence generator, its SVG renderer and Mermaid writer.
const SequenceDialog = lazy(() => import("./SequenceDialog").then((m) => ({ default: m.SequenceDialog })));
// Record video's code (its dialogs, capture and WebM fix-up) loads just after the session is up, not with it.
type RecorderView = typeof import("./record/Recorder").Recorder;

import type { LiveSessionHandle, LiveViewProps } from "./LiveView";

// The live session: the simulation, its renderers and panels, slow motion and recording. It loads when live
// view first turns on (or earlier, once the canvas is idle; see LiveView), never with the first view.

/**
 * The live view: a "Live" toggle on the canvas, and while it's on, the simulation session
 * (particles, badges, controls, notes, authoring). Rendered as a child of <ReactFlow>.
 */
export interface SessionProps extends LiveViewProps {
  params: NonNullable<LiveViewProps["initial"]>;
  onExit: () => void;
  /** Reports this session to a page that drives it from outside (null when it ends). */
  onSession?: (session: LiveSessionHandle | null) => void;
}

export function LiveSession({
  editor,
  presenting,
  simulations: simsProp,
  diagram,
  params,
  onExit,
  alwaysOn,
  onSaveDiagram,
  onPanelChange,
  onSession,
  privateDiagram,
  documentId,
}: SessionProps) {
  // Every move of the view goes through the canvas camera (src/canvas/camera): Live only says what changed.
  const camera = useCameraController();
  if (!camera) throw new Error("LiveSession needs a camera (CameraContext)");
  // Live's keys, popovers, panels and focus returns go through the canvas's interaction controller (src/canvas/
  // interaction); a Lab stage without a canvas gets one of its own.
  const { controller: interaction, local } = useInteractionOrLocal();
  const locale = useLocale();
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const { theme } = useSettings();
  const session = useLiveSessionState({ editor, diagram, params, simulations: simsProp });
  const {
    getDiagram,
    simulations,
    draft,
    controller,
    state,
    panel,
    setPanel,
    capacityOpen,
    suspendedPanelRef,
    takePanelDraft,
    events,
    trace,
    setTrace,
    inject,
    setInject,
  } = session;

  useLiveDiagramChanges({ session, editor, privateDiagram });

  const spotlight = useTraceSpotlight({ session, camera });
  const { slowRef, spotlightRef, reducedMotion } = spotlight;

  useLivePanelLayout(session);

  const { setCanvas, setOverlay, rendererKind } = useFrameLoop({
    controller,
    store,
    theme,
    presenting,
    reducedMotion,
    slowRef,
    spotlightRef,
  });

  const tracing = useTraceActions({ session, spotlight, presenting });
  const { sequence, setSequence, startTrace, cardRoom, shownNotice: traceNotice, sendOne } = tracing;
  const shownNotice =
    traceNotice ??
    (spotlight.runtime.active && spotlight.runtime.loading && !spotlight.runtime.facade.pending
      ? t("common.loading")
      : null);

  const { capacityError, setCapacityError, clearCapacityError } = useCapacityError();

  const commands = useLiveCommands({ session, editor, onSaveDiagram, spotlight, setCapacityError });
  const { selectSimulation, showSimulation, runDraft, saveSimulation, deleteSimulation, showEvents } = commands;

  const { rec, dispatchRec, capturing } = useLiveRecordingState();
  const [Recorder, setRecorder] = useState<RecorderView | null>(null);
  useEffect(() => {
    let mounted = true;
    void import("./record/Recorder").then((m) => mounted && setRecorder(() => m.Recorder));
    return () => {
      mounted = false;
    };
  }, []);

  const slow = spotlight.runtime.slow;
  const slowMotionTrace = () => {
    const trace = controller.getState().trace;
    slow.start(trace?.rootId !== undefined ? { kind: "root", rootId: trace.rootId } : { kind: "followed" });
  };
  const motion = { slow, slowMotionTrace };
  useLiveSessionBridge({ session, onSession, commands, editor, alwaysOn, slow });
  const watched = useMemo(
    () =>
      editor && !alwaysOn
        ? {
            controller,
            getDiagram: session.getDiagram,
            store,
            camera,
            documentId,
            // Asked as it is now (the Private switch, a local-only example): unknown counts as private.
            isPrivate: () => editor.isPrivate?.() ?? true,
          }
        : null,
    [editor, alwaysOn, controller, session.getDiagram, store, camera, documentId],
  );
  useWatchBridge(watched);
  const recording = useLiveRecording({ session, dispatchRec, store });
  const { openRecord, recordTarget, recordTitle } = recording;

  const capacityInputs = useCapacityInputs({ session, params, locale, spotlight, editor });
  const { showCapacity, planDiagram, capacity, openCapacity, closeCapacity, applyFix } = capacityInputs;

  const fixes = useLiveFixes({
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
  });
  const {
    addReader,
    runTroubleAction,
    troubleOnScreen,
    troubleDownloadFailed,
    retryTroubleDownload,
    troubleAnnouncement,
    troubleActionHere,
    troubleShown,
    dismissTrouble,
    saveInputs,
  } = fixes;

  const { addEntry } = useCapacityEntry({ session, editor, store, camera, interaction });

  useLiveContextMenu({
    session,
    commands,
    capacity: capacityInputs,
    spotlight,
    tracing,
    motion,
    recording,
    editor,
    store,
    onPanelChange,
  });

  useLiveKeyboard({ session, spotlight, presenting, alwaysOn, onExit, editor, interaction });

  const ui = useMemo<LiveUi>(
    () => ({
      applyCapacityFix: applyFix,
      addReader,
      controller,
      presenting,
      canEdit: !!editor,
      diagram: getDiagram,
      simulations,
      draft,
      selectSimulation,
      openPanel: (sim) => {
        // The live bar passes the active run; restore its working copy unless another run was chosen.
        const kept = suspendedPanelRef.current;
        const restore = kept && (!sim || kept.sim?.id === sim.id);
        suspendedPanelRef.current = null;
        setPanel({ open: true, kind: "sims", sim: restore ? kept.sim : (sim ?? null) });
      },
      panelOpen: panel.open,
      capacityOpen,
      openCapacity,
      events,
      showEvents,
      notice: shownNotice,
      exit: alwaysOn ? null : onExit,
      openRecord,
      startTrace,
      slowmo: slow.session,
      action: (id) => {
        if (!editor) return undefined;
        const row = actionRegistry
          .build({ editor, target: "canvas", mode: "live", surface: "palette", selection: editor.getSelection() })
          .find((row) => row.type === "item" && row.id === id);
        return row?.type === "item" ? row : undefined;
      },
    }),
    // Session-owned refs and setters are stable; preserve the original dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      applyFix,
      addReader,
      slow.session,
      controller,
      presenting,
      editor,
      getDiagram,
      simulations,
      draft,
      selectSimulation,
      panel.open,
      capacityOpen,
      openCapacity,
      events,
      showEvents,
      shownNotice,
      onExit,
      openRecord,
      alwaysOn,
      startTrace,
    ],
  );

  useEffect(() => planningHost.publish(ui), [ui]);

  const view = (
    <LiveContext.Provider value={ui}>
      {showCapacity && !capacityOpen && <CapacityAnalysis panel={false} onClose={closeCapacity} />}
      <ViewportPortal>
        <canvas
          key={`base-${rendererKind}`}
          data-renderer={rendererKind}
          ref={setCanvas}
          className="lv-canvas"
          data-testid="live-canvas"
          aria-hidden
        />
        <canvas
          key={`over-${rendererKind}`}
          ref={setOverlay}
          className="lv-canvas lv-canvas-over"
          data-testid="live-canvas-over"
          aria-hidden
        />
        <NodeBadges state={state} presenting={presenting} capacity={showCapacity ? capacity : null} />
      </ViewportPortal>
      <div
        className={`lv-hud${presenting ? " is-presenting" : ""}${panel.open ? " has-panel" : ""}`}
        data-testid="live-hud"
      >
        {trace && (
          <div className="lv-trace-chip" data-testid="live-trace">
            <LiveIcon name="target" size={13} /> Highlighting everything downstream of this edge
            <button
              onClick={() => setTrace(null)}
              data-testid="live-trace-clear"
              aria-label={t("liveSession.clearHighlight")}
            >
              <LiveIcon name="close" size={12} />
            </button>
          </div>
        )}
        {/* Mounted empty first, so the cause is heard when it's written; it changes only with the cause. */}
        <span ref={troubleAnnouncement} className="sr-only" role="status" data-testid="trouble-announce" />
        {troubleDownloadFailed && !capturing && !presenting && !panel.open ? (
          <TroubleDownloadError retry={retryTroubleDownload} announced />
        ) : troubleOnScreen ? (
          <TroubleCallout
            trouble={troubleOnScreen}
            onShown={troubleShown}
            floating
            onAction={troubleActionHere(troubleOnScreen) ? runTroubleAction : undefined}
            onDismiss={dismissTrouble}
            disabledHint={
              troubleOnScreen.action.kind === "events" || troubleOnScreen.action.kind === "inputs"
                ? undefined
                : (liveMutationGuard(() => slow.session.active).hint() ??
                  (troubleOnScreen.action.kind === "revive"
                    ? boundaryRestoreHint(controller.currentDiagram, troubleOnScreen.action.node, state.snapshot.faults)
                    : undefined))
            }
          />
        ) : (
          showCapacity &&
          capacity &&
          !capacityOpen && (
            <BottleneckCallout
              view={capacity}
              floating
              onApply={applyFix}
              disabledHint={liveMutationGuard(() => slow.session.active).hint()}
              onOpenPanel={presenting ? undefined : () => openCapacity()}
              onAddConsumer={editor && !presenting ? addReader : undefined}
            />
          )
        )}
        {spotlight.runtime.active && (
          <TraceRuntime
            facade={spotlight.runtime.facade}
            controller={controller}
            store={store}
            camera={camera}
            presenting={presenting}
            reducedMotion={reducedMotion}
            panelOpen={panel.open}
            capturing={capturing}
            cardRoom={cardRoom}
            onSequence={setSequence}
          />
        )}
        {slow.state.status !== "on" && state.trace && !capturing && (
          <TraceCard
            trace={state.trace}
            diagram={controller.currentDiagram}
            now={state.snapshot.time}
            onClose={() => {
              slow.end();
              controller.endTrace();
            }}
            onSequence={() => state.trace?.current && setSequence(state.trace.current)}
            onSendOne={sendOne}
            room={cardRoom}
            onSlowMotion={state.trace.current ? slowMotionTrace : undefined}
            waitingText={
              slow.state.status === "armed"
                ? slow.state.armedAt
                  ? t("liveSession.waitingSlowMotionAt", {
                      name:
                        controller.currentDiagram.nodes.find((n) => n.id === slow.state.armedAt)?.label ??
                        slow.state.armedAt,
                    })
                  : t("liveSession.waitingSlowMotion")
                : undefined
            }
          />
        )}
        <SlowCaption slow={slow.session} />
        {/* Live's narration waits with live while slow motion plays. */}
        {slow.state.status !== "on" && (state.run?.note || state.run?.done) && <NoteCallout state={state} />}
        {events.open && !capturing && <EventLog state={state} />}
        {/* While recording, the indicator (Stop, Esc) stands in for the bar. */}
        {!capturing && <ControlBar state={state} />}
      </div>
      {capacityOpen && (
        <CapacityPanel
          key={state.simulation?.id ?? "free"}
          controller={controller}
          disabledHint={liveMutationGuard(() => slow.session.active).hint()}
          diagram={planDiagram}
          base={state.simulation}
          inputs={state.inputs}
          running={state.running}
          scale={state.scale}
          error={capacityError}
          onChange={clearCapacityError}
          view={capacity}
          onClose={closeCapacity}
          onApplyFix={applyFix}
          onAddConsumer={editor && !presenting ? addReader : undefined}
          onSave={editor ? saveInputs : undefined}
          onAddEntry={editor && !presenting ? addEntry : undefined}
        />
      )}
      {panel.open && panel.kind === "sims" && editor && (
        <SimPanelFrame>
          <SimPanel
            key={panel.sim?.id ?? "picker"}
            initial={panel.sim}
            onDraftChange={takePanelDraft}
            state={state}
            onClose={() => setPanel({ open: false, kind: "sims", sim: null })}
            onRun={runDraft}
            onSave={saveSimulation}
            onDelete={deleteSimulation}
            onOpen={showSimulation}
          />
        </SimPanelFrame>
      )}
      {inject && <InjectDialog request={inject} onClose={() => setInject(null)} />}
      {sequence && (
        <Suspense fallback={null}>
          <SequenceDialog
            trace={sequence}
            diagram={controller.currentDiagram}
            theme={theme}
            onClose={() => setSequence(null)}
          />
        </Suspense>
      )}
      {Recorder && (
        <Recorder
          rec={rec}
          dispatch={dispatchRec}
          controller={controller}
          state={state}
          target={recordTarget}
          title={recordTitle}
          presenting={presenting}
          canPresent={!!editor && !alwaysOn}
          slowmo={slow.session}
        />
      )}
    </LiveContext.Provider>
  );
  return local ? <InteractionContext.Provider value={interaction}>{view}</InteractionContext.Provider> : view;
}
