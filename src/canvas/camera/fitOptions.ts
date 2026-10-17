import type { FitViewOptions } from "@xyflow/react";

// Pixel padding keeps the title card (top-left) from covering the diagram.
export const FIT: FitViewOptions = {
  padding: { top: "110px", right: "48px", bottom: "48px", left: "48px" },
  maxZoom: 1.25,
};
export const FIT_PRESENT: FitViewOptions = {
  padding: { top: "190px", right: "64px", bottom: "64px", left: "64px" },
  maxZoom: 1.6,
};
