import { defineLazySurface } from "../lib/lazySurface";
export const TraceCard = defineLazySurface({
  id: "live.trace",
  load: () => import("./TraceCard").then((m) => m.TraceCard),
  placeholder: {},
  focus: {},
  export: "skip",
  retryToast: true,
});
