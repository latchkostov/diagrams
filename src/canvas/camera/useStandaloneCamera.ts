import { useCallback, useEffect, useState } from "react";
import { useReactFlow, useStoreApi, type OnMoveStart } from "@xyflow/react";
import { motionMs } from "../../lib/motion";
import { createCameraOwnership } from "../cameraOwnership";
import type { DiagramFlowEdge, FlowNode } from "../types";
import { createCameraController, type CameraPort } from "./controller";
import { liveFitViewport, noteFitViewport } from "./geometry";
import { cameraJournal } from "./journal";
import { canvasMove, paneSample } from "./useCameraCore";

/**
 * A camera for a React Flow that isn't the canvas (the Lab's live stages): the same controller, with Live's
 * geometry and none of the canvas's (no Inspector, menus, selection reveals or overlay-aware fits). React Flow's
 * own `fitView` prop opens it. Provide it through CameraContext and pass `onMoveStart` to React Flow.
 */
export function useStandaloneCamera() {
  const { setViewport } = useReactFlow<FlowNode, DiagramFlowEdge>();
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const [controller] = useState(() => {
    const transform = () => {
      const [x, y, zoom] = store.getState().transform;
      return { x, y, zoom };
    };
    const port: CameraPort = {
      viewport: transform,
      move: (target, o) => canvasMove(store, setViewport, target, o),
      fitTarget: () => null,
      revealTarget: () => null,
      centerTarget: () => null,
      goToTarget: () => null,
      zoomTarget: () => null,
      liveFitTarget: (room) => liveFitViewport(store.getState(), room),
      noteFitTarget: (focus, room) => noteFitViewport(store.getState(), focus, room),
      paneSample: () => {
        const s = store.getState();
        const el = s.domNode;
        return el ? paneSample(s, el, () => true) : null;
      },
      selectionMeasured: () => true,
      hasSelection: () => false,
      afterMeasured: (run) => void run(),
      interruptMeasured() {},
      cancelBootstrapFit() {},
      publish(phase) {
        const el = store.getState().domNode;
        if (el) el.dataset.cameraState = phase;
      },
      fitted() {},
    };
    return createCameraController(
      port,
      {
        frame(run) {
          const id = requestAnimationFrame(run);
          return () => cancelAnimationFrame(id);
        },
      },
      createCameraOwnership(),
      { motion: motionMs, journal: cameraJournal },
    );
  });
  useEffect(() => controller.connect(), [controller]);
  const onMoveStart: OnMoveStart = useCallback((e) => controller.moveStarted(!!e), [controller]);
  return { controller, onMoveStart };
}
