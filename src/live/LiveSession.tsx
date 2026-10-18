import { ViewportPortal, useStoreApi } from "@xyflow/react";
import { Suspense, lazy, useEffect, useMemo } from "react";
import { useCameraController } from "../canvas/camera";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import { actionRegistry } from "../editor/actions";
import { useSettings } from "../harness/settings";
import { useLocale } from "../i18n";
import { planningHost } from "../planning/host";
import { BottleneckCallout, TroubleCallout } from "./CapacityLayer";
import { CapacityPanel } from "./CapacityPanel";
import { ControlBar } from "./ControlBar";
import { EventLog } from "./EventLog";
import { InjectDialog } from "./InjectDialog";
import { NodeBadges } from "./NodeBadges";
import { NoteCallout } from "./NoteCallout";
import { SimPanel } from "./SimPanel";
import { TraceCard } from "./TraceCard";
import { LiveContext, type LiveUi } from "./context";
import { LiveIcon } from "./icons";
import { liveMutationGuard } from "./liveActions";
import { Recorder } from "./record/Recorder";
import { useCapacityEntry, useCapacityError, useCapacityInputs } from "./session/useCapacityInputs";
import { useFrameLoop } from "./session/useFrameLoop";
import {
  useLiveCommands,
  useLivePanelLayout,
  useLiveRecording,
  useLiveRecordingState,
  useLiveSessionBridge,
  useLiveSetup,
} from "./session/useLiveCommands";
import { useLiveContextMenu } from "./session/useLiveContextMenu";
import { useLiveDiagramChanges, useLiveFixes } from "./session/useLiveFixes";
import { useLiveKeyboard } from "./session/useLiveKeyboard";
import { useSlowTraceCard, useTraceActions, useTraceSlowMotion, useTraceSpotlight } from "./session/useTraceSpotlight";
import { SlowCaption } from "./slowmo/SlowBar";
// Loaded on first use: the sequence generator, its SVG renderer and Mermaid writer.
const SequenceDialog = lazy(() => import("./SequenceDialog").then((m) => ({ default: m.SequenceDialog })));

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
}: SessionProps) {
  // Every move of the view goes through the canvas camera (src/canvas/camera): Live only says what changed.
  const camera = useCameraController();
  if (!camera) throw new Error("LiveSession needs a camera (CameraContext)");
  const locale = useLocale();
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const { theme } = useSettings();
  const setup = useLiveSetup({ editor, diagram, params, simulations: simsProp });
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
  } = setup;

  useLiveDiagramChanges({ ...setup, editor, privateDiagram });

  const { slowRef, slowPath, setSlowPath, spotlightRef, reducedMotion } = useTraceSpotlight({ ...setup, camera });

  useLivePanelLayout(setup);

  const { setCanvas, setOverlay, rendererKind } = useFrameLoop({
    controller,
    store,
    theme,
    presenting,
    reducedMotion,
    slowRef,
    spotlightRef,
  });

  const { sequence, setSequence, startTrace, cardRoom, shownNotice, sendOne } = useTraceActions({
    ...setup,
    slowRef,
    presenting,
  });

  const { capacityError, setCapacityError, clearCapacityError } = useCapacityError();

  const commands = useLiveCommands({ setup, editor, onSaveDiagram, slowRef, setCapacityError });
  const { selectSimulation, showSimulation, runDraft, saveSimulation, deleteSimulation, showEvents } = commands;

  const { rec, dispatchRec, capturing } = useLiveRecordingState();

  const { slow, slowMotionTrace } = useTraceSlowMotion(
    { controller, store, camera, presenting, reducedMotion, panelOpen: panel.open, capturing },
    slowRef,
    slowPath,
    setSlowPath,
  );
  useLiveSessionBridge({ setup, onSession, selectSimulation, editor, alwaysOn, slow });
  const slowCard = useSlowTraceCard(slow);
  const { openRecord, recordTarget, recordTitle } = useLiveRecording({ setup, dispatchRec, store });

  const capacityInputs = useCapacityInputs({ ...setup, params, locale, slowRef, editor });
  const { showCapacity, planDiagram, capacity, openCapacity, closeCapacity, applyFix } = capacityInputs;

  const {
    addReader,
    runTroubleAction,
    troubleOnScreen,
    troubleAnnouncement,
    troubleActionHere,
    troubleShown,
    dismissTrouble,
    saveInputs,
  } = useLiveFixes({
    ...setup,
    ...commands,
    editor,
    slowRef,
    camera,
    presenting,
    capturing,
    showCapacity,
    capacity,
    openCapacity,
    setCapacityError,
    onSaveDiagram,
  });

  const addEntry = useCapacityEntry({ ...setup, editor, store, camera });

  useLiveContextMenu({
    ...setup,
    ...commands,
    ...capacityInputs,
    editor,
    store,
    slowRef,
    slowMotionTrace,
    startTrace,
    openRecord,
    onPanelChange,
  });

  useLiveKeyboard({ ...setup, presenting, alwaysOn, onExit, editor, slowRef });

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

  return (
    <LiveContext.Provider value={ui}>
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
            <button onClick={() => setTrace(null)} data-testid="live-trace-clear" aria-label="Clear highlight">
              <LiveIcon name="close" size={12} />
            </button>
          </div>
        )}
        {/* Mounted empty first, so the cause is heard when it's written; it changes only with the cause. */}
        <span ref={troubleAnnouncement} className="sr-only" role="status" data-testid="trouble-announce" />
        {troubleOnScreen ? (
          <TroubleCallout
            trouble={troubleOnScreen}
            onShown={troubleShown}
            floating
            onAction={troubleActionHere(troubleOnScreen) ? runTroubleAction : undefined}
            onDismiss={dismissTrouble}
            disabledHint={
              troubleOnScreen.action.kind === "events" || troubleOnScreen.action.kind === "inputs"
                ? undefined
                : liveMutationGuard(() => slow.session.active).hint()
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
        {slowCard && !capturing ? (
          <TraceCard
            trace={slowCard.trace}
            diagram={controller.currentDiagram}
            now={slowCard.trace.current?.endedAt ?? state.snapshot.time}
            onClose={slow.end}
            onSequence={() => slowCard.trace.current && setSequence(slowCard.trace.current)}
            room={cardRoom}
            slowmo={slowCard.card}
          />
        ) : (
          state.trace &&
          !capturing && (
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
                  ? `${slow.state.armedAt ? `Waiting for the next message at ${controller.currentDiagram.nodes.find((n) => n.id === slow.state.armedAt)?.label ?? slow.state.armedAt}` : "Waiting for the next message"}: slow motion starts when it comes…`
                  : undefined
              }
            />
          )
        )}
        <SlowCaption slow={slow.session} />
        {/* Live's narration waits with live while slow motion plays. */}
        {slow.state.status !== "on" && <NoteCallout state={state} />}
        {events.open && !capturing && <EventLog state={state} />}
        {/* While recording, the indicator (Stop, Esc) stands in for the bar. */}
        {!capturing && <ControlBar state={state} />}
      </div>
      {capacityOpen && capacity && (
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
    </LiveContext.Provider>
  );
}

export { EditCapacity } from "./session/EditCapacity";
