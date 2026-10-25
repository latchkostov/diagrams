import { useStoreApi } from "@xyflow/react";
import type { FlowNode, DiagramFlowEdge } from "../../canvas/types";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { defineLazySurface } from "../../lib/lazySurface";
import { useInteraction } from "../../canvas/interaction/context";
import { typeAheadActive } from "../../canvas/typeAhead";
import { isEditableTarget } from "../../editor/shortcuts";
import { isRecordingActive } from "../record/framing";
import { createTraceFacade } from "./traceFacade";
import type { TraceRuntimeProps } from "../slowmo/TraceRuntime";
import type { LiveSessionState } from "./useLiveSessionState";
import type { DiagramFile } from "../../model/types";
import type { MessageTrace } from "../../sim/types";

export const TraceRuntime = defineLazySurface<TraceRuntimeProps>({
  id: "live.trace-runtime",
  load: () =>
    import("../slowmo/TraceRuntime").then(async (m) => {
      await m.prepareRuntime();
      return m.TraceRuntime;
    }),
  placeholder: {},
  focus: {},
  export: "await",
  retryToast: true,
  pending: ({ facade }) => facade.pending || facade.slow.state.status === "capturing",
  ready: ({ facade }) => facade.settled(),
});

/** Output dialogs consume the requested take; other modal owners queue its camera handoff. */
const blocked = () =>
  typeAheadActive() ||
  !!document.querySelector('[aria-modal="true"]:not(:has([data-testid="image-export"], [data-testid="record-start"]))');

export function useTraceRuntime({ controller, state }: LiveSessionState) {
  const loading =
    useSyncExternalStore(TraceRuntime.subscribe, TraceRuntime.getSnapshot, TraceRuntime.getSnapshot).value !== "loaded";
  const interaction = useInteraction();
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const [facade] = useState(() =>
    createTraceFacade(
      controller,
      () => {
        const [x, y, zoom] = store.getState().transform;
        store.getState().unselectNodesAndEdges();
        return { x, y, zoom };
      },
      blocked,
    ),
  );
  const snapshot = useSyncExternalStore(facade.slow.session.subscribe, facade.getSnapshot, facade.getSnapshot);
  const slowRef = useRef(facade.slow);
  useEffect(() => {
    let generation = controller.getState().generation;
    return controller.subscribe(() => {
      const next = controller.getState().generation;
      if (generation === next) return;
      generation = next;
      if (facade.pending) facade.slow.end();
    });
  }, [controller, facade]);
  useLayoutEffect(() => {
    facade.connect();
    const key = (e: KeyboardEvent) => {
      if (!facade.pending || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (typeAheadActive()) {
        if (e.key === "Escape" && interaction?.escape()) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        return;
      }
      if (isEditableTarget(e.target) || document.querySelector('[role="menu"], [role="dialog"]')) return;
      if (!["Escape", " ", "Enter", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
      if (e.key === "Escape" && isRecordingActive()) return;
      if (
        e.key !== "Escape" &&
        e.target instanceof Element &&
        e.target.closest('button, select, a, [role="separator"]')
      )
        return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") facade.slow.end();
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      facade.dispose();
    };
  }, [facade, interaction]);
  useEffect(
    () =>
      TraceRuntime.subscribe(() => {
        if (TraceRuntime.getSnapshot().value === "failed") facade.fail();
      }),
    [facade],
  );
  return {
    facade,
    loading,
    slowRef,
    slow: facade.slow,
    active: !!state.trace || facade.pending || !!snapshot.service,
    path: snapshot.service?.slow.path ?? null,
    journey: (trace: MessageTrace, diagram: DiagramFile) => snapshot.service?.journey(trace, diagram) ?? null,
  };
}
