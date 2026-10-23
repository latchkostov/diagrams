import type { DiagramFile, Simulation } from "../model/types";
import { simulationEdges } from "../sim/simulationEdges";
import { compileTopology } from "../sim/topology";

const readouts = new WeakMap<DiagramFile, { diagram: DiagramFile; topology: ReturnType<typeof compileTopology> }>();

/** Counters change every publication; only document/running-policy identity changes this graph. */
export function readoutDiagram(saved: DiagramFile, running?: Simulation) {
  const diagram = simulationEdges(saved, running);
  let readout = readouts.get(diagram);
  if (!readout) {
    readout = { diagram, topology: compileTopology(diagram) };
    readouts.set(diagram, readout);
  }
  return readout;
}
