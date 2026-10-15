import { expect, it } from "vitest";
import { autoscalingFixture } from "../lab/autoscalingFixture";
import { resourceLesson } from "../model/autoscaling";
import { buildContext } from "./context";
import { capacity } from "./rules/capacity";

it("indexes resource-warning targets once before filtering capacity candidates", () => {
  const d = autoscalingFixture(),
    worker = d.nodes[1];
  d.edges = [];
  d.nodes = Array.from({ length: 1000 }, (_, i) => ({
    ...worker,
    id: `worker-${i}`,
    props: { autoscaling: { mode: "off" }, resources: { ...resourceLesson(), memoryLimitMiB: 1 } },
  }));
  const ctx = buildContext(d),
    analysis = ctx.capacity();
  let reads = 0;
  for (const n of Object.values(analysis.nodes)) {
    const id = n.id;
    Object.defineProperty(n, "id", {
      get: () => {
        reads++;
        return id;
      },
    });
  }
  expect(capacity.detect(ctx)).toHaveLength(1000);
  expect(reads).toBeLessThan(10 * d.nodes.length);
});
