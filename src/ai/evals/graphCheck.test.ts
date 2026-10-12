import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../../model/types";
import { checkGraph } from "./graphCheck";

const diagram = (nodes: [string, string, string][], edges: [string, string][]) =>
  ({
    format: "diagrams/v1",
    title: "t",
    nodes: nodes.map(([id, stencil, label]) => ({ id, stencil, label, x: 0, y: 0 })),
    edges: edges.map(([from, to], i) => ({ id: `e${i}`, from, to })),
  }) as unknown as DiagramFile;

const expected = {
  nodes: [
    { label: "orders.created", stencil: "kafka.topic" },
    { label: "billing-worker", stencil: "service.dotnet" },
    { label: "billing-db", stencil: "postgres" },
  ],
  edges: [
    ["orders.created", "billing-worker"],
    ["billing-worker", "billing-db"],
  ] as [string, string][],
};
const NODES: [string, string, string][] = [
  ["t", "kafka.topic", "Orders"],
  ["w", "service.dotnet", "Worker"],
  ["d", "postgres", "DB"],
];

describe("checkGraph", () => {
  it("passes the expected directed graph whatever the labels", () => {
    expect(
      checkGraph(
        diagram(NODES, [
          ["t", "w"],
          ["w", "d"],
        ]),
        expected,
      ),
    ).toBeNull();
  });

  it("rejects reversed connections", () => {
    expect(
      checkGraph(
        diagram(NODES, [
          ["w", "t"],
          ["d", "w"],
        ]),
        expected,
      ),
    ).toMatch(/^reversed connection: service.dotnet -> kafka.topic/);
  });

  it("rejects wrong endpoints with the correct edge count", () => {
    expect(
      checkGraph(
        diagram(NODES, [
          ["t", "w"],
          ["t", "d"],
        ]),
        expected,
      ),
    ).toBe("no connection service.dotnet -> postgres");
  });

  it("matches nodes one to one, and by label when asked", () => {
    const two = {
      nodes: [
        { label: "A", stencil: "aws.sqs" },
        { label: "B", stencil: "aws.sqs" },
      ],
      edges: [["A", "B"]] as [string, string][],
    };
    expect(checkGraph(diagram([["q", "aws.sqs", "A"]], []), two)).toMatch(/not enough distinct nodes|no connection/);
    expect(checkGraph(diagram(NODES, [["t", "w"]]), expected)).toMatch(/^no connection/);
    expect(checkGraph(diagram([NODES[0]], []), expected)).toBe("missing service.dotnet, postgres");
    expect(
      checkGraph(
        diagram(NODES, [
          ["t", "w"],
          ["w", "d"],
        ]),
        expected,
        { labels: "exact" },
      ),
    ).toMatch(/^missing orders.created \(kafka.topic\)/);
  });

  it("a model may pick an accepted alternative, never in exact mode", () => {
    const fair = {
      nodes: [
        { label: "Stream", stencil: "aws.kinesis" },
        { label: "Processor", stencil: "service.go", accept: ["role:processor"] },
      ],
      edges: [["Stream", "Processor"]] as [string, string][],
    };
    const d = diagram(
      [
        ["k", "aws.kinesis", "Stream"],
        ["p", "aws.lambda", "Handler"],
      ],
      [["k", "p"]],
    );
    expect(checkGraph(d, fair)).toBeNull();
    expect(checkGraph(d, fair, { labels: "exact" })).toMatch(/^missing Processor/);
    const byCategory = { ...fair, nodes: [fair.nodes[0], { ...fair.nodes[1], accept: ["category:generic"] }] };
    expect(checkGraph(d, byCategory)).toBe("missing service.go (or any generic)");
    const byId = { ...fair, nodes: [fair.nodes[0], { ...fair.nodes[1], accept: ["aws.lambda"] }] };
    expect(checkGraph(d, byId)).toBeNull();
  });
});
