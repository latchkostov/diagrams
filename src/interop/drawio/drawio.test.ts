import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../../model/types";
import { catalog } from "../../stencils/catalog";
import { parseXml } from "../xml";
import { drawioPageToDiagram, readDrawio } from "./read";
import { diagramToDrawio } from "./write";
import { nativeShape, parseStyle, stencilFromStyle } from "./mapping";
import azureOrders from "./fixtures/azure-orders.drawio?raw";
import twoPages from "./fixtures/two-pages-compressed.drawio?raw";

// Public examples only (the glob does not descend into ./private).
const examples = import.meta.glob<DiagramFile>("../../examples/*.json", { eager: true, import: "default" });

async function importFirst(xml: string) {
  const doc = await readDrawio(xml);
  return drawioPageToDiagram(doc.pages[0]);
}

describe("draw.io import: uncompressed fixture", () => {
  it("maps shapes, containers, edges and labels", async () => {
    const { diagram, warnings } = await importFirst(azureOrders);
    expect(diagram.title).toBe("Order intake");
    const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
    expect(byId.get("fn")?.stencil).toBe("azure.functions");
    expect(byId.get("fn")?.label).toBe("Order API");
    expect(byId.get("fn")?.sublabel).toBe("Function App");
    expect(byId.get("sb")?.stencil).toBe("azure.service-bus.queue");
    expect(byId.get("cosmos")?.stencil).toBe("azure.cosmos-db");
    expect(byId.get("cosmos")?.label).toBe("Order store");
    expect(byId.get("customer")?.stencil).toBe("client.user");
    expect(byId.get("lambda")?.stencil).toBe("aws.lambda");
    // Plain box: label keyword. Cylinder: keyword beats the generic database shape.
    expect(byId.get("kafka")?.stencil).toBe("kafka.topic");
    expect(byId.get("kafka")?.sublabel).toBe("orders.v1");
    expect(byId.get("pg")?.stencil).toBe("postgres");
    // The text annotation is skipped.
    expect(byId.has("note")).toBe(false);
    expect(warnings.some((w) => /text label/.test(w))).toBe(true);

    // Swimlane -> group, children are members, tone from the colour/label.
    expect(diagram.groups).toHaveLength(1);
    const g = diagram.groups![0];
    expect(g).toMatchObject({ id: "azure", label: "Azure subscription", tone: "azure" });
    for (const id of ["fn", "sb", "cosmos"]) expect(byId.get(id)?.group).toBe("azure");
    expect(byId.get("lambda")?.group).toBeUndefined();
    // Every member card sits inside its (grown) boundary.
    for (const id of ["fn", "sb", "cosmos"]) {
      const n = byId.get(id)!;
      expect(n.x).toBeGreaterThanOrEqual(g.x);
      expect(n.x + 220).toBeLessThanOrEqual(g.x + g.width);
    }

    const edges = new Map(diagram.edges.map((e) => [e.id, e]));
    expect(edges.get("e1")).toMatchObject({ from: "customer", to: "fn", label: "POST /orders", kind: "sync" });
    expect(edges.get("e2")).toMatchObject({ from: "fn", to: "sb", label: "OrderPlaced", kind: "async" });
    expect(edges.get("e3")).toMatchObject({ from: "sb", to: "cosmos", kind: "async" });
    expect(edges.get("e4")).toMatchObject({ from: "lambda", to: "kafka", label: "publish", kind: "sync" });
    expect(edges.has("e6")).toBe(false);
    expect(warnings.some((w) => /connector/.test(w))).toBe(true);
  });

  it("spreads dense draw.io geometry so cards don't overlap", async () => {
    const { diagram } = await importFirst(azureOrders);
    const fn = diagram.nodes.find((n) => n.id === "fn")!;
    const sb = diagram.nodes.find((n) => n.id === "sb")!;
    expect(sb.x - fn.x).toBeGreaterThanOrEqual(220);
    expect(Math.abs(sb.y - fn.y)).toBeLessThan(20);
  });
});

describe("draw.io import: compressed, multi-page", () => {
  it("decodes every page", async () => {
    const doc = await readDrawio(twoPages);
    expect(doc.pages.map((p) => p.name)).toEqual(["Cluster", "Page-2"]);
    const first = drawioPageToDiagram(doc.pages[0]).diagram;
    expect(first.title).toBe("Cluster");
    expect(first.nodes.map((n) => [n.id, n.stencil])).toEqual([
      ["dep", "k8s.deployment"],
      ["pod", "k8s.pod"],
      ["q", "rabbitmq.queue"],
    ]);
    expect(first.groups?.[0]).toMatchObject({ label: "Namespace: checkout", tone: "k8s" });
    expect(first.edges.map((e) => [e.from, e.to, e.kind])).toEqual([
      ["dep", "pod", "sync"],
      ["pod", "q", "async"],
    ]);
    const second = drawioPageToDiagram(doc.pages[1], "Fallback").diagram;
    expect(second.title).toBe("Fallback");
    expect(second.nodes.map((n) => n.stencil).sort()).toEqual(["aws.s3", "aws.sqs"]);
  });

  it("explains damaged input", async () => {
    await expect(readDrawio("<mxfile><diagram name='x'>not-base64!!</diagram></mxfile>")).rejects.toThrow(
      /base64|decompressed/,
    );
    await expect(readDrawio("<html></html>")).rejects.toThrow(/mxfile/);
    await expect(readDrawio("<mxfile><diagram>")).rejects.toThrow(/well-formed/);
  });
});

