import fc from "fast-check";
import { waitingFixture } from "../lab/waitingFixture";
import { resourceLesson } from "../model/autoscaling";

const tier = fc.record({
  concurrency: fc.integer({ min: 1, max: 16 }),
  replicas: fc.integer({ min: 1, max: 3 }),
  latencyMs: fc.integer({ min: 0, max: 300 }),
  cpuMs: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
  mode: fc.constantFrom("blocking", "nonblocking", "mixed"),
  replyMs: fc.integer({ min: 0, max: 100 }),
  managed: fc.boolean(),
  retryBackoffMs: fc.integer({ min: 100, max: 1000 }),
  pool: fc.integer({ min: 1, max: 8 }),
});

/** Small acyclic call graphs. Deadline values are scenario data for #197's later migration;
 * R1 deliberately does not put unsupported deadline settings into the diagram. */
export const arbWaitDiagram = fc
  .record({
    tiers: fc.array(tier, { minLength: 2, maxLength: 4 }),
    sharedAllocation: fc.boolean(),
    scale: fc.constantFrom(1, 1.01, 1.1, 1.5, 2, 3, 10),
    deadlineMs: fc.option(fc.integer({ min: 100, max: 2000 }), { nil: undefined }),
  })
  .map(({ tiers, sharedAllocation, scale, deadlineMs }) => {
    const diagram = waitingFixture();
    const prototype = diagram.nodes[1];
    if (tiers.some((t) => t.managed) || sharedAllocation) {
      diagram.nodes[0].stencil = "generic.queue";
      diagram.nodes[0].props = { maxDeliveryCount: 3 };
    }
    if (sharedAllocation) diagram.planning!.sharedAllocations = [{ id: "callers", maxInFlight: 1 }];
    diagram.nodes = [
      diagram.nodes[0],
      ...tiers.map((props, i) => ({
        ...prototype,
        id: `tier${i}`,
        stencil: props.managed || (sharedAllocation && i === 0) ? "aws.lambda" : prototype.stencil,
        x: 330 * (i + 1),
        props: {
          concurrency: props.concurrency,
          replicas: props.replicas,
          latencyMs: props.latencyMs,
          jitter: 0,
          ...(props.managed || (sharedAllocation && i === 0)
            ? {
                scaling: "fixed",
                maxConcurrency: props.concurrency,
                retry: "inplace",
                retryBackoffMs: props.retryBackoffMs,
                api: {
                  latencyMs: Math.max(10, props.latencyMs),
                  ...(sharedAllocation && i === 0 ? { sharedConcurrency: "callers" } : {}),
                },
              }
            : {}),
          ...(props.cpuMs === undefined
            ? {}
            : {
                resources: {
                  ...resourceLesson(),
                  cpuMsPerMessage: props.cpuMs,
                  startup: { delayMs: 0, jitterFraction: 0 },
                },
              }),
        },
      })),
      { ...diagram.nodes[2], id: "side", props: { api: { latencyMs: 20 }, jitter: 0 } },
      diagram.nodes[3],
    ];
    diagram.edges = [{ id: "input", from: "source", to: "tier0", props: { travelMs: 10 } }];
    tiers.slice(0, -1).forEach((props, i) => {
      diagram.edges.push({
        id: `call${i}`,
        from: `tier${i}`,
        to: `tier${i + 1}`,
        kind: "sync",
        props: {
          travelMs: 10,
          networkDelayMs: 10,
          caller: {
            poolConnections: props.pool,
            wait: props.mode === "nonblocking" ? "non-blocking" : "blocking",
            replyMs: props.replyMs,
          },
        },
      });
      if (props.mode === "mixed")
        diagram.edges.push({
          id: `side${i}`,
          from: `tier${i}`,
          to: "side",
          kind: "sync",
          props: {
            travelMs: 10,
            caller: { poolConnections: props.pool, wait: "non-blocking", replyMs: props.replyMs },
          },
        });
    });
    if (sharedAllocation) {
      diagram.nodes.push({
        ...prototype,
        id: "sibling",
        stencil: "aws.lambda",
        props: {
          scaling: "fixed",
          maxConcurrency: 1,
          retry: "inplace",
          retryBackoffMs: tiers[0].retryBackoffMs,
          jitter: 0,
          api: { latencyMs: tiers[0].latencyMs, sharedConcurrency: "callers" },
        },
      });
      diagram.edges.push(
        { id: "sibling-input", from: "source", to: "sibling", props: { travelMs: 10 } },
        { id: "sibling-call", from: "sibling", to: "side", kind: "sync", props: { travelMs: 10, networkDelayMs: 10 } },
      );
    }
    diagram.edges.push({ id: "output", from: "tier0", to: "result", props: { travelMs: 10 } });
    return { diagram, scale, deadlineMs };
  });
