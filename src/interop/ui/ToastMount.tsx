import { useSyncExternalStore } from "react";
import { lazyComponent, LOAD_FAILED } from "../../lib/lazyLoad";
import { loadToastRenderer, subscribe, toast } from "./toast";
import { t } from "../../i18n";

// The store is synchronous even before this renderer downloads: Undo binds at the edit, not on arrival.
// Recovery must ship outside that renderer too, since a failed Toaster cannot show its own failure toast.
const Renderer = lazyComponent(loadToastRenderer, (_props, { failed, retry }) =>
  failed ? (
    <div className="ix-toast ix-toast-error" role="alert" data-testid="toast-load-error" data-editor-overlay>
      {LOAD_FAILED}
      <button type="button" className="ix-toast-action" onClick={retry} data-testid="toast-load-retry">
        {t("common.retry")}
      </button>
    </div>
  ) : null,
);

export function ToastMount() {
  const needed = useSyncExternalStore(subscribe, () => toast.started);
  return needed ? <Renderer /> : null;
}
