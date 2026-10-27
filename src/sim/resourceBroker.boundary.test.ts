import { describe, expect, it } from "vitest";
import { autoscalingFixture } from "../lab/autoscalingFixture";
import { createEngine, observeEngineEvents, randomDraws } from "./engine";
import { assertLedgerInvariants, assertResourceInvariants } from "./resourceInvariants";

// Pin the seam through the public engine and its per-tick ownership oracle, including replay.
describe("resource and broker phase boundary", () => {
  it("keeps route dispatch order, pre-service occupancy and CPU tails across restore", () => {
    const diagram = autoscalingFixture();
    diagram.planning!.revision = "p3-w2";
    diagram.nodes[0].stencil = "kafka.topic";
    diagram.nodes[0].props = { partitions: 2, maxDeliveryCount: 3 };
    const worker = diagram.nodes[1];
    worker.id = "second";
    Object.assign(worker.props!, {
      replicas: 1,
      concurrency: 1,
      latencyMs: 10,
      autoscaling: { mode: "off" },
      resources: {
        ...worker.props!.resources!,
        cpuMsPerMessage: 15,
        cpuLimitMilli: 1000,
        startup: { delayMs: 0, jitterFraction: 0 },
      },
    });
    diagram.nodes.push({ ...structuredClone(worker), id: "first", label: "First" });
    // Route order deliberately differs from node Map order.
    diagram.edges = ["first", "second"].map((to) => ({
      id: `to-${to}`,
      from: "source",
      to,
      kind: "async",
      props: { travelMs: 10, group: "workers" },
    }));
    const ticks: string[] = [];
    const dispatch: string[] = [];
    const engine = createEngine({
      seed: 7,
      scale: 3,
      verifyLedger: assertLedgerInvariants,
      verifyResources(state) {
        assertResourceInvariants(state);
        ticks.push(
          `${state.time}|` +
            [...state.nodes]
              .map((node) => {
                const f = node.fleet;
                return [
                  node.id,
                  node.groups?.map((g) => [g.pendingUnits, g.active]),
                  node.working.map((w) => [w.message && "id" in w.message ? w.message.id : undefined, w.cpuRemaining]),
                  [...(node.cpuTail ?? [])].map((w) => w.cpuRemaining),
                  f && [f.totalCpu, f.occupancy, f.memoryCredit],
                ];
              })
              .map((row) => JSON.stringify(row))
              .join("|"),
        );
      },
    });
    engine.load(diagram);
    observeEngineEvents(engine, (event) => {
      if (event.kind === "deliver") dispatch.push(`${event.time}:${event.text}`);
    });
    engine.inject("source", 12);
    engine.step(20);
    const token = engine.checkpoint();
    const suffix = () => {
      ticks.length = 0;
      dispatch.length = 0;
      for (let i = 0; i < 12; i++) {
        if (i === 1) engine.setNodeStatus("second", "paused");
        if (i === 3) engine.setNodeStatus("second", "up");
        if (i === 5) engine.setNodeProps("first", { replicas: 2 });
        if (i === 7) engine.setScale(2);
        engine.step(10);
      }
      return structuredClone({ ticks, dispatch, snapshot: engine.snapshot(), draws: randomDraws(engine) });
    };
    const expected = suffix();
    expect({ ticks: expected.ticks, dispatch: expected.dispatch }).toEqual({
      ticks: [
        '30|["source",[[10,2]],[],[],null]|["second",[],[[1,12.5]],[],[10,10,12.5]]|["first",[],[[13,12.5]],[],[10,10,12.5]]',
        '40|["source",[[9.5,2]],[],[],null]|["second",[],[[1,12.5]],[],[10,10,12.5]]|["first",[],[[null,2.5]],[2.5],[20,20,2.5]]',
        '50|["source",[[9.5,2]],[],[],null]|["second",[],[[1,12.5]],[],[10,10,12.5]]|["first",[],[[14,22.5]],[],[22.5,22.5,22.5]]',
        '60|["source",[[9,2]],[],[],null]|["second",[],[[null,2.5]],[2.5],[20,20,2.5]]|["first",[],[[14,12.5]],[],[32.5,32.5,12.5]]',
        '70|["source",[[8.5,2]],[],[],null]|["second",[],[[2,22.5]],[],[22.5,22.5,22.5]]|["first",[],[[null,2.5]],[2.5],[42.5,42.5,2.5]]',
        '80|["source",[[8.5,2]],[],[],null]|["second",[],[[2,12.5]],[],[32.5,32.5,12.5]]|["first",[],[[15,22.5]],[],[45,45,22.5]]',
        '90|["source",[[8,2]],[],[],null]|["second",[],[[null,2.5]],[2.5],[42.5,42.5,2.5]]|["first",[],[[15,12.5]],[],[55,55,12.5]]',
        '100|["source",[[7,2.5]],[],[],null]|["second",[],[[3,22.5]],[],[45,45,22.5]]|["first",[],[[null,2.5]],[2.5],[65,65,2.5]]',
        '110|["source",[[7,2.5]],[],[],null]|["second",[],[[3,12.5]],[],[55,55,12.5]]|["first",[],[[16,22.5]],[],[67.5,67.5,22.5]]',
        '120|["source",[[6,3]],[],[],null]|["second",[],[[null,2.5]],[2.5],[65,65,2.5]]|["first",[],[[16,12.5]],[],[77.5,77.5,12.5]]',
        '130|["source",[[5.5,3]],[],[],null]|["second",[],[[4,22.5]],[],[67.5,67.5,22.5]]|["first",[],[[null,2.5]],[2.5],[87.5,87.5,2.5]]',
        '140|["source",[[5.5,3]],[],[],null]|["second",[],[[4,12.5]],[],[77.5,77.5,12.5]]|["first",[],[[5,30]],[],[90,90,30]]',
      ],
      dispatch: [
        "50:First deliver Traffic #15",
        "70:Orders deliver Traffic #3",
        "80:First deliver Traffic #16",
        "100:Orders deliver Traffic #4",
        "110:First deliver Traffic #5",
        "130:Orders deliver Traffic #6",
        "140:First deliver Traffic #17",
      ],
    });
    for (let replay = 0; replay < 2; replay++) {
      engine.restore(token);
      expect(suffix()).toEqual(expected);
    }
  });
});
