import { describe, expect, it, vi } from "vitest";
import { messageTypesFixture } from "../lab/messageTypesFixture";
import { applyOps } from "../ai";
import * as propagation from "../model/messageTypes";
import { messageTypesAt } from "../model/messageTypes";
import { runChecks } from "./run";
import { createSimulationRun } from "../sim/simulation";
import { buildContext } from "./context";
import { createEngine } from "../sim/engine";
import type { DiagramFile, Simulation } from "../model/types";

const check = (d = messageTypesFixture()) => runChecks(d, { rules: ["message-loop"] });
const savedRun = (patch: Partial<Simulation> = {}): Simulation => ({
  id: "saved",
  title: "Saved",
  traffic: [{ id: "t", node: "client", messageType: "Send", shape: { kind: "burst", count: 8 } }],
  ...patch,
});
/** Client sends Send on /loop; Partner sends Callback on /oneway; only /loop may return from Sender. */
function routedFixture(): Pick<DiagramFile, "format" | "planning" | "nodes" | "edges"> {
  const d = messageTypesFixture();
  const mix = (routeId: string) => ({ mode: "shares" as const, entries: [{ routeId, share: 1 }] });
  return {
    format: "diagrams/v2",
    planning: {
      revision: "p3-a1",
      requestRoutes: [
        { id: "loop", address: { method: "POST", path: "/loop" } },
        { id: "oneway", address: { method: "POST", path: "/oneway" } },
      ],
    },
    nodes: [
      { ...d.nodes[0], props: { messageType: "Send", ratePerSec: 0, trafficMix: mix("loop") } },
      d.nodes[1],
      d.nodes[2],
      {
        id: "partner",
        stencil: "client.browser",
        label: "Partner",
        x: 40,
        y: 300,
        props: { messageType: "Callback", ratePerSec: 0, trafficMix: mix("oneway") },
      },
    ],
    edges: [
      ...d.edges.slice(0, 2),
      { ...d.edges[2], props: { emits: "Callback", requestFilter: { path: { kind: "exact", value: "/loop" } } } },
      { id: "partner-in", from: "partner", to: "api", kind: "async" },
    ],
  };
}

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
    // Both typed loops are this one finding at API: no single filter or rename stops both.
    expect(finding.fix).toBeUndefined();
    const merged = applyOps(d, [{ op: "update", target: "send", props: { emits: "AReceived" } }]).diagram;
    expect(messageTypesAt(merged).loops).toHaveLength(1);
    expect(messageTypesAt(merged).loops[0].type).toBe("AReceived");
    // What a per-loop verifier offered: it stops A and leaves B looping back to API, so the warning stays.
    const partial = applyOps(d, [{ op: "update", target: "send", props: { filter: ["B"] } }]).diagram;
    expect(check(partial).findings.map((f) => f.id)).toEqual([finding.id]);
  });

  it("offers only fixes and renames that remove their finding and add no loop, in every run", () => {
    const variants: [string, DiagramFile][] = [];
    const add = (name: string, edit: (d: DiagramFile) => void) => {
      const d = messageTypesFixture();
      edit(d);
      variants.push([name, d]);
    };
    add("callback", () => {});
    add("filtered send", (d) => (d.edges[1].props = { filter: ["Send", "Callback"] }));
    add("two sources", (d) => {
      d.edges[2].props = undefined;
      d.nodes[0].props = { messageType: "A" };
      d.nodes.push({ ...d.nodes[0], id: "second", props: { messageType: "B" } });
      d.edges.push({ id: "second-in", from: "second", to: "api" });
    });
    add("saved setup", (d) => {
      d.edges[1].props = { filter: ["Send", "Callback"] };
      d.simulations = [savedRun({ setup: { props: { sender: { emits: { Send: "Other" } } } } })];
    });
    add("routes", (d) => Object.assign(d, routedFixture()));
    const coarse = (diagram: DiagramFile) =>
      new Set(messageTypesAt(diagram).loops.flatMap((l) => l.steps.map((s) => `${s.edge}:${s.receives}:${s.sends}`)));
    let offered = 0;
    for (const [name, d] of variants) {
      const before = coarse(d);
      for (const finding of check(d).findings) {
        for (const ops of [finding.fix?.ops, ...(finding.fix?.options ?? []).map((o) => o.ops)]) {
          if (!ops) continue;
          offered++;
          const fixed = applyOps(d, ops).diagram;
          expect(
            check(fixed).findings.map((f) => f.id),
            name,
          ).not.toContain(finding.id);
          for (const step of coarse(fixed)) expect(before, `${name}: ${step}`).toContain(step);
        }
      }
    }
    expect(offered).toBeGreaterThanOrEqual(4);
  });

  it("verifies loop fixes on saved simulations configured exactly as playback configures them", () => {
    const d = messageTypesFixture();
    // Saved runs override only waiting-call settings on connections. Playback ignores anything else there, so the
    // verifier must too: the edit goes to the diagram and each run's own overrides are applied after it.
    d.format = "diagrams/v2";
    d.planning = { revision: "p3-w1" };
    d.simulations = [
      savedRun({
        setup: {
          edges: { send: { caller: { wait: "blocking" }, filter: ["Send", "Callback"] } as never },
          props: { client: { messageType: "Send" } },
        },
      }),
    ];
    const finding = check(d).findings[0];
    expect(finding.fix?.ops).toEqual([{ op: "update", target: "send", props: { filter: ["Send"] } }]);
    // In memory, as the reviewers reproduced it: edit validation would refuse the extra setup key.
    const fixed: DiagramFile = {
      ...d,
      edges: d.edges.map((e) => (e.id === "send" ? { ...e, props: { ...e.props, filter: ["Send"] } } : e)),
    };
    expect(check(fixed).findings).toEqual([]);
    expect(messageTypesAt(fixed).loops).toEqual([]);
    // Playback agrees: the saved run's Callback stops at Sender instead of circulating.
    for (const [diagram, looping] of [
      [d, true],
      [fixed, false],
    ] as const) {
      const run = createSimulationRun(diagram, diagram.simulations![0]);
      for (let i = 0; i < 600; i++) run.step(10);
      const sent = run.engine.snapshot().edges.send.delivered;
      if (looping) expect(sent).toBeGreaterThan(8);
      else expect(sent).toBe(8);
    }
  });

  it("keeps deliveries that leave a loop's component on a message's first pass", () => {
    // A and B enter API -> Sender; Sender returns only A to API and also forwards everything to Audit.
    const d = messageTypesFixture();
    d.nodes[0].props = { messageType: "A" };
    d.nodes.push(
      { ...d.nodes[0], id: "second", label: "Second", props: { messageType: "B" } },
      { id: "audit", stencil: "generic.email", label: "Audit", x: 720, y: 400 },
    );
    d.edges[2].props = { filter: ["A"] };
    d.edges.push({ id: "second-in", from: "second", to: "api" }, { id: "audit-edge", from: "sender", to: "audit" });
    const audited = (diagram: DiagramFile) => {
      const engine = createEngine({ seed: 1 });
      engine.load(diagram);
      engine.inject("client", 2);
      for (let i = 0; i < 200; i++) engine.step(10);
      return engine.snapshot().nodes.audit.processed;
    };
    expect(audited(d)).toBeGreaterThanOrEqual(2);
    const [finding] = check(d).findings;
    expect(finding.message).toMatch(/^A messages loop back to API/);
    // "Only pass B" on API -> Sender would stop A before Sender, so Audit would never receive it.
    expect(finding.fix?.ops).not.toEqual([{ op: "update", target: "send", props: { filter: ["B"] } }]);
    for (const ops of [finding.fix?.ops, ...(finding.fix?.options ?? []).map((o) => o.ops)])
      if (ops) expect(audited(applyOps(d, ops).diagram)).toBeGreaterThanOrEqual(2);
    expect(audited(applyOps(d, [{ op: "update", target: "send", props: { filter: ["B"] } }]).diagram)).toBe(0);
  });

  it("withholds automatic loop fixes when a timeline changes emitted types", () => {
    const d = messageTypesFixture();
    d.simulations = [
      savedRun({
        timeline: [{ atMs: 0, action: { do: "props", node: "api", props: { emits: "Prepared" } } }],
        traffic: [{ id: "t", node: "client", messageType: "Send", shape: { kind: "burst", count: 3, atMs: 100 } }],
      }),
    ];
    const run = createSimulationRun(d, d.simulations[0]);
    for (let i = 0; i < 300; i++) run.step(10);
    // Before any fix, playback renames the burst at API: Sender receives Prepared.
    expect(run.engine.snapshot().edges.send.delivered).toBeGreaterThanOrEqual(3);
    const [finding] = check(d).findings;
    expect(finding.id).toBe("message-loop:api");
    expect(finding.fix).toBeUndefined();
    expect(finding.rationale).toContain("No single filter or rename was verified");
    // The same diagram without the runtime edit gets its verified fix.
    d.simulations[0].timeline = [];
    expect(check(d).findings[0].fix).toBeDefined();
  });

  it("keeps request routes apart when proving that non-loop traffic survives a fix", () => {
    const d = messageTypesFixture();
    Object.assign(d, routedFixture());
    // Callback loops on /loop only; /oneway Callback crosses the same send edge and legitimately ends at Sender.
    const finding = check(d).findings[0];
    expect(finding.message).toMatch(/^Callback messages loop back to API/);
    expect(finding.fix?.ops).toEqual([{ op: "update", target: "callback", props: { filter: ["Send"] } }]);
    const fixed = applyOps(d, finding.fix!.ops!).diagram;
    expect(check(fixed).findings).toEqual([]);
    // What an edge/type verifier offered drops the /oneway requests at API.
    const dropping = applyOps(d, [{ op: "update", target: "send", props: { filter: ["Send"] } }]).diagram;
    const oneway = (diagram: DiagramFile) => {
      const engine = createEngine({ seed: 1 });
      engine.load(diagram);
      engine.inject("partner", 3);
      for (let i = 0; i < 600; i++) engine.step(10);
      return engine.snapshot().nodes.sender.processed;
    };
    expect(oneway(d)).toBe(3);
    expect(oneway(fixed)).toBe(3);
    expect(oneway(dropping)).toBe(0);
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
