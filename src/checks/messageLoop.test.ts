import { describe, expect, it } from "vitest";
import { messageTypesFixture } from "../lab/messageTypesFixture";
import { applyOps } from "../ai";
import { messageTypesAt } from "../model/messageTypes";
import { runChecks } from "./run";
import { buildContext } from "./context";

const check = (d = messageTypesFixture()) => runChecks(d, { rules: ["message-loop"] });

describe("message-loop", () => {
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
