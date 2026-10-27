import type { FitViewOptions } from "@xyflow/react";

// Pixel padding clears the view control at the bottom-right of the canvas.
export const FIT: FitViewOptions = {
  padding: { top: "32px", right: "40px", bottom: "72px", left: "32px" },
  maxZoom: 1.25,
};
export const FIT_PRESENT: FitViewOptions = {
  padding: { top: "56px", right: "56px", bottom: "56px", left: "56px" },
  maxZoom: 1.6,
};
