import { afterEach, expect, it, vi } from "vitest";
import type { DiagramFile } from "../model/types";
import * as planning from "../sim/waitingPlan";
import { waitingDetails } from "./waitingDetails";

afterEach(() => vi.restoreAllMocks());

it("shares one deferred waiting plan across detail views and invalidates either input", () => {
  const diagram: DiagramFile = {
    format: "diagrams/v2",
    title: "Waiting",
    planning: { revision: "p3-w1" },
    nodes: [
      { id: "a", stencil: "service.dotnet", label: "A", x: 0, y: 0 },
      { id: "b", stencil: "service.dotnet", label: "B", x: 300, y: 0 },
    ],
    edges: [{ id: "request", from: "a", to: "b", kind: "sync" }],
  };
  const configuration = {};
  const compute = vi.spyOn(planning, "waitingPlan");
  expect(compute).not.toHaveBeenCalled();
  const first = waitingDetails(diagram, configuration)!;
  expect(waitingDetails(diagram, configuration)?.nodes.get("b")).toBe(first.nodes.get("b"));
  expect(waitingDetails(diagram, configuration)).toBe(first);
  expect(compute).toHaveBeenCalledTimes(1);
  const edited = { a: { concurrency: 2 } };
  expect(waitingDetails(diagram, edited)).not.toBe(first);
  expect(waitingDetails({ ...diagram }, edited)).not.toBe(first);
  expect(compute).toHaveBeenCalledTimes(3);
  expect(waitingDetails({ ...diagram, planning: undefined }, configuration)).toBeUndefined();
  expect(compute).toHaveBeenCalledTimes(3);
});
