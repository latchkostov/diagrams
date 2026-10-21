import { expect, it } from "vitest";
import payment from "../examples/slow-payment-provider.json";
import type { DiagramFile } from "../model/types";
import { LiveController } from "./controller";
import { simulationEdges } from "../sim/simulationEdges";
import { nodeOutcome } from "./nodeOutcome";

it("summarizes timeout losses and late replies once, retaining distinct retry attempts", () => {
  const d = payment as DiagramFile;
  const c = new LiveController(d);
  try {
    c.selectSimulation(d.simulations![1]);
    c.seek(15000);
    const snapshot = structuredClone(c.getState().snapshot);
    const effective = simulationEdges(d, c.getState().running!);
    const outcome = nodeOutcome(effective, snapshot, "checkout")!;
    expect(outcome).toContain("all timed out after 0.6 s");
    expect(outcome).toContain("late replies discarded");
    expect(outcome).not.toContain("failed attempts");
    expect(outcome).not.toContain("dropped");
    snapshot.nodes.checkout.failed += 2;
    expect(nodeOutcome(effective, snapshot, "checkout")).toContain("failed attempts");
    c.selectSimulation(d.simulations![0]);
    c.seek(15000);
    expect(nodeOutcome(d, c.getState().snapshot, "shop")).toContain("504");
    const mixed = structuredClone(c.getState().snapshot);
    mixed.nodes.shop.dropped += 3;
    expect(nodeOutcome(d, mixed, "shop")).toContain(`${mixed.nodes.shop.dropped.toLocaleString("en")} lost`);
  } finally {
    c.dispose();
  }
});
