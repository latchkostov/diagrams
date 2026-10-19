import { lazyComponent, loadOnce } from "../lib/lazyLoad";

const load = loadOnce(() => import("./CallPills"));
export const CallPill = lazyComponent(() => load().then((m) => m.CallPill));
export const ThreadMeter = lazyComponent(() => load().then((m) => m.ThreadMeter));
