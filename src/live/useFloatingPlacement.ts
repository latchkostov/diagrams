import { useLayoutEffect, useMemo, useState, type CSSProperties, type RefObject } from "react";
import { calloutOffset } from "./calloutPlacement";
import { inflate, type Rect } from "../canvas/geometry/rect";

/** Room a floating callout needs beside the title card for its words and buttons. */
const CALLOUT_MIN = 420;

/**
 * Where a floating callout sits: top centre (CSS), or, when the canvas leaves too little room right of the diagram's
 * title card (narrow screens, side panels open), below the card at the canvas's full width, so its words and buttons
 * never squeeze or clip. Follows the canvas and the card as they resize.
 */
export function useFloatingPlacement(box: RefObject<HTMLElement | null>, floating: boolean) {
  // Beside the card: centred in the room right of it (never on it, whatever the canvas centre); below: under it.
  const [place, setPlace] = useState<{
    below: boolean;
    top: number;
    left?: number;
    room?: number;
    dx: number;
    dy: number;
    compact: boolean;
  }>({
    below: false,
    top: 0,
    dx: 0,
    dy: 0,
    compact: false,
  });
  useLayoutEffect(() => {
    const el = box.current;
    const parent = el?.offsetParent;
    if (!floating || !el || !(parent instanceof HTMLElement)) return;
    const wrap = el.closest(".canvas-wrap");
    const card = wrap?.querySelector<HTMLElement>(".diagram-card");
    const toggle = wrap?.querySelector<HTMLElement>('[data-testid="live-toggle"]');
    const measure = () => {
      const p = parent.getBoundingClientRect();
      const c = card && !card.hidden ? card.getBoundingClientRect() : null;
      const t = toggle?.getBoundingClientRect();
      const panel = wrap
        ?.querySelector<HTMLElement>('[data-testid="sim-panel"], [data-testid="capacity-panel"]')
        ?.getBoundingClientRect();
      const right = Math.min(p.right - 16, t ? t.left - 16 : Infinity, panel ? panel.left - 16 : Infinity);
      const room = c ? right - (c.right + 16) : right - p.left - 16;
      const below = room < CALLOUT_MIN;
      const top = Math.round(Math.max(c?.bottom ?? p.top, t?.bottom ?? p.top) - p.top + 8);
      const left = !below ? Math.round((c?.right ?? p.left) - p.left + 16 + room / 2) : undefined;
      const width = !below ? Math.floor(room) : Math.max(0, right - p.left - 16);
      // A callout can arrive after fit-view. Move the callout off nodes rather than stealing
      // their pointer targets or moving the diagram. Re-evaluate after pan, zoom or resize.
      const rect = (r: DOMRect): Rect => ({ x: r.left - p.left, y: r.top - p.top, width: r.width, height: r.height });
      const obstacles = [
        ...(wrap?.querySelectorAll<HTMLElement>(
          '.react-flow__node-diagram, [data-canvas-overlay], [data-testid="live-toggle"], [data-testid="live-controls"], [data-testid="canvas-controls"], [data-testid="canvas-minimap"]',
        ) ?? []),
      ]
        .filter((item) => item !== el && !item.contains(el) && !el.contains(item))
        .map((item) => inflate(rect(item.getBoundingClientRect()), 8));
      const desired = () => ({
        x: below ? 16 : (left ?? p.width / 2) - el.offsetWidth / 2,
        y: below ? top : window.innerWidth <= 1280 ? 60 : 16,
        width: el.offsetWidth,
        height: el.offsetHeight,
      });
      // Measure the full card even while folded, so finding room for the compact row never
      // toggles it back to a full card that covers a node. Keep the reason in the accessible text.
      const wasCompact = el.classList.contains("is-compact");
      el.classList.remove("is-compact");
      let offset = calloutOffset(desired(), p, obstacles);
      const compact = !offset;
      if (compact) {
        el.classList.add("is-compact");
        offset = calloutOffset(desired(), p, obstacles);
      }
      el.classList.toggle("is-compact", wasCompact);
      const { dx, dy } = offset ?? { dx: 0, dy: 0 };
      setPlace((old) =>
        old.below === below &&
        old.top === top &&
        old.left === left &&
        old.room === width &&
        old.dx === dx &&
        old.dy === dy &&
        old.compact === compact
          ? old
          : { below, top, left, room: width, dx, dy, compact },
      );
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(parent);
    watch.observe(el);
    if (card) watch.observe(card);
    if (toggle) watch.observe(toggle);
    const viewport = wrap?.querySelector(".react-flow__viewport");
    const movement = new MutationObserver(measure);
    if (viewport) movement.observe(viewport, { attributes: true, attributeFilter: ["style"] });
    return () => {
      watch.disconnect();
      movement.disconnect();
    };
  }, [box, floating]);
  // The same object while the placement holds, so FloatingPlacement reports only changes.
  return useMemo(
    () => ({
      below: place.below,
      compact: place.compact,
      style: {
        translate: `${place.dx}px ${place.dy}px`,
        ...(place.below
          ? ({
              "--callout-top": `${place.top}px`,
              left: 16,
              right: "auto",
              maxWidth: place.room,
              minWidth: Math.min(340, place.room ?? 340),
            } as CSSProperties)
          : place.left !== undefined && place.room !== undefined
            ? ({ left: place.left, maxWidth: place.room, minWidth: Math.min(340, place.room) } as CSSProperties)
            : {}),
      },
    }),
    [place],
  );
}

export type FloatingPlace = ReturnType<typeof useFloatingPlacement>;

/**
 * Places a floating callout whose own code is always loaded (src/live/TroubleDownloadError.tsx): renders nothing and
 * reports each placement, so the callout can show at once and move aside when this downloads.
 */
export function FloatingPlacement({
  box,
  onPlace,
}: {
  box: RefObject<HTMLElement | null>;
  onPlace: (place: FloatingPlace) => void;
}) {
  const place = useFloatingPlacement(box, true);
  useLayoutEffect(() => onPlace(place), [place, onPlace]);
  return null;
}
