import { describe, expect, it } from "vitest";
import {
  buildPayload,
  escapeHtml,
  exportHtml,
  FALLBACK_ICON,
  htmlFileName,
  injectPayload,
  PAYLOAD_BLOCK,
  PAYLOAD_PLACEHOLDER,
  scriptSafeJson,
  STENCIL_ICONS_OPEN,
  subsetIcons,
  svgDataUri,
  templateStencilIcons,
  viewerCsp,
  type ExportPayload,
} from "./inject";

/** A template shaped like the real one (scripts/interactive-viewer.ts), small enough to read. */
const TEMPLATE = [
  "<!doctype html>",
  '<html lang="en" data-theme="light">',
  "<head><title>Live Diagrams</title><style>body{}</style></head>",
  "<body>",
  `${STENCIL_ICONS_OPEN}${JSON.stringify({ "kafka.topic": "kafka", postgres: "postgresql", "generic.service": "generic-box" })}</script>`,
  PAYLOAD_BLOCK,
  "<script>/* the viewer: reads #diagram */</script>",
  "</body></html>",
].join("\n");

const SVGS = {
  kafka: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1"/></svg>',
  postgresql: "\uFEFF<svg><circle r='2'/></svg>\n",
  "generic-box": "<svg><rect/></svg>",
  redis: "<svg><g/></svg>",
};

const diagram = (extra: object = {}) => ({
  format: "diagrams/v1",
  title: "Orders",
  nodes: [
    { id: "t", stencil: "kafka.topic", label: "Topic", x: 0, y: 0 },
    { id: "d", stencil: "postgres", label: "DB", x: 200, y: 0 },
  ],
  edges: [],
  simulations: [
    { id: "a", title: "Normal day" },
    { id: "b", title: "Outage" },
  ],
  ...extra,
});

/** The payload as the viewer will read it: the data block's text, parsed. */
function readBack(html: string): ExportPayload {
  const open = '<script type="application/json" id="diagram">';
  const from = html.indexOf(open) + open.length;
  return JSON.parse(html.slice(from, html.indexOf("</script>", from))) as ExportPayload;
}

describe("scriptSafeJson", () => {
  it("can't end the script element or open a comment, and still parses back to the same value", () => {
    const value = { a: "</script><script>alert(1)</script>", b: "<!-- x -->", c: "line\u2028sep\u2029end", d: "$&$'" };
    const json = scriptSafeJson(value);
    expect(json).not.toMatch(/<|\u2028|\u2029/);
    expect(JSON.parse(json)).toEqual(value);
  });
});

