import { useEffect, useState, type RefObject } from "react";
import { useReactFlow, useStore, useStoreApi } from "@xyflow/react";
import { ContextMenu, type ContextMenuProps } from "../components/ContextMenu";
import { connectedMenuPlacement, type ConnectedMenuAnchor } from "./geometry/connectedMenuPlacement";
import { motionMs } from "../lib/motion";

/** Follow the outline through an Inspector reveal, including RTL's left-hand pane resize. */
export function ConnectedQuickAddMenu({
  anchor,
  root,
  ...props
}: ContextMenuProps & {
  anchor: ConnectedMenuAnchor;
  root: RefObject<HTMLDivElement | null>;
}) {
  // Only this menu renders on a pan; the diagram and stencil rail do not subscribe.
  const [x, y, zoom] = useStore((state) => state.transform);
  const store = useStoreApi();
  const { setViewport } = useReactFlow();
  const [bounds, setBounds] = useState<DOMRect | null>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const bounds = el.getBoundingClientRect();
      setBounds((old) =>
        old?.x === bounds.x && old.y === bounds.y && old.width === bounds.width && old.height === bounds.height
          ? old
          : bounds,
      );
      const [x, y, zoom] = store.getState().transform;
      const { viewport } = connectedMenuPlacement(anchor, { x, y, zoom }, bounds);
      if (viewport) void setViewport(viewport, { duration: motionMs(200) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [anchor, root, store, setViewport]);
  if (!bounds) return <ContextMenu {...props} />;
  const { position } = connectedMenuPlacement(anchor, { x, y, zoom }, bounds);
  return <ContextMenu {...props} {...position} />;
}
