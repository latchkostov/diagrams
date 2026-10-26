import { expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import type { Trouble } from "./observedTrouble";
import { narrationSubject } from "./narrationSubject";
const diagram: DiagramFile = {
  format: "diagrams/v1",
  title: "Example",
  nodes: [],
  edges: [{ id: "call", from: "checkout", to: "payments", kind: "sync" }],
};
const trouble: Trouble = {
  key: "retry-storm:call",
  kind: "retry-storm",
  node: "checkout",
  headline: "Retries are overloading Payments",
  announce: "Retries are overloading Payments",
  detail: "",
  action: { kind: "resilience", edge: "call", step: "breaker", caller: { breaker: {} } },
};
it("narrates the overloaded service while the retry fix remains on its caller", () => {
  expect(narrationSubject(trouble, diagram)).toBe("payments");
  expect(trouble.node).toBe("checkout");
});
it("uses the trouble's own node for other statuses or a removed connection", () => {
  expect(narrationSubject({ ...trouble, kind: "down" }, diagram)).toBe("checkout");
  expect(narrationSubject(trouble, { ...diagram, edges: [] })).toBe("checkout");
  expect(narrationSubject(undefined, diagram)).toBeUndefined();
});

it("keeps the named service while verification temporarily offers Events", () => {
  expect(narrationSubject({ ...trouble, action: { kind: "events", node: "checkout" } }, diagram)).toBe("payments");
});
