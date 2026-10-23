import { useLayoutEffect } from "react";
import { useInteraction } from "../interaction/useInteraction";

/** A failed download ends its owner's pending rename, without waiting for a sheet commit. */
export function PanelUnavailable({ owner }: { owner?: string }) {
  const interaction = useInteraction();
  useLayoutEffect(() => {
    interaction?.rendered();
  }, [interaction]);
  return <div hidden data-testid="inspector-panel-unavailable" data-panel-unavailable={owner ?? ""} />;
}
