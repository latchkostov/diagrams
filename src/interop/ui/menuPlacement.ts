// Where a menu panel goes (./Menu.tsx): kept MARGIN px inside the window.

/** The gap kept between a menu and the window's edges. */
export const MARGIN = 8;

/**
 * A panel's left edge, kept in the window. A submenu (`parentLeft`: its parent panel's) that doesn't fit on its own
 * side flips to the other; if it fits on neither, it overlaps its parent rather than leaving the window.
 */
export function menuLeft(left: number, width: number, parentLeft: number | undefined, viewport: number): number {
  const max = viewport - width - MARGIN;
  let l = left;
  if (parentLeft !== undefined) {
    // Flipped: from the right of the parent to its left, or (right to left) from its left to its right.
    if (l > max) l = parentLeft - width + 4;
    else if (l < MARGIN) l = parentLeft + width - 4;
  }
  return Math.max(MARGIN, Math.min(l, max));
}
