import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../../model/types";
import { catalog } from "../../stencils/catalog";
import { LIMITS, validateDiagram } from "../native";
import { bytesToBase64, deflateRaw, textToBytes } from "../codec";
import { parseXml } from "../xml";
import { drawioPageToDiagram, readDrawio } from "./read";
import { diagramToDrawio } from "./write";
import { nativeShape, parseStyle, stencilFromStyle } from "./mapping";
import { revisionAtLeast } from "../../model/revisions";
import { waitingFixture } from "../../lab/waitingFixture";
import { resourceLesson } from "../../model/autoscaling";
import { createEngine } from "../../sim/engine";
import azureOrders from "./fixtures/azure-orders.drawio?raw";
import twoPages from "./fixtures/two-pages-compressed.drawio?raw";
import shaped from "../../../tests/parity/corpus/hand-shaped-lines.diagram.json";
import { ROUTE_LIMITS } from "../../model/edgeRoute";

// Public examples only (the glob does not descend into ./private).
const examples = import.meta.glob<DiagramFile>("../../examples/*.json", { eager: true, import: "default" });

async function importFirst(xml: string) {
  const doc = await readDrawio(xml);
  return drawioPageToDiagram(doc.pages[0]);
}

it("round-trips our hand-shaped routes and fixed sides 1:1, including negative and fractional points", async () => {
  const d = structuredClone(shaped) as DiagramFile;
  d.edges[0].waypoints![0] = { x: -123.125, y: 220.75 };
  const xml = diagramToDrawio(d);
  expect(xml).toContain('<Array as="points">');
  expect(xml).toContain('<mxPoint x="-123.125" y="220.75" />');
  const { diagram, warnings } = await importFirst(xml);
  expect(warnings).toEqual([]);
  expect(
    diagram.edges.map(({ id, sourceSide, targetSide, waypoints }) => ({ id, sourceSide, targetSide, waypoints })),
  ).toEqual(d.edges.map(({ id, sourceSide, targetSide, waypoints }) => ({ id, sourceSide, targetSide, waypoints })));
  expect(validateDiagram(diagram).ok).toBe(true);
});

it("drops foreign draw.io routes and sides with a counted report", async () => {
  const xml = diagramToDrawio(shaped as DiagramFile).replace(/ dg_[\w]+="[^"]*"/g, "");
  const { diagram, warnings } = await importFirst(xml);
  expect(diagram.edges).toHaveLength(shaped.edges.length);
  for (const edge of diagram.edges) {
    expect(edge.waypoints).toBeUndefined();
    expect(edge.sourceSide).toBeUndefined();
    expect(edge.targetSide).toBeUndefined();
  }
  expect(warnings).toContain("4 connectors' hand-drawn routes were left to automatic routing.");
});

it.each(["NaN", "Infinity", "1000001", "12px", ""])("drops invalid draw.io waypoint coordinate %s", async (x) => {
  const xml = diagramToDrawio(shaped as DiagramFile).replace('x="110" y="220"', `x="${x}" y="220"`);
  const { diagram, warnings } = await importFirst(xml);
  expect(diagram.edges[0].waypoints).toBeUndefined();
  expect(warnings).toContain('Ignored waypoints: "api-db"');
});

it("accepts the shared draw.io waypoint and coordinate limits", async () => {
  const d = structuredClone(shaped) as DiagramFile;
  d.edges[0].waypoints = Array.from({ length: ROUTE_LIMITS.maxPoints }, (_, i) => ({
    x: i % 2 ? ROUTE_LIMITS.maxCoordinate : -ROUTE_LIMITS.maxCoordinate,
    y: i,
  }));
  const { diagram, warnings } = await importFirst(diagramToDrawio(d));
  expect(warnings).toEqual([]);
  expect(diagram.edges[0].waypoints).toEqual(d.edges[0].waypoints);
});

it("round-trips non-blocking calls, reply handling, caps and saved simulation overrides", async () => {
  const d = waitingFixture();
  d.edges[1].props = { caller: { wait: "non-blocking", replyMs: 30, poolConnections: 2, deadlineMs: 600 } };
  d.simulations = [
    {
      id: "freed",
      title: "Free the thread",
      traffic: [],
      setup: { edges: { call: { caller: { wait: "blocking", deadlineMs: 100 } } } },
    },
  ];
  const imported = await importFirst(diagramToDrawio(d));
  const result = validateDiagram(imported.diagram);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.diagram.edges[1].props?.caller).toEqual(d.edges[1].props.caller);
  expect(result.diagram.simulations).toEqual(d.simulations);
  const e = createEngine();
  e.load(result.diagram);
  e.inject("source", 8);
  e.step(50);
  expect(e.snapshot().edges.call.calls).toMatchObject({ inFlight: 2, held: 0 });
});

it("repairs cyclic draw.io boundary metadata through native validation", async () => {
  const input: DiagramFile = {
    format: "diagrams/v1",
    title: "Cycle",
    nodes: [],
    edges: [],
    groups: [
      { id: "a", label: "A", group: "b", x: 0, y: 0, width: 400, height: 400 },
      { id: "b", label: "B", group: "a", x: 50, y: 50, width: 200, height: 200 },
    ],
  };
  const imported = await importFirst(diagramToDrawio(input));
  const result = validateDiagram(imported.diagram);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.diagram.groups?.filter((g) => g.group)).toHaveLength(1);
  expect(result.warnings.some((w) => w.includes("cyclic parent"))).toBe(true);
});

