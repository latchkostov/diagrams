import { lazyComponent, loadOnce } from "../lib/lazyLoad";

const load = loadOnce(() => import("./CallPills"));
export const CallPills = lazyComponent(() => load().then((m) => m.CallPills));
export const ThreadMeter = lazyComponent(() => load().then((m) => m.ThreadMeter));
