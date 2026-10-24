import { defineLazySurface } from "../lib/lazySurface";

export const BottleneckCallout = defineLazySurface({
  id: "live.bottleneck",
  load: () => import("./BottleneckCallout").then((m) => m.BottleneckCallout),
  placeholder: { size: {}, testId: "live.bottleneck-loading" },
  focus: {},
  export: "skip",
  retryToast: true,
});
