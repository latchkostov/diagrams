import { defineLazySurface } from "../../lib/lazySurface";
import { PanelUnavailable } from "./PanelUnavailable";

export const NodeIdentity = defineLazySurface({
  id: "inspector.identity",
  load: () => import("./NodeIdentity").then((m) => m.NodeIdentity),
  placeholder: {
    size: {},
    testId: "inspector.identity-loading",
    render: (props, status) => (status.failed ? <PanelUnavailable owner={props.node.id} /> : null),
  },
  focus: {},
  export: "skip",
  retryToast: true,
});
