import { expect, it } from "vitest";
import { faultDrillFixture } from "../lab/faultDrillFixture";
import { defaultFault, drillFault } from "./faults";

it.each(["nginx", "postgres"] as const)(
  "targets a %s dependency before a client when there is no processor",
  (stencil) => {
    const diagram = faultDrillFixture();
    diagram.nodes.find((node) => node.id === "worker")!.stencil = stencil;
    expect.soft(drillFault("slow-dependency", diagram)).toEqual({ kind: "slow", node: "worker", factor: 5 });
    expect(drillFault("error-spike", diagram)).toEqual({ kind: "fail", node: "worker", rate: 0.5 });
  },
);

it.each(["slow", "fail"] as const)("still prefers the processor for a %s fault", (kind) => {
  const diagram = faultDrillFixture();
  diagram.nodes.unshift({ id: "entry", stencil: "nginx", label: "Entry", x: 0, y: 0 });
  expect(defaultFault(kind, diagram)).toMatchObject({ node: "worker" });
});
