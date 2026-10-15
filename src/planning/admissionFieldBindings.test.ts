import { expect, it } from "vitest";
import { admissionFieldBindings } from "./admissionFieldBindings";
import { resolveProps } from "../sim/defaults";
import { stencilRole } from "../stencils/roles";

it.each(["openai", "anthropic.claude", "aws.lambda"])(
  "%s single and bulk admission bindings preserve per-node budgets",
  (stencil) => {
    const props = {
      scaling: "auto",
      api: {
        maxInFlight: 2,
        sharedConcurrency: "account",
        quotas: [
          { id: "tokens", unit: "tokens" as const, amount: 10, windowMs: 1000, algorithm: "token-bucket" as const },
        ],
        costPerRequest: { tokens: 2 },
      },
    };
    const resolved = resolveProps(stencilRole(stencil), "", props, stencil, { revision: "p3" });
    const fields = admissionFieldBindings(stencil, props, resolved);
    expect(fields.map((field) => field.name)).toEqual(
      stencil === "aws.lambda" ? ["allocation", "latency", "errors"] : ["rate", "concurrency", "latency", "errors"],
    );
    for (const name of ["latency", "errors", ...(stencil === "aws.lambda" ? [] : ["rate", "concurrency"])]) {
      const patch = fields.find((field) => field.name === name)!.patch(5);
      expect(patch.api).toMatchObject({ sharedConcurrency: "account", costPerRequest: { tokens: 2 } });
      expect(patch.api!.quotas![0].id).toBe("tokens");
    }
    if (stencil === "aws.lambda") {
      const fixed = admissionFieldBindings(stencil, { ...props, scaling: "fixed" }, resolved);
      expect(fixed.find((field) => field.name === "concurrency")!.patch(5)).toEqual({ concurrency: 5, replicas: 1 });
    }
  },
);
