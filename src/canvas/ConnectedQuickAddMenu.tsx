import { useEffect, useState, type RefObject } from "react";
import { useReactFlow, useStore, useStoreApi } from "@xyflow/react";
import { ContextMenu, type ContextMenuProps } from "../components/ContextMenu";
import { panIntoView } from "./geometry/fit";
import { union, type Rect } from "./geometry/rect";
import { motionMs } from "../lib/motion";

export interface ConnectedMenuAnchor {
  spot: Rect;
  card: Rect;
  left: boolean;
  width: number;
}

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
  const [origin, setOrigin] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const bounds = el.getBoundingClientRect();
      setOrigin((old) =>
        old?.left === bounds.left && old.top === bounds.top ? old : { left: bounds.left, top: bounds.top },
      );
      const [x, y, zoom] = store.getState().transform;
      const room = (anchor.width + 16) / zoom;
      const want =
        union([
          anchor.card,
          { ...anchor.spot, x: anchor.left ? anchor.spot.x - room : anchor.spot.x, width: anchor.spot.width + room },
        ]) ?? anchor.spot;
      const viewport = panIntoView(
        want,
        anchor.spot,
        { x, y, zoom },
        { x: 24, y: 24, width: bounds.width - 48, height: bounds.height - 48 },
      );
      if (viewport) void setViewport(viewport, { duration: motionMs(200) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [anchor, root, store, setViewport]);
  if (!origin) return <ContextMenu {...props} />;
  const sx = origin.left + anchor.spot.x * zoom + x;
  const sy = origin.top + anchor.spot.y * zoom + y;
  return (
    <ContextMenu
      {...props}
      x={anchor.left ? sx - 8 - anchor.width : sx + anchor.spot.width * zoom + 8}
      flipX={sx - 8}
      y={sy}
    />
  );
}
