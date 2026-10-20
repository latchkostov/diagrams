import { lazyComponent } from "../lib/lazyLoad";

export const BottleneckCallout = lazyComponent(() => import("./BottleneckCallout").then((m) => m.BottleneckCallout));
