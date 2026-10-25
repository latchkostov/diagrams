import { useLayoutEffect, useMemo } from "react";
import { useInteraction } from "../canvas/interaction";
import type { ReadoutState } from "../canvas/interaction/readout";
import { createMachine } from "../lib/machine";
import { readoutFocusMachine, type ReadoutFocusAt } from "./readoutFocus";

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
  const machine = createMachine(readoutFocusMachine);
  const at = (explicit = false): ReadoutFocusAt => {
    const active = document.activeElement;
    const card = active?.closest<HTMLElement>("[data-live-readout]");
    if (target && card?.dataset.liveReadout === target.kind && card?.dataset.item === target.id) return "readout";
    if (active === opener) return "opener";
    return !explicit && active === document.body ? "vacant" : "other";
  };
  const record = (event?: Event) => machine.send({ type: "focus", at: at(!!event) });
  // Capture ownership before the commit can remove a focused compact section.
  if (typeof document !== "undefined") machine.send({ type: "open", at: at(), pinned: !!target?.pinned });
  return {
    record,
    claim: () =>
      machine
        .send({
          type: "claim",
          at: at(),
          pinned: !!target?.pinned,
          eligible: !!target && !interaction?.menu && interaction?.readouts?.get() === target,
        })
        .commands.includes("focus"),
  };
}
