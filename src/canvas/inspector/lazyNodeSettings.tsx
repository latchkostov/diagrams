import { defineLazySurface } from "../../lib/lazySurface";
import { t } from "../../i18n";
import { surfaceCatalogs } from "../../i18n/surfaces";

// Naming stays eager: its ownership must precede the first key after a menu pick.
export const NodeSettings = defineLazySurface({
  id: "inspector.node-settings",
  load: async () => {
    const [m] = await Promise.all([import("./NodeSettings"), surfaceCatalogs(["simulation"])]);
    return m.NodeSettings;
  },
  placeholder: {
    render: (_props, { failed }) => (
      <div data-testid="inspector.node-settings-loading" aria-busy={!failed}>
        <div role="status" data-testid="inspector.simulation-loading" aria-busy={!failed}>
          {failed ? t("fileDialog.loadFailed") : t("common.loading")}
        </div>
      </div>
    ),
  },
  focus: {},
  export: "skip",
  retryToast: true,
});
