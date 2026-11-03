import { defineLazySurface } from "../../lib/lazySurface";
import { surfaceCatalogs } from "../../i18n/surfaces";

// Naming stays eager: its ownership must precede the first key after a menu pick.
export const NodeSettings = defineLazySurface({
  id: "inspector.node-settings",
  load: async () => {
    const [m] = await Promise.all([import("./NodeSettings"), surfaceCatalogs(["simulation"])]);
    return m.NodeSettings;
  },
  placeholder: { testId: "inspector.node-settings-loading" },
  focus: {},
  export: "skip",
  retryToast: true,
});
