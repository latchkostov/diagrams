import { defineLazySurface } from "../../lib/lazySurface";
import { PanelUnavailable } from "./PanelUnavailable";

export const NodePanel = defineLazySurface({
  id: "inspector.node",
  load: () => import("./NodePanel").then((m) => m.NodePanel),
  placeholder: {
    render: (props, status) => (status.failed ? <PanelUnavailable owner={props.node.id} /> : null),
  },
  focus: {},
  export: "skip",
  retryToast: true,
});
