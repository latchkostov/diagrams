import { useStoreApi } from "@xyflow/react";
import type { FlowNode, DiagramFlowEdge } from "../../canvas/types";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { defineLazySurface } from "../../lib/lazySurface";
import type { InteractionController } from "../../canvas/interaction";
import { typeAheadActive } from "../../canvas/typeAhead";
import { replayKey } from "../replayKeys";
import { createTraceFacade } from "./traceFacade";
import type { TraceRuntimeProps } from "../slowmo/TraceRuntime";
import type { LiveSessionState } from "./useLiveSessionState";

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

export function useTraceRuntime({ controller, state }: LiveSessionState, interaction: InteractionController) {
  const loading =
    useSyncExternalStore(TraceRuntime.subscribe, TraceRuntime.getSnapshot, TraceRuntime.getSnapshot).value !== "loaded";
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
      (end, loaded) =>
        interaction.pendingOwner((e) => {
          if (loaded(e)) return true;
          if (!facade.pending) return false;
          const command = replayKey(e, "capturing");
          if (!command) return false;
          if (command === "escape") end();
          return true;
        }),
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
    return () => facade.dispose();
  }, [facade]);
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
    card: snapshot.service?.card,
    journeyReady: !!snapshot.service,
    journey: facade.journey,
  };
}
