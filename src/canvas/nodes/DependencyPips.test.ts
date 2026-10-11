import { expect, it } from "vitest";
import { pipsByNode } from "./dependencyRows";
import type { DiagramFlowEdge } from "../types";

it("keeps untrusted node ids as structured targets, including newline and tab delimiters", () => {
  const edges: DiagramFlowEdge[] = [
    { id: "e", source: "a", target: "b\ninjected\tsecret", data: { kind: "async", relation: "secret" } },
  ];
  const rows = pipsByNode(edges).get("a");
  expect(rows).toEqual([{ relation: "secret", target: "b\ninjected\tsecret" }]);
  expect(pipsByNode(edges).get("a")).toBe(rows);
});
