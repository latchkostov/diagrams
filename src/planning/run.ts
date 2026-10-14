import type { DiagramFile } from "../model/types";
import type { LiveState } from "../live/controller";
import { freePlaySimulation } from "../live/capacityModel";
import { explanationSimulation } from "./explanation";

export function planningRun(d: DiagramFile, state?: Pick<LiveState, "running" | "inputs" | "tweaks"> | null) {
  const sim = state?.running ?? (state ? freePlaySimulation(d, state.inputs) : explanationSimulation(d));
  if (!state?.tweaks.size) return sim;
  const props = { ...sim.setup?.props };
  const status = { ...sim.setup?.status };
  for (const [id, tweak] of state.tweaks) {
    props[id] = { ...props[id], ...tweak.props };
    if (tweak.status) status[id] = tweak.status;
  }
  return { ...sim, setup: { ...sim.setup, props, status } };
}
