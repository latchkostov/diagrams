import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { runChecks } from "./run";

// A node saved down is an outage, not a service that "can't keep up" (docs/research/sim-flows-review.md, F-6).
const diagram = (down: string): DiagramFile => ({
  format: "diagrams/v1",
  title: "Down",
  nodes: [
    { id: "web", stencil: "client.browser", label: "Web", x: 0, y: 0 },
    { id: "api", stencil: "service.dotnet", label: "Orders API", x: 0, y: 0 },
    { id: "q", stencil: "aws.sqs", label: "orders", x: 0, y: 0 },
    { id: "worker", stencil: "service.go", label: "Fulfilment worker", x: 0, y: 0 },
  ].map((n) => (n.id === down ? { ...n, props: { status: "down" } } : n)),
  edges: [
    { id: "a", from: "web", to: "api", kind: "sync" },
    { id: "b", from: "api", to: "q", kind: "async" },
    { id: "c", from: "q", to: "worker", kind: "async" },
  ],
});

describe("capacity: a node saved down", () => {
  it("is down, its messages waiting in the queue, with no replica fix", () => {
    const [finding] = runChecks(diagram("worker"), { rules: ["capacity"] }).findings;
    expect(finding).toMatchObject({ title: "Fulfilment worker is down", target: "worker" });
    expect(finding.message).toBe("It's saved down, so it handles nothing: messages wait in orders until it's back.");
    expect(finding.message).not.toMatch(/keep up|backlog only grows/);
    expect(finding.fix).toBeUndefined();
  });

  it("pushed to, its messages fail", () => {
    const [finding] = runChecks(diagram("api"), { rules: ["capacity"] }).findings;
    expect(finding.message).toBe("It's saved down, so it handles nothing: messages sent to it fail until it's back.");
  });
});
