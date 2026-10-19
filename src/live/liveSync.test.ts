import { describe, expect, it } from "vitest";
import type { DiagramFile, Simulation } from "../model/types";
import kafka from "../examples/kafka-order-pipeline.json";
import { LiveController } from "./controller";
import type { OpOrigin } from "./controlLog";
import { LiveSync } from "./session/liveSync";

const diagram = kafka as unknown as DiagramFile;
const steady: Simulation = {
  id: "steady",
  title: "Steady checkouts",
  seed: 5,
  durationMs: 60_000,
  traffic: [
    {
      id: "checkouts",
      node: "shopper",
      messageType: "OrderRequest",
      shape: { kind: "constant", ratePerSec: 100, durationMs: 60_000 },
    },
  ],
};
const withNodeProps = (d: DiagramFile, id: string, props: Record<string, unknown>): DiagramFile => ({
  ...d,
  nodes: d.nodes.map((n) => (n.id === id ? { ...n, props: { ...n.props, ...props } } : n)),
});

describe("LiveSync: the document's changes into the run, following-aware", () => {
  it("ending following reconciles the latest deferred document changes, once each, as sync", () => {
    const c = new LiveController(diagram, { replayDelayMs: 0 });
    c.selectSimulation(steady);
    const sync = new LiveSync(c);
    sync.simulations([steady], () => undefined);
    const ops: string[] = [];
    c.onOp((e, origin: OpOrigin) => ops.push(`${e.op.kind}:${origin}`));
    sync.setFollowing(true);
    // While following: an edit, then a newer one; the saved simulation edited. None reaches the run.
    let doc = withNodeProps(diagram, "payments", { failureRate: 0.5 });
    sync.diagram(() => doc);
    doc = withNodeProps(diagram, "payments", { failureRate: 0.2 });
    sync.diagram(() => doc);
    const edited: Simulation = { ...steady, seed: 9 };
    sync.simulations([edited], () => undefined);
    expect(ops).toEqual([]);
    expect(c.effectiveProps("payments").failureRate).toBeUndefined();
    expect(c.getState().simulation).toEqual(steady);
    // Following ends: the latest of each, once.
    sync.setFollowing(false);
    expect(ops).toEqual(["patch:sync", "base:sync"]);
    expect(c.effectiveProps("payments").failureRate).toBe(0.2);
    expect(c.getState().simulation).toEqual(edited);
    sync.setFollowing(false);
    expect(ops).toHaveLength(2);
  });
});
