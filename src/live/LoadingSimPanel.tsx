import { t, useLocale } from "../i18n";
import type { LoadStatus } from "../lib/lazyLoad";
import { LiveIcon } from "./icons";
import { usePanelEscape } from "./usePanelEscape";
export function LoadingPanel({ onClose, failed, retry }: LoadStatus & { onClose(): void }) {
  useLocale();
  usePanelEscape(onClose);
  return (
    <aside className="lv-panel" data-testid="sim-panel" data-editor-overlay aria-label={t("htmlExport.simulations")}>
      <header className="lv-panel-head">
        <LiveIcon name="storm" size={16} />
        <strong>{t("htmlExport.simulations")}</strong>
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
