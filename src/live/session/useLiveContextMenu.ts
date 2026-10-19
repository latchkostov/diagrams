import { useInteraction } from "../../canvas/interaction";
import { SimPanel } from "../lazySimPanel";
import { t, useLocale } from "../../i18n";
import { useStoreApi } from "@xyflow/react";
import { useEffect } from "react";
import type { DiagramFlowEdge, FlowNode } from "../../canvas/types";
import { actionRegistry, builtinSections } from "../../editor/actions";
import { liveActions, liveMutationGuard } from "../liveActions";
import { suggestedMessageType } from "../storm";
import type { CapacityInputs } from "./useCapacityInputs";
import type { LiveCommands, LiveRecording } from "./useLiveCommands";
import type { LiveSessionState } from "./useLiveSessionState";
import type { TraceActions, TraceSlowMotion, TraceSpotlight } from "./useTraceSpotlight";

import type { SessionProps } from "../LiveSession";
export function useLiveContextMenu({
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
}: Pick<SessionProps, "editor" | "onPanelChange"> & {
  session: LiveSessionState;
  commands: LiveCommands;
  capacity: CapacityInputs;
  spotlight: TraceSpotlight;
  tracing: TraceActions;
  motion: TraceSlowMotion;
  recording: LiveRecording;
  store: ReturnType<typeof useStoreApi<FlowNode, DiagramFlowEdge>>;
}) {
  const locale = useLocale();
  const interaction = useInteraction();
  useEffect(
    () =>
      interaction?.subscribe(() => {
        if (interaction.menu?.kind === "context") SimPanel.preload();
      }),
    [interaction],
  );
  const { controller, traceRef, setTrace, setInject, getDiagram, flash, panel } = session;
  const { slowRef } = spotlight;
  const { startStorm, showEvents } = commands;
  const { startTrace } = tracing;
  const { slowMotionTrace } = motion;
  const { openRecord } = recording;
  const { capacity, applyFix, openCapacity } = capacityInputs;
  // While live, the Simulation section leads every context menu.
  useEffect(() => {
    if (!editor) return;
    const builtin = builtinSections.find((x) => x.id === "simulation");
    const off = actionRegistry.registerSection({ id: "simulation", order: 5, title: t("fileDialog.live") });
    return () => {
      off();
      if (builtin) actionRegistry.registerSection(builtin);
    };
  }, [editor, locale]);

  // This is temporary visibility, not a persisted editor preference.
  useEffect(() => {
    onPanelChange?.(panel.open);
    return () => onPanelChange?.(false);
  }, [panel.open, onPanelChange]);

  // Context-menu actions (canvas only).
  useEffect(() => {
    if (!editor) return;
    return actionRegistry.register([
      ...liveActions({
        controller,
        slowMotionActive: () => !!slowRef.current?.session.active,
        openInject: (nodeId, at) => {
          const t = store.getState().transform;
          const rect = store.getState().domNode?.getBoundingClientRect();
          const x = at && rect ? at.x * t[2] + t[0] + rect.left : window.innerWidth / 2;
          const y = at && rect ? at.y * t[2] + t[1] + rect.top : window.innerHeight / 2;
          setInject({ nodeId, x, y });
        },
        startStorm,
        showEvents: (id) => showEvents(id),
        trace: setTrace,
        tracing: () => traceRef.current,
        traceNext: (nodeId) => {
          slowRef.current?.end();
          controller.traceNext(nodeId);
        },
        slowMotion: (nodeId) => slowRef.current?.start({ kind: "next", node: nodeId }),
        slowMotionTrace,
        canReplayTrace: () => !!controller.getState().trace?.current && !slowRef.current?.session.on,
        traceSlowest: () => startTrace("slowest"),
        traceDeadLettered: () => startTrace("deadletter"),
        endTrace: () => {
          slowRef.current?.end();
          controller.endTrace();
        },
        tracingMessage: () => controller.getState().trace !== null,
        saveTweaks: (nodeId) => {
          const tweak = controller.getState().tweaks.get(nodeId);
          if (!tweak) return;
          const patch: Record<string, unknown> = { ...tweak.props };
          if (tweak.status) patch.status = tweak.status === "up" ? undefined : tweak.status;
          editor.setNodeProps(nodeId, patch);
          controller.clearTweaks(nodeId);
          flash(t("liveSession.savedChanges"));
        },
        messageType: (nodeId) => suggestedMessageType(getDiagram(), nodeId),
        openRecord,
      }),
      {
        id: "sim.inputs",
        section: "simulation",
        targets: ["canvas"],
        modes: ["live"],
        paletteOnly: true,
        label: t("liveSession.editInputs"),
        icon: "sliders",
        ...liveMutationGuard(() => !!slowRef.current?.session.active),
        run: () => openCapacity(),
      },
      {
        id: "sim.capacity-fix",
        section: "simulation",
        targets: ["canvas"],
        modes: ["live"],
        paletteOnly: true,
        label: t("planning.apply"),
        icon: "check",
        when: () => !!capacity?.fix,
        ...liveMutationGuard(() => !!slowRef.current?.session.active),
        run: () => {
          if (capacity?.fix) applyFix(capacity.fix);
        },
      },
    ]);
    // Session-owned refs and setters are stable; preserve the original dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    locale,
    editor,
    controller,
    store,
    startStorm,
    showEvents,
    getDiagram,
    flash,
    openRecord,
    startTrace,
    slowMotionTrace,
    capacity,
    applyFix,
    openCapacity,
  ]);
}
