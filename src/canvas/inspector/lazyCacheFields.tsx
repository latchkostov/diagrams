import { defineLazySurface } from "../../lib/lazySurface";
import { t } from "../../i18n";
import { surfaceCatalogs } from "../../i18n/surfaces";

export const CacheFields = defineLazySurface({
  id: "inspector.cache",
  load: async () => {
    const [m] = await Promise.all([
      import("../../planning/CacheFields"),
      import("../../sim/cache/cacheRuntime"),
      surfaceCatalogs(["simulation"]),
    ]);
    return m.CacheFields;
  },
  placeholder: {
    render: (_props, { failed }) => (
      <div role="status" data-testid="inspector.cache-loading" aria-busy={!failed}>
        {failed ? t("fileDialog.loadFailed") : t("common.loading")}
      </div>
    ),
  },
  focus: { restoreTo: "cache-add-rule" },
  export: "skip",
  retryToast: true,
});
