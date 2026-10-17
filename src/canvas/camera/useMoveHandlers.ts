import { useCallback } from "react";
import type { OnMove, OnMoveStart } from "@xyflow/react";
import type { CameraCore } from "./useCameraCore";

/**
 * React Flow's move start and move: a pan or zoom by hand (an event), or by a command such as Shift+0 (no
 * event, and not our own fit starting), makes the view the user's. Handlers keep their identity across
 * renders (a new node handler re-renders every node).
 */
export function useMoveHandlers(
  {
    camera,
    interruptFit,
    fitStarting: fitStartingRef,
    firstFit: firstFitRef,
    fitEpoch: fitEpochRef,
    showingAll: showingAllRef,
  }: Pick<CameraCore, "camera" | "interruptFit" | "fitStarting" | "firstFit" | "fitEpoch" | "showingAll">,
  hideTip: () => void,
  setMenu: (menu: null) => void,
) {
  const onMoveStart: OnMoveStart = useCallback(
    (e) => {
      // A pan by hand closes menus; the app's own (a new node brought into view) doesn't: quick-add
      // opened right after naming the last node must stay open while the view settles.
      if (e) setMenu(null);
      if (e) camera.claim("manual");
      hideTip();
      // A pan or zoom by hand (an event), or by a command such as Shift+0 (no event, and not
      // our own fit starting), means the view is the user's now, not a fit.
      if (e || (!fitStartingRef.current && (firstFitRef.current || fitEpochRef.current > 0))) {
        interruptFit();
        showingAllRef.current = false;
      }
      fitStartingRef.current = null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and the state setter are stable
    [hideTip, interruptFit, camera],
  );
  const onMove: OnMove = useCallback(
    (e) => {
      // Wheel input can interrupt a running transition without another move-start.
      // Only actual viewport movement counts; scrolling a panel or embed page does not.
      if (e) {
        camera.claim("manual");
        fitStartingRef.current = null;
        interruptFit();
        showingAllRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable
    [interruptFit, camera],
  );
  return { onMoveStart, onMove };
}