describe("injectPayload", () => {
  const payload = (title: string): ExportPayload => ({
    version: 1,
    diagram: { ...diagram(), title },
    icons: {},
    options: { theme: "dark", startSimulation: null, exportedOn: "2026-10-12" },
  });

  it("fills the data block, the page title and the theme, and leaves the script alone", () => {
    const title = 'Orders </script><script>alert("x")</script> & $& $1';
    const html = injectPayload(TEMPLATE, payload(title));
    expect(readBack(html).diagram.title).toBe(title);
    expect(html).toContain(`<title>${escapeHtml(title)}</title>`);
    expect(html).toContain('<html lang="en" data-theme="dark">');
    // One executable script, untouched (its CSP hash stays valid), and nothing that ends the data block early.
    expect(html).toContain("<script>/* the viewer: reads #diagram */</script>");
    expect(html.match(/<\/script>/g)).toHaveLength(3);
    expect(html).not.toContain(PAYLOAD_PLACEHOLDER);
  });

  it("refuses something that isn't a template", () => {
    expect(() => injectPayload("<html></html>", payload("x"))).toThrow(/isn't an interactive viewer template/);
    expect(() => injectPayload(TEMPLATE + PAYLOAD_BLOCK, payload("x"))).toThrow(/exactly one/);
  });
});

describe("icons", () => {
  it("reads the template's stencil → icon map", () => {
    expect(templateStencilIcons(TEMPLATE)).toMatchObject({ "kafka.topic": "kafka", postgres: "postgresql" });
    expect(() => templateStencilIcons("<html>")).toThrow(/no stencil icon map/);
  });

  it("keeps only the icons the diagram shows, sorted, as data URIs", () => {
    const icons = subsetIcons(diagram(), templateStencilIcons(TEMPLATE), SVGS);
    expect(Object.keys(icons)).toEqual(["kafka", "postgresql"]);
    for (const uri of Object.values(icons)) expect(uri).toMatch(/^data:image\/svg\+xml,%3Csvg/);
    // The byte-order mark and surrounding whitespace go; quotes and parentheses are encoded.
    expect(decodeURIComponent(icons.postgresql)).toBe("data:image/svg+xml,<svg><circle r='2'/></svg>");
    expect(icons.postgresql).not.toMatch(/['()]/);
  });

  it("adds the fallback box only for a stencil it can't draw", () => {
    const d = diagram({
      nodes: [
        { id: "x", stencil: "not.in.catalog", label: "X", x: 0, y: 0 },
        { id: "t", stencil: "kafka.topic", label: "T", x: 0, y: 0 },
      ],
    });
    expect(Object.keys(subsetIcons(d, templateStencilIcons(TEMPLATE), SVGS))).toEqual([FALLBACK_ICON, "kafka"]);
    // An icon missing from what was supplied falls back too.
    const { kafka: _kafka, ...noKafka } = SVGS;
    void _kafka;
    expect(Object.keys(subsetIcons(d, templateStencilIcons(TEMPLATE), noKafka))).toEqual([FALLBACK_ICON]);
  });

  it("svgDataUri needs no base64", () => {
    expect(svgDataUri("<svg/>")).toBe("data:image/svg+xml,%3Csvg%2F%3E");
  });
});

describe("buildPayload", () => {
  it("keeps the chosen simulations and only starts one that's kept", () => {
    const base = { diagram: diagram(), iconSvgs: SVGS, theme: "light" as const, exportedOn: "2026-10-12" };
    const p = buildPayload(TEMPLATE, { ...base, simulations: ["b"], startSimulation: "b", banner: "  Internal  " });
    expect(p.diagram.simulations?.map((s) => s.id)).toEqual(["b"]);
    expect(p.options).toEqual({ theme: "light", banner: "Internal", startSimulation: "b", exportedOn: "2026-10-12" });
    expect(buildPayload(TEMPLATE, { ...base, simulations: ["b"], startSimulation: "a" }).options.startSimulation).toBe(
      null,
    );
    expect(buildPayload(TEMPLATE, { ...base, simulations: [] }).diagram.simulations).toEqual([]);
    expect(buildPayload(TEMPLATE, { ...base, title: "  " }).diagram.title).toBe("Orders");
    expect(buildPayload(TEMPLATE, { ...base, title: "Team copy" }).diagram.title).toBe("Team copy");
  });

  it("is deterministic: the same inputs give the same file", () => {
    const input = { diagram: diagram(), iconSvgs: SVGS, theme: "dark" as const, exportedOn: "2026-10-12" };
    expect(exportHtml(TEMPLATE, input)).toBe(exportHtml(TEMPLATE, { ...input, diagram: diagram() }));
  });
});

describe("htmlFileName", () => {
  it("is the title, with what file systems reject taken out", () => {
    expect(htmlFileName("Kafka order pipeline")).toBe("Kafka order pipeline.html");
    expect(htmlFileName('a/b\\c:d*e?"f"<g>|h')).toBe("a b c d e f g h.html");
    expect(htmlFileName("  ..  ")).toBe("diagram.html");
    expect(htmlFileName("x".repeat(300))).toHaveLength(125);
  });
});

describe("viewerCsp", () => {
  it("allows the two inline blocks by hash and no network at all", () => {
    const csp = viewerCsp("SCRIPT=", "STYLE=");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'sha256-SCRIPT='");
    expect(csp).toContain("style-src 'sha256-STYLE='");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).not.toMatch(/unsafe-|worker-src|https?:|'self'/);
  });
});
