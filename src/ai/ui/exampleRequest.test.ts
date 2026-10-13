import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../../model/types";
import { exampleRequest, exampleToCopy } from "./exampleRequest";

const diagram = (nodes: [string, string, string][], edges: [string, string, ("async" | "sync")?][] = []) =>
  ({
    format: "diagrams/v1",
    title: "t",
    nodes: nodes.map(([id, stencil, label]) => ({ id, stencil, label, x: 0, y: 0 })),
    edges: edges.map(([from, to, kind], i) => ({ id: `e${i}`, from, to, kind: kind ?? "async" })),
  }) as unknown as DiagramFile;

describe("exampleRequest", () => {
  it("names a service that consumes from a topic or queue", () => {
    const d = diagram(
      [
        ["api", "service.node", "Orders API"],
        ["topic", "kafka.topic", "orders.created"],
        ["worker", "service.dotnet", "billing-worker"],
        ["db", "postgres", "billing-db"],
      ],
      [
        ["api", "topic"],
        ["topic", "worker"],
        ["worker", "db", "sync"],
      ],
    );
    expect(exampleRequest(d)).toBe("Add a dead-letter queue after billing-worker");
    expect(exampleRequest(d, true)).toBe("Explain what happens to a message when it reaches billing-worker");
  });

  it("falls back to a cache in front of a database, then to the first named node", () => {
    const withDb = diagram(
      [
        ["api", "service.node", "Orders API"],
        ["db", "postgres", "orders-db"],
      ],
      [["api", "db", "sync"]],
    );
    expect(exampleRequest(withDb)).toBe("Add a Redis cache in front of orders-db");
    expect(exampleRequest(diagram([["api", "service.node", "Orders API"]]))).toBe("Add a Kafka topic after Orders API");
  });

  it("asks for a whole diagram when there's nothing to name", () => {
    expect(exampleRequest(null)).toMatch(/^Draw a Kafka topic/);
    expect(exampleRequest(diagram([["x", "service.node", "  "]]))).toMatch(/^Draw /);
  });
});

describe("exampleToCopy", () => {
  const diagram = {
    format: "diagrams/v1" as const,
    title: "Payroll",
    nodes: [{ id: "ledger", stencil: "postgres", label: "Payroll ledger", x: 0, y: 0 }],
    edges: [],
  };
  const editor = { getDiagram: () => diagram };

  it("reads the diagram open when it's clicked, and copies nothing from a private one", () => {
    expect(exampleToCopy({ editor })).toContain("Payroll ledger");
    expect(exampleToCopy({ editor, private: true })).toBeNull();
    expect(exampleToCopy({ editor, private: true, onDevice: true })).toBeNull();
    expect(exampleToCopy({ editor, localOnly: true })).toBeNull();
  });
});
