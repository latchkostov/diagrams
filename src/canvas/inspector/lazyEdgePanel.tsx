import { defineLazySurface } from "../../lib/lazySurface";
import { type LoadStatus } from "../../lib/lazyLoad";
import { t } from "../../i18n";
import { type ComponentProps } from "react";
import { PanelUnavailable } from "./PanelUnavailable";

const DeferredEdgePanel = defineLazySurface({
  id: "inspector.edge",
  load: () => import("./EdgePanel").then((m) => m.EdgePanel),
  placeholder: {
    size: {},
    testId: "inspector.edge-loading",
    render: (props, status) => <PendingEdge owner={props.edge.id} {...status} />,
  },
  focus: { field: "inspector-field-label" },
  export: "skip",
  retryToast: true,
});

export function EdgePanel(props: ComponentProps<typeof DeferredEdgePanel>) {
  return <DeferredEdgePanel {...props} />;
}

/** Recovery ships with the shell; the interaction controller holds naming until the deferred field arrives. */
function PendingEdge({ owner, failed, retry }: LoadStatus & { owner: string }) {
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
      ) : (
        t("common.loading")
      )}
    </div>
  );
}
