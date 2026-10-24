import { defineLazySurface } from "../lib/lazySurface";
import { loadOnce } from "../lib/lazyLoad";

const load = loadOnce(() => import("./CallPills"));
export const CallPills = defineLazySurface({
  id: "live.calls",
  load: () => load().then((m) => m.CallPills),
  placeholder: { size: {}, testId: "live.calls-loading" },
  focus: {},
  export: "await",
  retryToast: true,
});
export const ThreadMeter = defineLazySurface({
  id: "live.threads",
  load: () => load().then((m) => m.ThreadMeter),
  placeholder: { size: {}, testId: "live.threads-loading" },
  focus: {},
  export: "await",
  retryToast: true,
});
