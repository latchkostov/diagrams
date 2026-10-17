import { useEffect, useLayoutEffect, useRef } from "react";
import { useFullscreen } from "../../lib/fullscreen";
import { LIVE_BAR_SPACE } from "../../live/layout";
import { FIT, FIT_PRESENT } from "./fitOptions";
import type { CameraCore } from "./useCameraCore";

/** Opening, presenting, live view and full screen fit the diagram (clear of the live bar in live view). */
export function useModeFit(
  { overlayFit, camera, firstFit }: Pick<CameraCore, "overlayFit" | "camera" | "firstFit">,
  presenting: boolean,
  live: boolean,
) {
  // Opening/mode changes fit before paint, then refine when measurements settle.
  useLayoutEffect(() => {
    overlayFit({
      maxZoom: (presenting ? FIT_PRESENT : FIT).maxZoom,
      margin: presenting ? 64 : 40,
      insets: live ? { bottom: LIVE_BAR_SPACE } : undefined,
      duration: firstFit.current ? 350 : 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a fit request on opening or mode changes only
  }, [presenting, live]);
  const fullscreen = useFullscreen();
  const lastFullscreen = useRef(fullscreen);
  useEffect(() => {
    if (lastFullscreen.current === fullscreen) return;
    lastFullscreen.current = fullscreen;
    if (!presenting || camera.owner !== "fit") return;
    overlayFit({
      maxZoom: FIT_PRESENT.maxZoom,
      margin: 64,
      insets: live ? { bottom: LIVE_BAR_SPACE } : undefined,
      duration: 350,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit when full screen changes only
  }, [fullscreen]);
}
