import { lazyComponent } from "../../lib/lazyLoad";
import { t } from "../../i18n";
import type { ComponentProps } from "react";

export function MessageFieldsLoading() {
  return (
    <p className="insp-note" role="status" data-testid="message-fields-loading">
      {t("common.loading")}
    </p>
  );
}

const LazyEdgeMessages = lazyComponent(
  () => import("./MessageFields").then((module) => module.EdgeMessages),
  (_, { failed }) => (failed ? null : <MessageFieldsLoading />),
  true,
);
const LazyNodeMessages = lazyComponent(
  () => import("./MessageFields").then((module) => module.NodeMessages),
  (_, { failed }) => (failed ? null : <MessageFieldsLoading />),
  true,
);

export function EdgeMessages(props: ComponentProps<typeof import("./MessageFields").EdgeMessages>) {
  return <LazyEdgeMessages {...props} />;
}
export function NodeMessages(props: ComponentProps<typeof import("./MessageFields").NodeMessages>) {
  return <LazyNodeMessages {...props} />;
}
