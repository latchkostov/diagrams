import { panIntoView, type Viewport } from "./fit";
import { union, type Rect } from "./rect";

export interface ConnectedMenuAnchor {
  spot: Rect;
  card: Rect;
  left: boolean;
  width: number;
}

/** Physical menu coordinates and the pan reserving room for the card, outline and menu. */
export function connectedMenuPlacement(anchor: ConnectedMenuAnchor, view: Viewport, bounds: Rect) {
  const { spot, card, left, width } = anchor;
  const room = (width + 16) / view.zoom;
  const want = union([card, { ...spot, x: left ? spot.x - room : spot.x, width: spot.width + room }]) ?? spot;
  const sx = bounds.x + spot.x * view.zoom + view.x;
  return {
    viewport: panIntoView(want, spot, view, { x: 24, y: 24, width: bounds.width - 48, height: bounds.height - 48 }),
    position: {
      x: left ? sx - 8 - width : sx + spot.width * view.zoom + 8,
      flipX: sx - 8,
      y: bounds.y + spot.y * view.zoom + view.y,
    },
  };
}
