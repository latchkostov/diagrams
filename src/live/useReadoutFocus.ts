import { useLayoutEffect, useMemo } from "react";
import { useInteraction } from "../canvas/interaction";
import type { ReadoutState } from "../canvas/interaction/readout";

/** A cold readout may inherit its loading stop, but never a later owner's focus. */
export function useReadoutFocus(target: ReadoutState["open"]) {
  const interaction = useInteraction();
  const request = useMemo(() => createFocusRequest(target, interaction), [target, interaction]);
  useLayoutEffect(() => {
    request.record();
    document.addEventListener("focusin", request.record);
    return () => document.removeEventListener("focusin", request.record);
  }, [request]);
  return request.claim;
}

/** Owns a single focus request independently of React renders. */
function createFocusRequest(target: ReadoutState["open"], interaction: ReturnType<typeof useInteraction>) {
  const opener = typeof document === "undefined" ? null : document.activeElement;
  let held = false;
  let cancelled = false;
  const record = () => {
    const active = document.activeElement;
    const card = active?.closest<HTMLElement>("[data-live-readout]");
    if (target && card?.dataset.liveReadout === target.kind && card?.dataset.item === target.id) held = true;
    else if (active !== opener) cancelled = true;
  };
  return {
    record,
    claim: () =>
      !!target &&
      !cancelled &&
      !interaction?.menu &&
      interaction?.readouts?.get() === target &&
      ((target.pinned && document.activeElement === opener) || (held && document.activeElement === document.body)),
  };
}
