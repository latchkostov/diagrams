import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../../model/types";
import { LIMITS } from "../native";
import { parseMermaid, looksLikeMermaid } from "./read";
import { diagramToMermaid } from "./write";
import { getStencil } from "../../stencils/registry";
import { MERMAID_SHAPES } from "./shapes";
import { parse as parseYaml } from "yaml";

describe("annotation shape syntax", () => {
  it.each(["C:\\Users\\Ada", "C:\\temp", "trailing\\", "literal\\n\\t\\u1234", 'slash\\"quote', "tab\tbetween"])(
    "round-trips extended YAML label %s",
    (label) => {
      const d: DiagramFile = {
        format: "diagrams/v1",
        title: "Escapes",
        nodes: [],
        edges: [],
        annotations: [{ id: "a", kind: "shape", shape: "doc", text: label, x: 0, y: 0, width: 160, height: 90 }],
      };
      const exported = diagramToMermaid(d, { metadata: false });
      const attributes = exported.match(/@\{([^\n]+)\}/)![1];
      const parsed = parseYaml(`{${attributes}}`) as { label: string };
      expect(parsed.label.replace(/#quot;/g, '"')).toBe(label);
      expect(parseMermaid(exported).diagram.nodes[0].label).toBe(label);
    },
  );
  it.each([
    [String.raw`"\x41"`, "A"],
    [String.raw`"a\_b"`, "a\u00a0b"],
    ['"literal\ttab"', "literal\ttab"],
    ["'Ada''s, {invoice}'", "Ada's, {invoice}"],
    ["Ada's invoice", "Ada's invoice"],
  ])("imports external YAML scalar %s and preserves its following connection", (scalar, decoded) => {
    const result = parseMermaid(`flowchart LR\na@{ shape: doc, label: ${scalar} } --> b[Next]`);
    expect(result.diagram.nodes.map((n) => n.label)).toEqual([decoded, "Next"]);
    expect(result.diagram.edges).toMatchObject([{ from: "a", to: "b" }]);
  });
  for (const [shape, syntax] of Object.entries(MERMAID_SHAPES)) {
    it(`${shape} preserves labels through writer and reader`, () => {
      const label = 'Payload {id}, "invoice"';
      const d: DiagramFile = {
        format: "diagrams/v1",
        title: "Shapes",
        nodes: [],
        edges: [],
        annotations: [
          {
            id: "a",
            kind: "shape",
            shape: shape as keyof typeof MERMAID_SHAPES,
            text: label,
            x: 0,
            y: 0,
            width: 180,
            height: 100,
          },
        ],
      };
      const exported = diagramToMermaid(d, { metadata: false });
      const back = parseMermaid(exported);
      expect(back.warnings).toEqual([]);
      expect(back.diagram.nodes).toHaveLength(1);
      expect(back.diagram.nodes[0].label).toBe(label);
      for (const alias of [syntax.shape, ...(syntax.aliases ?? [])]) {
        expect(
          parseMermaid(`flowchart LR\na@{ shape: ${alias}, label: "Payload {id}, #quot;invoice#quot;" }`).diagram
            .nodes[0].label,
        ).toBe(label);
      }
    });
  }
  it("escapes braces in extended labels and parses quoted braces before following connections", () => {
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Shapes",
      nodes: [],
      edges: [],
      annotations: [{ id: "a", kind: "shape", shape: "doc", text: "JSON {id}", x: 0, y: 0, width: 180, height: 100 }],
    };
    expect(diagramToMermaid(d)).toContain('label: "JSON #123;id#125;"');
    const back = parseMermaid('flowchart LR\na@{ shape: doc, label: "JSON {id}" } --> b[Next]');
    expect(back.diagram.nodes.map((n) => n.label)).toEqual(["JSON {id}", "Next"]);
    expect(back.diagram.edges).toHaveLength(1);
  });
});

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

  it("keeps node ids that start with a directive keyword, and still skips the directives", () => {
    const src = `
flowchart LR
  clickstream[(Clickstream)] --> classifier[Classifier]
  classifier --> styles_db[(Styles)]
  directional --> linkstyles
  accounts --> styles_db; clicker --> classifier
  classDef hot fill:#f00
  class classifier hot
  CLASS clickstream hot
  style styles_db fill:#0f0
  linkStyle 0 stroke:#f00
  click classifier "https://example.com"
  direction TB
  accTitle: Clickstream pipeline
  accDescr: Events flow to a classifier
  accDescr { A longer description }
  %% styles_db --> nowhere
`;
    const { diagram } = parseMermaid(src);
    expect(diagram.nodes.map((n) => n.id)).toEqual([
      "clickstream",
      "classifier",
      "styles_db",
      "directional",
      "linkstyles",
      "accounts",
      "clicker",
    ]);
    expect(diagram.nodes.find((n) => n.id === "clickstream")?.label).toBe("Clickstream");
    expect(diagram.edges.map((e) => [e.from, e.to])).toEqual([
      ["clickstream", "classifier"],
      ["classifier", "styles_db"],
      ["directional", "linkstyles"],
      ["accounts", "styles_db"],
      ["clicker", "classifier"],
    ]);
    expect(diagram.direction).toBe("LR");
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

  it("shapes nodes by what the stencil is, not its palette category, and keeps roles without metadata", () => {
    // [stencil, label, Mermaid brackets]: the data category also holds ETL tools and BI dashboards.
    const cases: [string, string, string][] = [
      ["dbt", "dbt", "[]"],
      ["airbyte", "Airbyte", "[]"],
      ["snowflake.snowpipe", "Snowpipe", "[]"],
      ["generic.reverse-etl", "Reverse ETL", "[]"],
      ["looker", "Looker", "[]"],
      ["tableau", "Tableau", "[]"],
      ["azure.data-factory", "Data Factory", "[]"],
      ["generic.event-store", "Event store", "[]"],
      ["generic.saga", "Saga orchestrator", "[]"],
      ["postgres", "Postgres", "[()]"],
      ["generic.database", "Orders database", "[()]"],
      ["client.user", "User", "([])"],
    ];
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Shapes",
      nodes: cases.map(([stencil, label], i) => ({ id: `n${i}`, stencil, label, x: 0, y: 0 })),
      edges: [],
    };
    const text = diagramToMermaid(d, { metadata: false });
    cases.forEach(([, label, brackets], i) => {
      const open = brackets.slice(0, brackets.length / 2);
      const close = brackets.slice(brackets.length / 2);
      expect(text, label).toContain(`n${i}${open}"${label}"${close}`);
    });
    const back = parseMermaid(text).diagram;
    expect(back.nodes.map((n) => [n.label, n.stencil, getStencil(n.stencil).simRole])).toEqual(
      cases.map(([stencil, label]) => [label, stencil, getStencil(stencil).simRole]),
    );
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
      const edges = (d: DiagramFile) =>
        d.edges.map((e) => [e.id, e.from, e.to, e.label, e.kind ?? "async", e.relation ?? "flow"]);
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
      // Dependencies are always dotted, so only a flow's kind survives without metadata; relations do.
      const kinds = (d: DiagramFile) => d.edges.map((e) => (e.relation ? e.relation : (e.kind ?? "async")));
      expect(kinds(plain)).toEqual(kinds(ex));
    });
  }
});

