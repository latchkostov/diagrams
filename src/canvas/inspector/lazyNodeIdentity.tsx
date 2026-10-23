import { lazyComponent } from "../../lib/lazyLoad";
import { PanelUnavailable } from "./PanelUnavailable";

export const NodeIdentity = lazyComponent(
  () => import("./NodeIdentity").then((m) => m.NodeIdentity),
  (props, status) => (status.failed ? <PanelUnavailable owner={props.node.id} /> : null),
  true,
);
