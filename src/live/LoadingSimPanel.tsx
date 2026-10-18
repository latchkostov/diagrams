import { useLayoutEffect } from "react";
import { useInteraction } from "../canvas/interaction";
import { t, useLocale } from "../i18n";
import type { LoadStatus } from "../lib/lazyLoad";
import { LiveIcon } from "./icons";
import { usePanelEscape } from "./usePanelEscape";
import type { ElementHandle } from "../canvas/interaction/types";
export function LoadingPanel({
  onClose,
  failed,
  retry,
  opener,
}: LoadStatus & { onClose(): void; opener?: ElementHandle | null }) {
  useLocale();
  usePanelEscape(onClose, undefined, opener);
  const interaction = useInteraction();
  useLayoutEffect(() => {
    interaction?.dispatch({
      type: "panel.field",
      panel: "sim-panel",
      field: failed ? "sim-panel-load-retry" : "sim-panel-heading",
    });
  }, [interaction, failed]);
  return (
    <aside className="lv-panel" data-testid="sim-panel" data-editor-overlay aria-label={t("htmlExport.simulations")}>
      <header className="lv-panel-head">
        <LiveIcon name="storm" size={16} />
        <strong tabIndex={-1} data-testid="sim-panel-heading">
          {t("htmlExport.simulations")}
        </strong>
        <button
          className="lv-btn lv-panel-close"
          onClick={onClose}
          aria-label={t("common.close")}
          data-testid="sim-panel-close"
        >
          <LiveIcon name="close" size={13} />
        </button>
      </header>
      <div className="lv-panel-body" data-testid="sim-panel-loading">
        {failed ? (
          <>
            <p role="alert" data-testid="sim-panel-load-error">
              {t("fileDialog.loadFailed")}
            </p>
            <button className="link-btn" onClick={retry} data-testid="sim-panel-load-retry">
              {t("common.retry")}
            </button>
          </>
        ) : (
          <p role="status">{t("common.loading")}</p>
        )}
      </div>
    </aside>
  );
}
