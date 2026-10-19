import { useState, type ComponentProps } from "react";
import { domActive } from "../canvas/interaction";
import { t, useLocale } from "../i18n";
import { lazyComponent, type LoadStatus } from "../lib/lazyLoad";
import type { ElementHandle } from "../canvas/interaction/types";
import { LiveIcon } from "./icons";
import { usePanelEscape } from "./usePanelEscape";

function LoadingCapacity({
  onClose,
  opener,
  failed,
  retry,
}: LoadStatus & { onClose(): void; opener?: ElementHandle | null }) {
  useLocale();
  usePanelEscape(onClose, undefined, opener);
  return (
    <aside
      className="lv-panel cap-panel"
      data-testid="capacity-panel"
      data-editor-overlay
      aria-label={t("broker.inputs")}
    >
      <header className="lv-panel-head">
        <strong>{t("broker.inputs")}</strong>
        <button
          className="lv-btn lv-panel-close"
          data-testid="capacity-close"
          onClick={onClose}
          aria-label={t("common.close")}
        >
          <LiveIcon name="close" size={13} />
        </button>
      </header>
      <div className="lv-panel-body">
        <p role={failed ? "alert" : "status"}>{failed ? t("fileDialog.loadFailed") : t("common.loading")}</p>
        {failed && (
          <button className="link-btn" data-testid="capacity-load-retry" onClick={retry}>
            {t("common.retry")}
          </button>
        )}
      </div>
    </aside>
  );
}

const LazyCapacityPanel = lazyComponent(
  () => import("./CapacityPanel").then((m) => m.CapacityPanel),
  (props, status) => <LoadingCapacity onClose={props.onClose} opener={props.opener} {...status} />,
);

export function CapacityPanel(props: ComponentProps<typeof LazyCapacityPanel>) {
  const [opener] = useState(domActive);
  return <LazyCapacityPanel {...props} opener={opener} />;
}
CapacityPanel.preload = LazyCapacityPanel.preload;
