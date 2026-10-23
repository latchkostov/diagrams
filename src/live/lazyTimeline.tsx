import { lazyComponent } from "../lib/lazyLoad";
import type { ComponentProps } from "react";
import type { Timeline as TimelineComponent } from "./Timeline";

export const Timeline = lazyComponent<ComponentProps<typeof TimelineComponent>>(
  () => import("./Timeline").then((m) => m.Timeline),
  () => <div className="lv-timeline" data-testid="live-timeline-loading" aria-busy="true" />,
  true,
);

export const SimulationExpectations = lazyComponent(() => import("./Timeline").then((m) => m.SimulationExpectations));