describe("Mermaid pre-expansion budgets", () => {
  it("rejects a compact Cartesian product before allocating or laying out edges", () => {
    const left = Array.from({ length: 160 }, (_, i) => `a${i}`).join(" & ");
    const right = Array.from({ length: 160 }, (_, i) => `b${i}`).join(" & ");
    expect(() => parseMermaid(`flowchart LR\n${left} --> ${right}`)).toThrow(/edge budget.*before link expansion/);
  });
  it("charges chained products against one cumulative edge budget", () => {
    const ids = Array.from({ length: 101 }, (_, i) => `a${i}`).join(" & ");
    expect(() => parseMermaid(`flowchart LR\n${ids} --> ${ids} --> ${ids}`)).toThrow(/edge budget/);
  });
  it("bounds nodes and groups while parsing", () => {
    expect(() =>
      parseMermaid("flowchart LR\n" + Array.from({ length: LIMITS.maxNodes + 1 }, (_, i) => `a${i}`).join("\n")),
    ).toThrow(/node budget/);
    expect(() =>
      parseMermaid(
        "flowchart LR\n" + Array.from({ length: LIMITS.maxGroups + 1 }, (_, i) => `subgraph g${i}\nend`).join("\n"),
      ),
    ).toThrow(/group budget/);
  });
});

it("charges unsupported subgraph-link products against the parsing budget too", () => {
  const groups = Array.from({ length: 160 }, (_, i) => `subgraph g${i}\nend`).join("\n");
  const refs = Array.from({ length: 160 }, (_, i) => `g${i}`).join(" & ");
  expect(() => parseMermaid(`flowchart LR\nn\n${groups}\n${refs} --> ${refs}`)).toThrow(/edge budget/);
  expect(() => parseMermaid(`flowchart LR\nn\nsubgraph g\nend\ng${" --> g".repeat(LIMITS.maxEdges + 1)}`)).toThrow(
    /edge budget/,
  );
});
