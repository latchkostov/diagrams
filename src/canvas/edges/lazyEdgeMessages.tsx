import { lazyComponent } from "../../lib/lazyLoad";

/** The same intent reader in editor, read-only and Lab canvas hosts. */
export const EdgeMessages = lazyComponent(() => import("./EdgeMessages").then((m) => m.EdgeMessages));
