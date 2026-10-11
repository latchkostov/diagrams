import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { preserveUnknown, serializeNative, validateDiagram } from "./native";
import { decodeShare, encodeShare } from "./share";
import { diagramToDrawio } from "./drawio/write";
import { drawioPageToDiagram, readDrawio } from "./drawio/read";
import { diagramToMermaid } from "./mermaid/write";
import { parseMermaid, readDependencyLabel } from "./mermaid/read";
import { fromFlow, toFlow } from "../canvas/convert";
import aksJson from "../examples/aks-app-config-key-vault.json";

const aks = aksJson as DiagramFile;

const base = (edges: Record<string, unknown>[]): unknown => ({
  format: "diagrams/v1",
  title: "Rel",
  nodes: [
    { id: "api", stencil: "service.dotnet", label: "Orders API", x: 0, y: 0 },
    { id: "cfg", stencil: "azure.app-config", label: "orders-config", x: 300, y: 0 },
    { id: "kv", stencil: "azure.key-vault", label: "orders-kv", x: 600, y: 0 },
  ],
  edges,
});

describe("native format: relation", () => {
  it("keeps a known relation and its settings", () => {
    const r = validateDiagram(
      base([
        {
          id: "c",
          from: "api",
          to: "cfg",
          relation: "config",
          props: { settings: [{ key: "A" }, { key: "B", secret: true }] },
        },
        { id: "s", from: "cfg", to: "kv", relation: "secret", kind: "sync" },
      ]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    expect(r.diagram.edges[0].relation).toBe("config");
    expect(r.diagram.edges[0].props?.settings).toEqual([{ key: "A" }, { key: "B", secret: true }]);
    // Kind is kept on a dependency so switching back to a flow restores it.
    expect(r.diagram.edges[1]).toMatchObject({ relation: "secret", kind: "sync" });
  });

  it("drops an unknown relation (drawn as a flow) with a warning", () => {
    const r = validateDiagram(base([{ id: "x", from: "api", to: "kv", relation: "ownership" }]));
    expect(r.ok && r.diagram.edges[0].relation).toBe(undefined);
    expect(r.ok && r.warnings.join(" ")).toMatch(/unknown relationship "ownership"/);
  });

  it("repairs malformed settings and drops `when` on flows", () => {
    const r = validateDiagram(
      base([
        {
          id: "c",
          from: "api",
          to: "cfg",
          relation: "config",
          when: "cached",
          props: { settings: [{ key: "A" }, "junk", { key: 4 }], other: 1 },
        },
        { id: "f", from: "api", to: "kv", when: "startup" },
        { id: "bad", from: "cfg", to: "kv", relation: "secret", props: { settings: "nope" } },
      ]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [c, f, bad] = r.diagram.edges as (DiagramFile["edges"][number] & { when?: string })[];
    expect(c.props).toEqual({ settings: [{ key: "A" }], other: 1 });
    expect(c.when).toBe("cached");
    expect(f.when).toBeUndefined();
    expect(bad.props).toBeUndefined();
  });

  it("older files (no relation) load unchanged", () => {
    const old = base([{ id: "e", from: "api", to: "kv", kind: "sync", label: "Get secret" }]);
    const r = validateDiagram(old);
    expect(r.ok && r.diagram.edges).toEqual((old as DiagramFile).edges);
  });

  it("survives the canvas round trip, and an explicit flow stays a flow", () => {
    const flow = toFlow(aks);
    const back = fromFlow(flow.meta, flow.nodes, flow.edges);
    const byId = new Map(back.edges.map((e) => [e.id, e]));
    for (const e of aks.edges) {
      expect(byId.get(e.id)?.relation, e.id).toBe(e.relation);
      expect(byId.get(e.id)?.props, e.id).toEqual(e.props);
    }
    // Unknown edge fields from a newer build ride along through preserveUnknown.
    const future = { ...aks, edges: aks.edges.map((e) => ({ ...e, when: "cached" })) } as DiagramFile;
    const merged = preserveUnknown(back, future);
    expect((merged.edges[0] as { when?: string }).when).toBe("cached");
  });
});

describe("share links", () => {
  it("preserve relations and settings", async () => {
    const back = await decodeShare(await encodeShare(aks));
    expect(serializeNative(back)).toBe(serializeNative(validateOk(aks)));
    expect(back.edges.find((e) => e.id === "api-to-appcfg")?.props?.settings).toHaveLength(4);
  });
});

function validateOk(d: DiagramFile): DiagramFile {
  const r = validateDiagram(d);
  if (!r.ok) throw new Error(r.error);
  return r.diagram;
}

describe("draw.io", () => {
  it("writes dependencies dotted, tinted and open-arrowed, with dfRelation in the style", () => {
    const xml = diagramToDrawio(aks);
    const cell = xml.split("\n").find((l) => l.includes("dg-e-appcfg-to-kv") || l.includes('dg_id="appcfg-to-kv"'));
    expect(cell).toContain('dg_relation="secret"');
    const style = xml.slice(xml.indexOf('dg_id="appcfg-to-kv"'));
    expect(style).toMatch(/dashPattern=1 4;dfRelation=secret;/);
    expect(style).toMatch(/endArrow=open;endFill=0;/);
  });

  it("round-trips every relation (data or style alone)", async () => {
    const doc = await readDrawio(diagramToDrawio(aks));
    const { diagram } = drawioPageToDiagram(doc.pages[0]);
    const byId = new Map(diagram.edges.map((e) => [e.id, e]));
    for (const e of aks.edges) {
      expect(byId.get(e.id)?.relation, e.id).toBe(e.relation);
      expect(byId.get(e.id)?.kind, e.id).toBe(e.kind);
    }
    // A draw.io user who strips our custom data still has the style key.
    const stripped = diagramToDrawio(aks).replace(/ dg_relation="[^"]*"/g, "");
    const again = drawioPageToDiagram((await readDrawio(stripped)).pages[0]).diagram;
    expect(again.edges.find((e) => e.id === "api-to-ai")?.relation).toBe("telemetry");
  });
});

describe("Mermaid", () => {
  it("exports dependencies as dotted links with the implicit label as a prefix", () => {
    const text = diagramToMermaid(aks);
    expect(text).toContain('api -.->|"reads config"| appcfg');
    expect(text).toContain('api -.->|"gets tokens from: runs as"| mi');
    expect(text).toContain('api -->|"EF Core"| sql');
    expect(text).toMatch(/linkStyle [\d,]+ stroke:#A6720C/);
  });

  it("round-trips relations with our metadata and without it", () => {
    const withMeta = parseMermaid(diagramToMermaid(aks)).diagram;
    const plain = parseMermaid(diagramToMermaid(aks, { metadata: false })).diagram;
    for (const d of [withMeta, plain]) {
      const rel = (from: string, to: string) => d.edges.find((e) => e.from === from && e.to === to);
      expect(rel("api", "appcfg")?.relation).toBe("config");
      expect(rel("appcfg", "kv")?.relation).toBe("secret");
      expect(rel("api", "mi")).toMatchObject({ relation: "identity", label: "runs as" });
      expect(rel("mi", "entra")).toMatchObject({ relation: "identity", label: "OIDC federation" });
      expect(rel("api", "ai")?.relation).toBe("telemetry");
      expect(rel("api", "sb")?.relation).toBeUndefined();
    }
  });

  it("only dotted links with a relation prefix become dependencies", () => {
    const d = parseMermaid(
      "flowchart LR\n a -.->|reads secrets| b\n a -->|reads secrets| c\n a -.->|OrderPlaced| d\n a -.->|secret: ERP creds| e",
    ).diagram;
    const to = (id: string) => d.edges.find((e) => e.to === id);
    expect(to("b")?.relation).toBe("secret");
    expect(to("b")?.label).toBeUndefined();
    expect(to("c")?.relation).toBeUndefined();
    expect(to("d")?.relation).toBeUndefined();
    expect(to("e")).toMatchObject({ relation: "secret", label: "ERP creds" });
    expect(readDependencyLabel("Depends on: DNS")).toEqual({ relation: "depends", label: "DNS" });
    expect(readDependencyLabel("depends")).toEqual({ relation: "depends" });
  });
});

it("normalizes settings without changing their count and strips credential value fields from exports", async () => {
  const r = validateDiagram(
    base([
      {
        id: "c",
        from: "api",
        to: "cfg",
        relation: "config",
        props: {
          other: 42,
          settings: [
            { key: " padded ", value: "Fake-password-7!", secret: "yes" },
            { key: "x".repeat(220), secret: true },
          ],
        },
      },
    ]),
  );
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.error);
  expect(r.diagram.edges[0].props).toEqual({
    other: 42,
    settings: [{ key: "padded" }, { key: "x".repeat(200), secret: true }],
  });
  expect(serializeNative(r.diagram)).not.toContain("Fake-password-7!");
  const shared = await decodeShare(await encodeShare(r.diagram));
  expect(shared.edges[0].props).toEqual(r.diagram.edges[0].props);
});

it("preserves dependency-like labels on flow-only Mermaid round trips", () => {
  for (const relation of [undefined, "flow"] as const)
    for (const label of ["secret", "secret: ERP creds", "reads config", "depends on"]) {
      const d = validateOk(base([{ id: "f", from: "api", to: "cfg", kind: "async", relation, label }]) as DiagramFile);
      const text = diagramToMermaid(d);
      for (const exported of [text, text.replace(/,"relations":\{\}/, "")]) {
        expect(parseMermaid(exported).diagram.edges[0]).toMatchObject({ kind: "async", label });
        expect(parseMermaid(exported).diagram.edges[0].relation).toBeUndefined();
      }
    }
});
