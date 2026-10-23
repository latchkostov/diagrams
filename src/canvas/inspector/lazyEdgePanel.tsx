import { lazyComponent, LOAD_FAILED, type LoadStatus } from "../../lib/lazyLoad";
import { t } from "../../i18n";
import { useCallback, useEffect, type ComponentProps } from "react";
import { useInteraction } from "../interaction/useInteraction";
import { PanelUnavailable } from "./PanelUnavailable";
import { notify } from "../../interop/ui/toast";

const DeferredEdgePanel = lazyComponent(
  () => import("./EdgePanel").then((m) => m.EdgePanel),
  (props, status) => <PendingEdge owner={props.edge.id} request={props.edge.data?.kind === "sync"} {...status} />,
);

export function EdgePanel(props: ComponentProps<typeof DeferredEdgePanel>) {
  return <DeferredEdgePanel {...props} />;
}

/** Recovery ships with the shell; the interaction controller holds naming until the deferred field arrives. */
function PendingEdge({ owner, request, failed, retry: load }: LoadStatus & { owner: string; request: boolean }) {
  const interaction = useInteraction();
  const retry = useCallback(() => {
    interaction?.dispatch({ type: "panel.field", panel: "inspector", field: "inspector-field-label" });
    load();
  }, [interaction, load]);
  useEffect(() => {
    if (failed)
      notify(LOAD_FAILED, {
        kind: "error",
        action: { label: t("hover.retry"), run: retry, testId: "lazy-load-retry" },
      });
  }, [failed, retry]);
  return (
    <div className="insp-section" data-testid="inspector-edge-loading">
      {failed ? (
        <>
          <PanelUnavailable owner={owner} />
          {t("hover.failed")}{" "}
          <button className="link-btn" data-testid="inspector-edge-retry" onClick={retry}>
            {t("hover.retry")}
          </button>
        </>
      ) : request ? (
        <p className="insp-note" role="status" aria-live="polite" data-testid="call-fields-loading">
          {t("common.loading")}
        </p>
      ) : (
        t("common.loading")
      )}
    </div>
  );
}
