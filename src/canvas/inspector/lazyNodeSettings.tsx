import { defineLazySurface } from "../../lib/lazySurface";

// Naming stays eager: its ownership must precede the first key after a menu pick.
export const NodeSettings = defineLazySurface({
  id: "inspector.node-settings",
  load: () => import("./NodeSettings").then((m) => m.NodeSettings),
  placeholder: { testId: "inspector.node-settings-loading" },
  focus: {},
  export: "skip",
  retryToast: true,
});
