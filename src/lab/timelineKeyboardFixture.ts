import pipeline from "../examples/kafka-order-pipeline.json" with { type: "json" };
import type { DiagramFile } from "../model/types";

/** A fixed track keeps arbitrary seeks independent of the example's early-drain completion. */
export function timelineKeyboardFixture(): DiagramFile {
  const diagram = structuredClone(pipeline) as DiagramFile;
  diagram.simulations!.find((simulation) => simulation.id === "payments-outage")!.durationMs = 22000;
  return diagram;
}
