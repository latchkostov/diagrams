import { expect, it } from "vitest";
import { projectDependencies } from "./dependencyVisibility";
import type { DiagramFlowEdge } from "./types";

it("projects hidden dependencies without changing saved edges or leaving selectable keyboard stops", () => {
  const edges: DiagramFlowEdge[] = [
    { id: "s", source: "a", target: "b", selected: true, data: { kind: "async", relation: "secret" } },
    { id: "f", source: "a", target: "c", data: { kind: "async" } },
  ];
  expect(projectDependencies(edges, true)).toBe(edges);
  const hidden = projectDependencies(edges, false);
  expect(hidden[0]).toMatchObject({ hidden: true, selected: false, focusable: false, selectable: false });
  expect(hidden[1]).toBe(edges[1]);
  expect(edges[0].hidden).toBeUndefined();
  expect(edges[0].selected).toBe(true);
});
