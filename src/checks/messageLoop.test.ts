import { describe, expect, it, vi } from "vitest";
import { messageTypesFixture } from "../lab/messageTypesFixture";
import { applyOps } from "../ai";
import * as propagation from "../model/messageTypes";
import { messageTypesAt } from "../model/messageTypes";
import { runChecks } from "./run";
import { createSimulationRun } from "../sim/simulation";
import { buildContext } from "./context";

const check = (d = messageTypesFixture()) => runChecks(d, { rules: ["message-loop"] });

describe("message-loop", () => {
  it("preserves non-loop types supplied only by saved simulations", () => {
    const d = messageTypesFixture();
    d.edges[1].props = { filter: ["*"] };
    d.simulations = [
      {
        id: "other",
        title: "Other traffic",
        traffic: [{ id: "t", node: "client", messageType: "Other", shape: { kind: "burst", count: 4 } }],
      },
    ];
    const finding = check(d).findings[0];
    expect(finding.fix?.ops).toEqual([{ op: "update", target: "send", props: { filter: ["Send", "Other"] } }]);
    const fixed = applyOps(d, finding.fix!.ops!).diagram;
    expect(messageTypesAt(fixed).carried.get("send")).toEqual(new Set(["Send", "Other"]));
    expect(fixed.simulations).toEqual(d.simulations);
    expect(check(fixed).findings).toEqual([]);
    for (const diagram of [d, fixed]) {
      const run = createSimulationRun(diagram, diagram.simulations![0]);
      for (let i = 0; i < 600; i++) run.step(10);
      expect(run.engine.snapshot().edges.send.delivered).toBeGreaterThanOrEqual(4);
      expect(run.engine.snapshot().edges.in.delivered).toBe(4);
    }
  });

  it("verifies each saved simulation's setup before offering a filter", () => {
    const d = messageTypesFixture();
    d.simulations = [
      {
        id: "prepared",
        title: "Prepared traffic",
        setup: { props: { api: { emits: { Other: "Prepared" } } } },
        traffic: [{ id: "t", node: "client", messageType: "Other", shape: { kind: "burst", count: 4 } }],
      },
    ];
    const finding = check(d).findings[0];
    expect(finding.fix?.ops).toEqual([{ op: "update", target: "send", props: { filter: ["Send", "Prepared"] } }]);
    const fixed = applyOps(d, finding.fix!.ops!).diagram;
    const run = createSimulationRun(fixed, fixed.simulations![0]);
    for (let i = 0; i < 600; i++) run.step(10);
    expect(run.engine.snapshot().edges.send.delivered).toBe(4);
  });

  it("rejects a rename that merges two existing typed loops into a new loop", () => {
    const d = messageTypesFixture();
    d.edges[2].props = undefined;
    d.nodes[0].props = { messageType: "A" };
    d.nodes.push({ ...d.nodes[0], id: "second", props: { messageType: "B" } });
    d.edges.push({ id: "second-in", from: "second", to: "api" });
    expect(messageTypesAt(d).loops).toHaveLength(2);
    const finding = check(d).findings[0];
    expect(finding.fix).toBeDefined();
    expect(finding.fix?.options).toBeUndefined();
    const merged = applyOps(d, [{ op: "update", target: "send", props: { emits: "AReceived" } }]).diagram;
    expect(messageTypesAt(merged).loops).toHaveLength(1);
    expect(messageTypesAt(merged).loops[0].type).toBe("AReceived");
  });

  it("shares one candidate budget across many loop findings and retains every warning", () => {
    const d = messageTypesFixture();
    d.nodes = [];
    d.edges = [];
    for (let i = 0; i < 80; i++) {
      const fixture = messageTypesFixture();
      d.nodes.push(...fixture.nodes.map((node) => ({ ...node, id: `${i}-${node.id}` })));
      d.edges.push(
        ...fixture.edges.map((edge) => ({
          ...edge,
          id: `${i}-${edge.id}`,
          from: `${i}-${edge.from}`,
          to: `${i}-${edge.to}`,
        })),
      );
    }
    const spy = vi.spyOn(propagation, "messageTypesAt");
    try {
      const findings = check(d).findings;
      expect(findings).toHaveLength(80);
      expect(findings.filter((f) => f.fix).length).toBeGreaterThan(0);
      expect(findings.filter((f) => f.fix).length).toBeLessThan(80 / 8);
      expect(spy.mock.calls.length).toBeLessThanOrEqual(25);
      spy.mockClear();
      const selected = runChecks(d, { rules: ["message-loop"], fixTarget: "message-loop:79-api" }).findings;
      expect(selected.find((f) => f.id === "message-loop:79-api")?.fix).toBeDefined();
      expect(selected.filter((f) => f.fix)).toHaveLength(1);
      expect(spy.mock.calls.length).toBeLessThanOrEqual(4);
    } finally {
      spy.mockRestore();
    }
  });

  it("explains when the only type loops and no single safe filter is verified", () => {
    const d = messageTypesFixture();
    d.edges[2].props = { emits: "Send" };
    const finding = check(d).findings[0];
    expect(finding.fix).toBeUndefined();
    expect(finding.rationale).toContain("No single filter or rename was verified");
  });
  it("warns about the callback and offers the cheapest safe filter", () => {
    const d = messageTypesFixture();
    const [finding] = check(d).findings;
    expect(finding.severity).toBe("warning");
    expect(finding.message).toMatch(/^Callback messages loop back to .+: each one is sent again\.$/);
    expect(finding.fix?.label).toBe("Only pass Send");
    expect(finding.fix?.ops).toEqual([{ op: "update", target: "send", props: { filter: ["Send"] } }]);
    const fixed = applyOps(d, finding.fix!.ops!);
    expect(fixed.errors).toEqual([]);
    expect(check(fixed.diagram).findings).toEqual([]);
    expect(messageTypesAt(fixed.diagram).carried.get("callback")).toEqual(new Set(["Callback"]));
  });

  it("offers a rename only when a filter stops its new type", () => {
    const d = messageTypesFixture();
    expect(check(d).findings[0].fix?.options).toBeUndefined();
    d.edges[1].props = { filter: ["Send", "Callback"] };
    const [option] = check(d).findings[0].fix!.options!;
    expect(option.short).toBe("Send as CallbackReceived");
    expect(option.ops).toEqual([{ op: "update", target: "callback", props: { emits: "CallbackReceived" } }]);
    const fixed = applyOps(d, option.ops);
    expect(check(fixed.diagram).findings).toEqual([]);
  });

  it("preserves non-loop branches and their types", () => {
    const d = messageTypesFixture();
    d.nodes.push({ id: "audit", stencil: "generic.email", label: "Audit", x: 380, y: 400 });
    d.edges.push({ id: "audit-edge", from: "api", to: "audit" });
    const before = messageTypesAt(d).carried.get("audit-edge");
    const fixed = applyOps(d, check(d).findings[0].fix!.ops!);
    expect(messageTypesAt(fixed.diagram).carried.get("audit-edge")).toEqual(before);
  });

  it("does not fire for filtered callbacks, unseeded cycles, retries or broker redelivery", () => {
    const filtered = messageTypesFixture();
    filtered.edges[1].props = { filter: ["Send"] };
    expect(check(filtered).findings).toEqual([]);
    const unseeded = messageTypesFixture();
    unseeded.edges.shift();
    expect(check(unseeded).findings).toEqual([]);
    const broker = messageTypesFixture();
    broker.nodes[2].stencil = "generic.queue";
    broker.nodes[2].props = { maxDeliveryCount: 3 };
    expect(check(broker).findings).toEqual([]);
  });

  it("honours Ignore here and turning the check off", () => {
    const d = messageTypesFixture();
    const finding = check(d).findings[0];
    d.checks = { ignore: [{ rule: "message-loop", target: finding.target }] };
    expect(check(d).findings).toEqual([]);
    expect(check(d).ignored).toHaveLength(1);
    d.checks = { off: ["message-loop"] };
    expect(check(d).ran).toEqual([]);
  });

  it("shares the exact propagation result through the Check context", () => {
    const ctx = buildContext(messageTypesFixture());
    expect(ctx.messageTypes()).toBe(ctx.messageTypes());
    expect(ctx.messageTypes().carried.get("send")).toEqual(new Set(["Send", "Callback"]));
  });
});
