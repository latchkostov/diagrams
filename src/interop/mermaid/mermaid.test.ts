import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../../model/types";
import { parseMermaid, looksLikeMermaid } from "./read";
import { diagramToMermaid } from "./write";

const examples = import.meta.glob<DiagramFile>("../../examples/*.json", { eager: true, import: "default" });

describe("Mermaid import", () => {
  it("reads shapes, labels, link styles, chains and subgraphs", () => {
    const src = `
%% A comment
flowchart LR
  user([Customer]) -->|POST /orders| api[Order API<br/>ASP.NET Core]
  subgraph azure [Azure subscription]
    api -.->|OrderPlaced| sb[(Service Bus orders)]
    sb -. fan out .-> fn{{Billing Azure Function}}
  end
  fn ==> db[(Postgres ledger)]
  fn --> mail>Email] & audit["Audit &quot;log&quot;"]
  db --- report
  report ~~~ hidden
  classDef hot fill:#f00
  class api hot
`;
    const { diagram, warnings } = parseMermaid(src);
    const by = new Map(diagram.nodes.map((n) => [n.id, n]));
    expect(diagram.direction).toBe("LR");
    expect([...by.keys()]).toEqual(["user", "api", "sb", "fn", "db", "mail", "audit", "report", "hidden"]);
    expect(by.get("user")?.stencil).toBe("client.user");
    expect(by.get("api")).toMatchObject({
      label: "Order API",
      sublabel: "ASP.NET Core",
      stencil: "service.dotnet",
      group: "azure",
    });
    expect(by.get("sb")?.stencil).toBe("azure.service-bus.queue");
    expect(by.get("fn")?.stencil).toBe("azure.functions");
    expect(by.get("db")?.stencil).toBe("postgres");
    expect(by.get("mail")?.stencil).toBe("generic.email");
    expect(by.get("audit")?.label).toBe('Audit "log"');
    expect(by.get("report")?.stencil).toBe("generic.service");

    const e = diagram.edges.map((x) => [x.from, x.to, x.label, x.kind]);
    expect(e).toEqual([
      ["user", "api", "POST /orders", "sync"],
      ["api", "sb", "OrderPlaced", "async"],
      ["sb", "fn", "fan out", "async"],
      ["fn", "db", undefined, "sync"],
      ["fn", "mail", undefined, "sync"],
      ["fn", "audit", undefined, "sync"],
      ["db", "report", undefined, "sync"],
    ]);
    expect(diagram.groups).toEqual([
      expect.objectContaining({ id: "azure", label: "Azure subscription", tone: "azure" }),
    ]);
    expect(warnings.some((w) => /invisible/.test(w))).toBe(true);
  });

  it("lays nodes out left to right, members inside their boundary", () => {
    const { diagram } = parseMermaid("flowchart LR\n a --> b\n subgraph g [Group]\n b --> c\n end");
    const [a, b, c] = diagram.nodes;
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
    const g = diagram.groups![0];
    for (const n of [b, c]) {
      expect(n.x).toBeGreaterThanOrEqual(g.x);
      expect(n.y).toBeGreaterThanOrEqual(g.y);
      expect(n.x + 220).toBeLessThanOrEqual(g.x + g.width);
    }
    expect(a.group).toBeUndefined();
  });

  it("accepts graph TD, semicolons, text-style labels and new shape syntax", () => {
    const { diagram } = parseMermaid(
      'graph TD; A -- calls --> B; B == "writes" ==> C; C@{ shape: cyl, label: "Orders DB" }',
    );
    expect(diagram.direction).toBe("TB");
    expect(diagram.edges.map((e) => e.label)).toEqual(["calls", "writes"]);
    expect(diagram.nodes.find((n) => n.id === "C")).toMatchObject({ label: "Orders DB", stencil: "generic.database" });
  });

  it("explains unsupported or broken input", () => {
    expect(() => parseMermaid("sequenceDiagram\n A->>B: hi")).toThrow(/Only Mermaid flowcharts/);
    expect(() => parseMermaid("hello")).toThrow(/starts with/);
    expect(() => parseMermaid("flowchart LR\n A[unclosed")).toThrow(/Line 2/);
  });

  it("sniffs flowcharts", () => {
    expect(looksLikeMermaid("---\ntitle: x\n---\nflowchart LR\nA-->B")).toBe(true);
    expect(looksLikeMermaid("%% c\ngraph TD\nA-->B")).toBe(true);
    expect(looksLikeMermaid('{"format":"diagrams/v1"}')).toBe(false);
  });
});

describe("Mermaid export", () => {
  it("writes subgraphs, dotted async edges and labels", () => {
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Tiny",
      groups: [{ id: "end", label: 'Cloud "A"', x: 0, y: 0, width: 10, height: 10 }],
      nodes: [
        { id: "a-b", stencil: "client.user", label: "User", x: 0, y: 0 },
        { id: "end", stencil: "postgres", label: "DB", sublabel: "primary", x: 0, y: 0, group: "end" },
      ],
      edges: [{ id: "e", from: "a-b", to: "end", label: "writes", kind: "async" }],
    };
    const text = diagramToMermaid(d);
    expect(text).toContain("flowchart LR");
    expect(text).toContain('subgraph g_end ["Cloud #quot;A#quot;"]');
    expect(text).toContain('n_end[("DB<br/>primary")]');
    expect(text).toContain('a_b(["User"])');
    expect(text).toContain('a_b -.->|"writes"| n_end');
    const back = parseMermaid(text).diagram;
    expect(back.title).toBe("Tiny");
    expect(back.nodes.map((n) => [n.id, n.stencil, n.label, n.sublabel, n.group])).toEqual([
      ["end", "postgres", "DB", "primary", "end"],
      ["a-b", "client.user", "User", undefined, undefined],
    ]);
    expect(back.edges).toEqual([{ id: "e", from: "a-b", to: "end", label: "writes", kind: "async" }]);
  });
});

describe("round-trip: every public example through Mermaid", () => {
  for (const [path, ex] of Object.entries(examples)) {
    it(path.split("/").pop()!, () => {
      const back = parseMermaid(diagramToMermaid(ex)).diagram;
      const nodes = (d: DiagramFile) =>
        d.nodes
          .map((n) => [n.id, n.stencil, n.label, n.sublabel ?? undefined, n.group ?? undefined] as const)
          .sort((a, b) => a[0].localeCompare(b[0]));
      expect(nodes(back)).toEqual(nodes(ex));
      const edges = (d: DiagramFile) => d.edges.map((e) => [e.id, e.from, e.to, e.label, e.kind ?? "async"]);
      expect(edges(back)).toEqual(edges(ex));
      expect((back.groups ?? []).map((g) => [g.id, g.label, g.tone])).toEqual(
        (ex.groups ?? []).map((g) => [g.id, g.label, g.tone ?? "neutral"]),
      );
      expect(back.title).toBe(ex.title);
      // Without our metadata comment, the structure (counts, labels, links) still survives.
      const plain = parseMermaid(diagramToMermaid(ex, { metadata: false })).diagram;
      expect(plain.nodes).toHaveLength(ex.nodes.length);
      expect(plain.edges).toHaveLength(ex.edges.length);
      expect(plain.nodes.map((n) => n.label).sort()).toEqual(ex.nodes.map((n) => n.label).sort());
      expect(plain.edges.map((e) => e.kind)).toEqual(ex.edges.map((e) => e.kind ?? "async"));
    });
  }
});
