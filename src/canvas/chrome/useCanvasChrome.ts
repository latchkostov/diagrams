import { useCallback, useRef, useState, type RefObject } from "react";
import { safeStorage } from "../../lib/storage";
import { useCovered, useOverlayTestIds } from "../useOverlayFit";
import { useBelow } from "../checks/useBelow";

const HINT_KEY = "diagrams.firstRunHint.v1";

export function useChromeHint(readOnly: boolean) {
  const [startDismissed, setStartDismissed] = useState(false);
  const [hintSeen, setHintSeen] = useState(() => readOnly || safeStorage.getItem(HINT_KEY) === "1");
  const dismissHint = useCallback(() => {
    setHintSeen(true);
    safeStorage.setItem(HINT_KEY, "1");
  }, []);
  return { startDismissed, setStartDismissed, hintSeen, dismissHint };
}

/** Keep overlay measurement hooks in CanvasView's original hook order. */
export function useChromeOverlays(wrapper: RefObject<HTMLDivElement | null>, checksVisible: boolean) {
  // The title card folds to a chip while nodes sit under it, so it never hides the diagram.
  const card = useRef<HTMLDivElement>(null);
  const cardCovers = useCovered(card, wrapper);
  const checksTop = useBelow(card, checksVisible);
  useOverlayTestIds(wrapper);

  return { card, cardCovers, checksTop };
}
