import { useCallback } from "react";
import type { OnMove, OnMoveStart } from "@xyflow/react";
import type { CameraController } from "./controller";

/**
 * React Flow's move start and move: a pan or zoom by hand (an event) makes the view the user's; a start without
 * one is the controller's own move or someone else's (Live, the minimap), which the controller tells apart.
 * Handlers keep their identity across renders (a new node handler re-renders every node).
 */
export function useMoveHandlers(controller: CameraController, hideTip: () => void, setMenu: (menu: null) => void) {
  const onMoveStart: OnMoveStart = useCallback(
    (e) => {
      // A pan by hand closes menus; the app's own (a new node brought into view) doesn't: quick-add
      // opened right after naming the last node must stay open while the view settles.
      if (e) setMenu(null);
      hideTip();
      controller.moveStarted(!!e);
    },
    [hideTip, controller, setMenu],
  );
  const onMove: OnMove = useCallback(
    (e) => {
      // Wheel input can interrupt a running transition without another move-start.
      // Only actual viewport movement counts; scrolling a panel or embed page does not.
      if (e) controller.userMoved();
    },
    [controller],
  );
  return { onMoveStart, onMove };
}
