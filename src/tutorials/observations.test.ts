import { afterEach, expect, it, vi } from "vitest";
import {
  beginObservedWork,
  cancelObservedWork,
  createObservationPort,
  observationPorts,
  type ProductObservations,
} from "../lib/observations";
import { holds, type SandboxView } from "./checks";
import type { Check } from "./types";

const source = { documentId: "sandbox", identity: {} };
const view: SandboxView = {
  diagram: { format: "diagrams/v1", title: "", nodes: [], edges: [] },
  live: false,
  processed: () => 0,
};
type ExistingPort = "dock" | "checks" | "exports" | "imports" | "ai" | "collaboration";
const facts: ProductObservations = {
  navigation: { ...source, nodeId: "api" },
  tools: { ...source, query: "service", stencils: ["generic.service"] },
  gallery: { ...source, feature: "partitions", slugs: ["kafka-order-pipeline"] },
  history: { ...source, action: "undo" },
  copied: { ...source, slug: "owned-copy" },
  library: { ...source, slugs: ["owned-copy"] },
  camera: { ...source, view: "focus" },
  importReport: { ...source, source: "tutorial-status-compose.yaml", guesses: 2, unread: 1, privacy: false },
  dock: { ...source, tab: "checks", snap: "half", live: false, presenting: false },
  checks: { ...source, status: "done", result: { findings: [], ignored: [], off: [], ran: [] } },
  exports: { ...source, format: "svg", bytes: 20 },
  imports: { ...source, format: "native" },
  ai: { ...source, kind: "change", changed: ["api"] },
  collaboration: { ...source, status: "joined", role: "joiner" },
};
const checks: Record<ExistingPort, Check> = {
  dock: { kind: "dock", tab: "checks", snap: "half" },
  checks: { kind: "checks", status: "done", findings: 0 },
  exports: { kind: "export", format: "svg" },
  imports: { kind: "import", format: "native" },
  ai: { kind: "aiTurn", turn: "change", subject: "api" },
  collaboration: { kind: "collaboration", status: "joined", role: "joiner" },
};
afterEach(() => vi.restoreAllMocks());

function portCase<K extends ExistingPort>(key: K) {
  it(`${key}: fake publications satisfy typed checks and unsubscribe cleanly`, () => {
    const observations: Partial<ProductObservations> = {};
    const listener = vi.fn((event: ProductObservations[K]) => {
      observations[key] = event;
    });
    const off = observationPorts[key].subscribe(listener);
    expect(holds(checks[key], { ...view, observations }, { api: "api" })).toBe(false);
    observationPorts[key].publish(facts[key]);
    expect(holds(checks[key], { ...view, observations }, { api: "api" })).toBe(true);
    off();
    observationPorts[key].publish(facts[key]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
}
portCase("dock");
portCase("checks");
portCase("exports");
portCase("imports");
portCase("ai");
portCase("collaboration");

it("empty, failed, cancelled and joining states cannot certify successful work", () => {
  expect(
    holds({ kind: "view", view: "focus" }, { ...view, observations: { dock: { ...facts.dock, view: "focus" } } }, {}),
  ).toBe(true);
  expect(
    holds(
      { kind: "view", view: "focus" },
      { ...view, observations: { dock: { ...facts.dock, view: "overview" } } },
      {},
    ),
  ).toBe(false);
  expect(holds(checks.exports, { ...view, observations: { exports: { ...facts.exports, bytes: 0 } } }, {})).toBe(false);
  for (const status of ["running", "failed", "cancelled", "stale"] as const)
    expect(holds(checks.checks, { ...view, observations: { checks: { ...source, status } } }, {})).toBe(false);
  expect(
    holds(checks.collaboration, { ...view, observations: { collaboration: { ...source, status: "joining" } } }, {}),
  ).toBe(false);
  expect(holds(checks.ai, { ...view, observations: { ai: { ...facts.ai, changed: [] } } }, { api: "api" })).toBe(false);
  expect(
    holds(checks.exports, { ...view, observations: { exports: { ...facts.exports, format: "native" } } }, {}),
  ).toBe(false);
});

it("cancels delayed work only for its initiating document and releases finished jobs", () => {
  const work = beginObservedWork(source);
  const other = beginObservedWork({ ...source, identity: {} });
  const finished = beginObservedWork(source);
  finished.finish();
  cancelObservedWork(source);
  expect(work.signal.aborted).toBe(true);
  expect(other.signal.aborted).toBe(false);
  expect(finished.signal.aborted).toBe(false);
  expect(() => work.signal.throwIfAborted()).toThrow();
  other.finish();
});

it("the port has no replay or persisted action history", () => {
  const port = createObservationPort<number>();
  port.publish(1);
  const listener = vi.fn();
  const off = port.subscribe(listener);
  expect(listener).not.toHaveBeenCalled();
  port.publish(2);
  expect(listener).toHaveBeenCalledWith(2);
  off();
});