describe("draw.io colour contract", () => {
  it("never writes invalid colours into draw.io metadata or styles", () => {
    const input: DiagramFile = {
      format: "diagrams/v1",
      title: "Colours",
      color: "red;fillColor=blue",
      nodes: [],
      edges: [],
      annotations: [{ id: "note", kind: "note", text: "Note", x: 0, y: 0, width: 240, height: 160, color: "#12345" }],
    };
    const xml = diagramToDrawio(input);
    expect(xml).not.toContain("dg_color=");
    expect(xml).not.toContain("#12345");
    expect(xml).not.toContain("red;fillColor=blue");
  });
  it.each(["#abc", "#abcd", "#fff0", "#abcdef", "#abcdef00", "#11223344", "white", "blue"])(
    "round-trips canvas and annotation colours losslessly: %s",
    async (color) => {
      const input: DiagramFile = {
        format: "diagrams/v1",
        title: "Colours",
        color,
        nodes: [],
        edges: [],
        annotations: [{ id: "note", kind: "note", text: "Note", x: 0, y: 0, width: 240, height: 160, color }],
      };
      const { diagram } = await importFirst(diagramToDrawio(input));
      expect(diagram.color).toBe(color);
      expect(diagram.annotations?.[0].color).toBe(color);
    },
  );

  it.each(["red;fillColor=blue", "#12345", "rgb(1,2,3)", "__proto__"])(
    "drops invalid dg_color at both diagram and annotation level: %s",
    async (color) => {
      const { diagram } = await importFirst(
        `<mxGraphModel><root><object id="0" dg_color="${color}"><mxCell/></object><mxCell id="1" parent="0"/><object id="a" dg_annotation="note" dg_color="${color}"><mxCell vertex="1" parent="1"><mxGeometry x="0" y="0" width="240" height="160" as="geometry"/></mxCell></object></root></mxGraphModel>`,
      );
      expect(diagram.color).toBeUndefined();
      expect(diagram.annotations?.[0].color).toBeUndefined();
    },
  );
});

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
    // The free-standing text becomes a text annotation, not a node.
    expect(byId.has("note")).toBe(false);
    expect(diagram.annotations).toEqual([
      expect.objectContaining({ id: "note", kind: "text", text: "Draft: owners to confirm" }),
    ]);

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
            // A1 resource data requires its revision; older planning-model loss remains explicit
            // (docs/BACKLOG.md) for the other showcases.
            format: revisionAtLeast(ex.planning?.revision, "p3-a1") ? "diagrams/v2" : "diagrams/v1",
            planning: revisionAtLeast(ex.planning?.revision, "p3-a1") ? ex.planning : undefined,
            groups: ex.groups?.map((g) => ({ ...g, tone: g.tone ?? "neutral" })),
            edges: ex.edges.map((e) => ({ ...e, kind: e.kind ?? "async" })),
          }),
        ),
      );
    });
  }
});

describe("draw.io review regressions", () => {
  it("preserves W1 routes, resources, saved simulations and blocking execution", async () => {
    const d = waitingFixture();
    d.planning!.requestRoutes = [{ id: "score", address: { method: "POST", path: "/score" } }];
    d.edges[1].props!.requestRouteId = "score";
    d.nodes[1].props!.resources = { ...resourceLesson(), cpuMsPerMessage: 1 };
    d.simulations = [
      {
        id: "burst",
        title: "A waiting burst",
        traffic: [{ id: "batch", node: "source", shape: { kind: "burst", count: 8 } }],
      },
    ];
    const imported = await importFirst(diagramToDrawio(d));
    const back = imported.diagram;
    expect(imported.warnings).toEqual([]);
    expect(back.format).toBe("diagrams/v2");
    expect(back.planning).toEqual(d.planning);
    expect(back.nodes.map((n) => n.props)).toEqual(d.nodes.map((n) => n.props));
    expect(back.edges.map((e) => e.props)).toEqual(d.edges.map((e) => e.props));
    expect(back.simulations).toEqual(d.simulations);
    for (const diagram of [d, back]) {
      const e = createEngine({ seed: 17 });
      e.load(diagram);
      e.inject("source", 8);
      e.step(40);
      expect(e.snapshot().nodes.caller.threads).toMatchObject({ waiting: 4, queued: 4 });
      expect(e.snapshot().nodes.caller.processed).toBe(0);
      e.step(1000);
      expect(e.snapshot().nodes.caller.processed).toBe(8);
      expect(e.snapshot().inSystem).toBe(0);
    }
  });
  it("round-trips a self-loop edge", async () => {
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Loop",
      nodes: [{ id: "a", stencil: "generic.service", label: "A", x: 0, y: 0 }],
      edges: [{ id: "loop", from: "a", to: "a", label: "again", kind: "async" }],
    };
    const imported = await importFirst(diagramToDrawio(d));
    expect(imported.diagram.edges).toEqual(d.edges);
    expect(imported.warnings.join(" ")).not.toMatch(/connector/);
  });
  it("uses one decompression allowance across compressed pages", async () => {
    const page = `<mxGraphModel><root><!--${"x".repeat(Math.floor(LIMITS.maxInflatedBytes / 3))}--></root></mxGraphModel>`;
    const compressed = bytesToBase64(await deflateRaw(textToBytes(encodeURIComponent(page))));
    await expect(
      readDrawio(`<mxfile>${Array.from({ length: 4 }, () => `<diagram>${compressed}</diagram>`).join("")}</mxfile>`),
    ).rejects.toThrow(/too large|budget/);
  });
  it("bounds page count before decoding pages", async () => {
    await expect(
      readDrawio(
        `<mxfile>${"<diagram><mxGraphModel><root/></mxGraphModel></diagram>".repeat(LIMITS.maxPages + 1)}</mxfile>`,
      ),
    ).rejects.toThrow(/page budget/);
  });
});
