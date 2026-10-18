import { useStoreApi } from "@xyflow/react";
import { useEffect } from "react";
import type { DiagramFlowEdge, FlowNode } from "../../canvas/types";
import { actionRegistry, builtinSections } from "../../editor/actions";
import type { DiagramFile } from "../../model/types";
import { type InjectRequest } from "../InjectDialog";
import { capacityView, type CapacityFix } from "../capacityModel";
import { type TraceChoice } from "../context";
import { LiveController } from "../controller";
import { liveActions, liveMutationGuard } from "../liveActions";
import { type SlowMotionView } from "../slowmo/useSlowMotion";
import { suggestedMessageType } from "../storm";

import type { Dispatch, RefObject, SetStateAction } from "react";
import type { SessionProps } from "../LiveSession";
export function useLiveContextMenu({
  editor,
  controller,
  store,
  slowRef,
  traceRef,
  setTrace,
  setInject,
  startStorm,
  showEvents,
  slowMotionTrace,
  startTrace,
  getDiagram,
  flash,
  openRecord,
  capacity,
  applyFix,
  openCapacity,
  panel,
  onPanelChange,
}: Pick<SessionProps, "editor" | "onPanelChange"> & {
  controller: LiveController;
  store: ReturnType<typeof useStoreApi<FlowNode, DiagramFlowEdge>>;
  slowRef: RefObject<SlowMotionView | null>;
  traceRef: RefObject<string | null>;
  setTrace: Dispatch<SetStateAction<string | null>>;
  setInject: Dispatch<SetStateAction<InjectRequest | null>>;
  startStorm: (nodeId: string) => void;
  showEvents: (nodeId: string | null, open?: boolean) => void;
  slowMotionTrace: () => void;
  startTrace: (which: TraceChoice) => void;
  getDiagram: () => DiagramFile;
  flash: (text: string) => void;
  openRecord: () => void;
  capacity: ReturnType<typeof capacityView> | null;
  applyFix: (fix: CapacityFix) => void;
  openCapacity: (open?: boolean) => void;
  panel: { open: boolean };
}) {
  // While live, the Simulation section leads every context menu.
  useEffect(() => {
    if (!editor) return;
    const builtin = builtinSections.find((x) => x.id === "simulation");
    // eslint-disable-next-line local/no-literal-ui-text -- Existing LiveSession copy, moved verbatim.
    const off = actionRegistry.registerSection({ id: "simulation", order: 5, title: "Live" });
    return () => {
      off();
      if (builtin) actionRegistry.registerSection(builtin);
    };
  }, [editor]);

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
          flash("Saved the live changes to the diagram (undo with Ctrl+Z).");
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
        // eslint-disable-next-line local/no-literal-ui-text -- Existing LiveSession copy, moved verbatim.
        label: "Edit Inputs & capacity",
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
        // eslint-disable-next-line local/no-literal-ui-text -- Existing LiveSession copy, moved verbatim.
        label: "Apply capacity fix",
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