describe("draw.io export", () => {
  const sample: DiagramFile = {
    format: "diagrams/v1",
    title: 'Sample <&> "quoted"',
    description: "Line one\nLine two",
    direction: "LR",
    groups: [{ id: "cloud", label: "Azure", tone: "azure", x: 360, y: 40, width: 700, height: 200 }],
    nodes: [
      { id: "web", stencil: "client.browser", label: "Web", x: 40, y: 100 },
      {
        id: "fn",
        stencil: "azure.functions",
        label: "Intake",
        sublabel: "HTTP trigger",
        x: 400,
        y: 100,
        group: "cloud",
        props: { concurrency: 8 },
      },
      { id: "q", stencil: "azure.service-bus.topic", label: "orders", x: 760, y: 100, group: "cloud" },
      { id: "k", stencil: "kafka.topic", label: "Kafka & co", x: 1120, y: 100 },
    ],
    edges: [
      { id: "a", from: "web", to: "fn", kind: "sync", label: "POST <order>" },
      { id: "b", from: "fn", to: "q", kind: "async", sourceSide: "right", targetSide: "left" },
      { id: "c", from: "q", to: "k", kind: "async" },
    ],
    simulations: [
      { id: "s1", title: "Burst", traffic: [{ id: "t", node: "web", shape: { kind: "burst", count: 10 } }] },
    ],
  };

  it("writes well-formed XML using draw.io's own shapes", () => {
    const xml = diagramToDrawio(sample, { iconSvg: () => "PHN2Zz48L3N2Zz4=" });
    const root = parseXml(xml);
    expect(root.name).toBe("mxfile");
    expect(xml).toContain("image=img/lib/azure2/compute/Function_Apps.svg");
    expect(xml).toContain("image=data:image/svg+xml,PHN2Zz48L3N2Zz4=");
    expect(xml).toContain("container=1");
    expect(xml).toMatch(/dashed=1/);
  });

  it("round-trips losslessly through its own export", async () => {
    const back = (await importFirst(diagramToDrawio(sample))).diagram;
    expect(back).toEqual(sample);
  });

  it("every mapped shape reads back to the same stencil", () => {
    for (const s of catalog) {
      const shape = nativeShape(s.id);
      if (!shape) continue;
      const hit = stencilFromStyle(parseStyle(shape.style));
      // Service Bus topics share the Service Bus icon; our export also stores dg_stencil.
      if (s.id === "azure.service-bus.topic") expect(hit?.stencil).toBe("azure.service-bus.queue");
      else expect(hit?.stencil, s.id).toBe(s.id);
    }
  });
});

describe("round-trip: every public example through draw.io", () => {
  for (const [path, ex] of Object.entries(examples)) {
    it(path.split("/").pop()!, async () => {
      const back = (await importFirst(diagramToDrawio(ex))).diagram;
      expect(back.nodes.map((n) => [n.id, n.stencil, n.label, n.sublabel, n.group])).toEqual(
        ex.nodes.map((n) => [n.id, n.stencil, n.label, n.sublabel, n.group]),
      );
      expect(back.edges.map((e) => [e.id, e.from, e.to, e.label, e.kind ?? "async"])).toEqual(
        ex.edges.map((e) => [e.id, e.from, e.to, e.label, e.kind ?? "async"]),
      );
      expect(back.nodes.map((n) => [n.x, n.y])).toEqual(ex.nodes.map((n) => [n.x, n.y]));
      expect(back.groups ?? []).toEqual((ex.groups ?? []).map((g) => ({ ...g, tone: g.tone ?? "neutral" })));
      expect(back.simulations).toEqual(ex.simulations);
      // Whole file, field for field (props, sides, title, description, direction).
      expect(JSON.parse(JSON.stringify(back))).toEqual(
        JSON.parse(
          JSON.stringify({
            ...ex,
            groups: ex.groups?.map((g) => ({ ...g, tone: g.tone ?? "neutral" })),
            edges: ex.edges.map((e) => ({ ...e, kind: e.kind ?? "async" })),
          }),
        ),
      );
    });
  }
});
