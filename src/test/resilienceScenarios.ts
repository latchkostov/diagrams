import fc from "fast-check";
import { arbWaitDiagram } from "./waitScenarios";
import type { RetryPolicy } from "../model/admission";

/** Extends the existing ownership/cohort generator rather than inventing a parallel engine model. */
export const arbResilienceDiagram = fc
  .tuple(
    arbWaitDiagram,
    fc.record({
      maxAttempts: fc.integer({ min: 1, max: 12 }),
      backoffMs: fc.integer({ min: 0, max: 100 }),
      strategy: fc.constantFrom("fixed" as const, "exponential" as const),
      jitter: fc.constantFrom(0, 0.5, 1),
      budget: fc.option(
        fc.record({ percent: fc.integer({ min: 1, max: 100 }), minPerSec: fc.integer({ min: 0, max: 10 }) }),
        { nil: undefined },
      ),
    }),
    fc.constantFrom(0, 0.1, 0.5, 1),
  )
  .map(([base, policy, failureRate]) => {
    const diagram = structuredClone(base.diagram);
    diagram.planning!.revision = "p3-w2";
    for (const node of diagram.nodes) if (node.id.startsWith("tier")) node.props!.failureRate = failureRate;
    for (const edge of diagram.edges)
      if (edge.kind === "sync") {
        const caller = (edge.props?.caller ?? {}) as import("../sim/types").EdgeSimProps["caller"];
        edge.props = {
          ...edge.props,
          caller: {
            ...caller,
            deadlineMs: base.deadlineMs ?? 200,
            retry: { ...policy, retryOn: ["throttled", "transient", "timeout"] } satisfies RetryPolicy,
          },
        };
      }
    return { ...base, diagram };
  });
