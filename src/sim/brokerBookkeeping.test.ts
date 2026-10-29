import { afterEach, expect, it, vi } from "vitest";
import * as broker from "./engine/broker";
import { createEngine } from "./engine";
import type { DiagramFile } from "../model/types";
import type { Node } from "./engine/model";

afterEach(() => vi.restoreAllMocks());

it("idle brokers skip group scans and cache pending messages through splits, returns, edits and restores", () => {
  let nodes!: Map<string, Node>;
  const create = broker.createBroker;
  vi.spyOn(broker, "createBroker").mockImplementation((...args) => {
    nodes = args[0];
    return create(...args);
  });
  let remainders = 0;
  const e = createEngine({
    seed: 7,
    scale: 10,
    verifyResources(s) {
      for (const node of s.nodes as Iterable<Node>) {
        expect(node.brokerPending).toBe(node.groups.reduce((sum, group) => sum + group.pending.length, 0));
        for (const group of node.groups)
          for (const message of group.pending) if (message.represented !== undefined) remainders++;
      }
    },
  });
  const d: DiagramFile = {
    format: "diagrams/v2",
    title: "Broker cache",
    planning: { revision: "p3-w1" },
    nodes: [
      { id: "topic", stencil: "azure.service-bus.topic", label: "Topic", x: 0, y: 0 },
      ...["a", "b"].map((id) => ({
        id,
        stencil: "generic.service",
        label: id,
        x: 0,
        y: 0,
        props: { concurrency: 1, latencyMs: 100, jitter: 0, failureRate: 1 },
      })),
    ],
    edges: ["a", "b"].map((id) => ({ id, from: "topic", to: id, props: { group: id, travelMs: 10 } })),
  };
  e.load(d);
  const pending = nodes.get("topic")!.groups.map((group) => vi.spyOn(group.pending, "length", "get"));
  // Count only the tick; the independent oracle contributes one read per group.
  for (const read of pending) read.mockClear();
  e.step(10);
  // One independent oracle read per group, no pull scan.
  for (const read of pending) {
    expect(read).toHaveBeenCalledTimes(1);
    read.mockRestore();
  }
  e.inject("topic", 5);
  e.step(200);
  expect(remainders).toBeGreaterThan(0);
  const cp = e.checkpoint();
  const suffix = () => {
    e.setScale(4);
    e.setNodeStatus("a", "down");
    e.setNodeStatus("topic", "down");
    e.step(200);
    e.setNodeStatus("a", "up");
    e.setNodeStatus("topic", "up");
    e.step(10_000);
    return e.snapshot();
  };
  const expected = suffix();
  expect(expected.nodes.a.failed).toBeGreaterThan(0);
  expect(expected.nodes.topic.backlog).toBe(0);
  e.restore(cp);
  expect(suffix()).toEqual(expected);
  e.restore(cp);
  expect(nodes.get("topic")!.brokerPending).toBeGreaterThan(0);
  e.reset();
  expect(nodes.get("topic")!.brokerPending).toBe(0);
  expect(nodes.get("topic")!.groups.every((group) => group.pending.length === 0)).toBe(true);
  e.step(10);
  e.load(d);
  e.step(10);
});
