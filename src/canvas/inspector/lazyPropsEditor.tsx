import { lazyComponent } from "../../lib/lazyLoad";

/** Free-form properties are only needed after Advanced opens. */
export const PropsEditor = lazyComponent(() => import("./PropsEditor").then((m) => m.PropsEditor));
