import type { DiagramFile } from "../model/types";
import type { LiveState } from "../live/controller";
import { freePlaySimulation } from "../live/capacityModel";
import { explanationSimulation } from "./explanation";

export function planningRun(
  d: DiagramFile,
  state?: Pick<LiveState, "running" | "inputs" | "tweaks" | "configuration"> | null,
) {
  const sim = state?.running ?? (state ? freePlaySimulation(d, state.inputs) : explanationSimulation(d));
  return state ? { ...sim, setup: { ...sim.setup, props: state.configuration } } : sim;
}
