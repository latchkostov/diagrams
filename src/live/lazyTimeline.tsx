import { defineLazySurface } from "../lib/lazySurface";
import type { ComponentProps } from "react";
import type { Timeline as TimelineComponent } from "./Timeline";

export const Timeline = defineLazySurface<ComponentProps<typeof TimelineComponent>>({
  id: "live.timeline",
  load: () => import("./Timeline").then((m) => m.SimulationTimeline),
  placeholder: {
    size: {},
    testId: "live.timeline-loading",
    render: () => <div className="lv-timeline" data-testid="live-timeline-loading" aria-busy="true" />,
  },
  focus: { restoreTo: "live-play", panel: "live-controls" },
  export: "skip",
  retryToast: true,
});
