import { useEffect, useLayoutEffect, useRef } from "react";
import { useFullscreen } from "../../lib/fullscreen";
import type { CameraController } from "./controller";

/** Opening, presenting, live view and full screen fit the diagram (clear of the live bar in live view). */
export function useModeFit(controller: CameraController, presenting: boolean, live: boolean, readOnly = false) {
  // Opening/mode changes fit before paint, then refine when measurements settle.
  useLayoutEffect(() => {
    controller.mode({ live, presenting });
    if (readOnly && !live) controller.dispatch({ type: "view.requested", view: "overview" });
  }, [controller, presenting, live, readOnly]);
  const fullscreen = useFullscreen();
  const lastFullscreen = useRef(fullscreen);
  useEffect(() => {
    if (lastFullscreen.current === fullscreen) return;
    lastFullscreen.current = fullscreen;
    controller.dispatch({ type: "fullscreen.changed" });
  }, [controller, fullscreen]);
}
