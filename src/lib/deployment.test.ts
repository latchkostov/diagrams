import { afterEach, describe, expect, it, vi } from "vitest";
import {
  brandHtml,
  brandName,
  DEFAULT_BRAND,
  DEPLOYMENT_KEYS,
  deploymentDefines,
  INTERNAL_DEFAULTS,
  readDeployment,
  unreachableFiles,
  type Deployment,
} from "../../scripts/deployment-env";
import * as deployment from "./deployment";

// The self-hosting switches (docs/SELF-HOSTING.md): how the build reads them (scripts/deployment-env.ts), what
// src/lib/deployment.ts exports in this (public) build, and how every gate behaves under each switch. The gates
// are re-imported with ./deployment mocked, as a build with that switch would fold it.

const PUBLIC: Deployment = {
  shareLinks: true,
  linkOpen: true,
  aiTools: true,
  onDevice: true,
  aiPanel: true,
  privateByDefault: false,
  brandName: DEFAULT_BRAND,
};

describe("reading the switches", () => {
  it("no variables: the public site", () => {
    expect(readDeployment({})).toEqual(PUBLIC);
  });

  it("each switch turns one thing off (or Private on), with 1, true, yes or on", () => {
    for (const value of ["1", "true", "TRUE", " yes ", "on"]) {
      expect(readDeployment({ VITE_DISABLE_SHARE_LINKS: value })).toEqual({ ...PUBLIC, shareLinks: false });
      expect(readDeployment({ VITE_DISABLE_LINK_OPEN: value })).toEqual({ ...PUBLIC, linkOpen: false });
      expect(readDeployment({ VITE_DISABLE_AI_TOOLS: value })).toEqual({ ...PUBLIC, aiTools: false });
      expect(readDeployment({ VITE_DISABLE_ONDEVICE: value })).toEqual({ ...PUBLIC, onDevice: false });
      expect(readDeployment({ VITE_PRIVATE_BY_DEFAULT: value })).toEqual({ ...PUBLIC, privateByDefault: true });
    }
    for (const value of ["", "0", "false", "no", "off", "2"])
      expect(readDeployment({ VITE_DISABLE_SHARE_LINKS: value, VITE_PRIVATE_BY_DEFAULT: value })).toEqual(PUBLIC);
  });

  it("the AI panel goes only when both AI tools and the on-device model are off", () => {
    expect(readDeployment({ VITE_DISABLE_AI_TOOLS: "1" }).aiPanel).toBe(true);
    expect(readDeployment({ VITE_DISABLE_ONDEVICE: "1" }).aiPanel).toBe(true);
    expect(readDeployment({ VITE_DISABLE_AI_TOOLS: "1", VITE_DISABLE_ONDEVICE: "1" }).aiPanel).toBe(false);
  });

  it("pnpm build:internal's defaults: no links made, no AI tools, new diagrams Private; links still open", () => {
    expect(readDeployment(INTERNAL_DEFAULTS)).toEqual({
      ...PUBLIC,
      shareLinks: false,
      aiTools: false,
      privateByDefault: true,
    });
  });

  it("the brand name: one line, trimmed, at most 60 characters, else the default", () => {
    expect(brandName(undefined)).toBe("Live Diagrams");
    expect(brandName("   ")).toBe("Live Diagrams");
    expect(brandName("  Acme   Diagrams\n(internal) ")).toBe("Acme Diagrams (internal)");
    expect(brandName("x".repeat(80))).toHaveLength(60);
  });

  it("defines every constant as a literal, so the bundler can fold it", () => {
    const defines = deploymentDefines({ VITE_DISABLE_AI_TOOLS: "1", VITE_BRAND_NAME: 'Acme "R&D"' });
    expect(Object.keys(defines).sort()).toEqual(Object.values(DEPLOYMENT_KEYS).sort());
    expect(defines.__DEPLOYMENT_SHARE_LINKS__).toBe("true");
    expect(defines.__DEPLOYMENT_AI_TOOLS__).toBe("false");
    expect(defines.__DEPLOYMENT_BRAND_NAME__).toBe(JSON.stringify('Acme "R&D"'));
    for (const value of Object.values(defines)) expect(() => JSON.parse(value)).not.toThrow();
  });
});

describe("this build (no switches set)", () => {
  it("is the public site", () => {
    expect({
      shareLinks: deployment.SHARE_LINKS,
      linkOpen: deployment.LINK_OPEN,
      aiTools: deployment.AI_TOOLS,
      onDevice: deployment.ON_DEVICE,
      aiPanel: deployment.AI_PANEL,
      privateByDefault: deployment.PRIVATE_BY_DEFAULT,
      brandName: deployment.BRAND_NAME,
    }).toEqual(PUBLIC);
  });
});

describe("the brand name in index.html", () => {
  const html = [
    "<title>Live Diagrams</title>",
    '<meta property="og:site_name" content="Live Diagrams" />',
    '<meta property="og:title" content="Live Diagrams" />',
    '<meta name="twitter:title" content="Live Diagrams" />',
    '<h1><img src="./favicon.svg" alt="" width="24" height="24" />Live Diagrams</h1>',
    "<noscript><p>Live Diagrams needs JavaScript to run.</p></noscript>",
  ].join("\n");

  it("names the page, its previews and the start-up page, escaped", () => {
    const out = brandHtml(html, 'Acme <R&D> "$1" $&');
    expect(out).not.toContain("Live Diagrams");
    expect(out).toContain("<title>Acme &lt;R&amp;D&gt; &quot;$1&quot; $&amp;</title>");
    expect(out.match(/Acme &lt;R&amp;D&gt;/g)).toHaveLength(6);
  });

  it("leaves the page alone with the default name", () => {
    expect(brandHtml(html, DEFAULT_BRAND)).toBe(html);
  });

  it("matches the real index.html", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("index.html", "utf8");
    const out = brandHtml(page, "Acme Diagrams");
    expect(out).toContain("<title>Acme Diagrams</title>");
    expect(out.match(/content="Acme Diagrams"/g)).toHaveLength(3);
    expect(out).toMatch(/<h1><img [^>]*\/>Acme Diagrams<\/h1>/);
  });
});

describe("unreachable files", () => {
  const chunk = (code: string, isEntry = false) => ({ type: "chunk" as const, code, isEntry });
  const asset = (source: string) => ({ type: "asset" as const, source });
  it("drops the scripts and stylesheets nothing names, and keeps everything something does", () => {
    const bundle = {
      "index.html": asset('<script src="./assets/index-a.js"></script><link href="./assets/index-a.css">'),
      "assets/index-a.js": chunk('import("./lazy-b.js");import"./shared-c.js"', true),
      "assets/index-a.css": asset(""),
      "assets/lazy-b.js": chunk('import"./shared-c.js";const m=["./deep-d.js","./lazy-b.css"]'),
      "assets/lazy-b.css": asset(""),
      "assets/shared-c.js": chunk(""),
      "assets/deep-d.js": chunk(""),
      "assets/icon-x.svg": asset(""),
      // What the bundler split out for an import() it then dropped: only an orphan names its own dependencies.
      "assets/WebMcpBridge-e.js": chunk('import"./tools-f.js";const m=["./WebMcpBridge-e.css"]'),
      "assets/WebMcpBridge-e.css": asset(""),
      "assets/tools-f.js": chunk(""),
    };
    expect(unreachableFiles(bundle).sort()).toEqual([
      "assets/WebMcpBridge-e.css",
      "assets/WebMcpBridge-e.js",
      "assets/tools-f.js",
    ]);
  });
});

describe("the gates under each switch", () => {
  afterEach(() => {
    vi.doUnmock("./deployment");
    vi.resetModules();
  });

  /** The gates (and what reads them) as a build with these switches would have them. */
  async function withDeployment(overrides: Partial<typeof deployment>) {
    vi.resetModules();
    vi.doMock("./deployment", async (importOriginal) => ({
      ...(await importOriginal<typeof deployment>()),
      ...overrides,
    }));
    return {
      gates: await import("./localOnly"),
      tools: await import("../ai/webmcp/toolList"),
    };
  }

  it("public: every gate open for a public diagram, closed for a private one", async () => {
    const { gates, tools } = await withDeployment({});
    expect(gates.canShareAsLink({})).toBe(true);
    expect(gates.canUseAiTools({})).toBe(true);
    expect(gates.canUseOnDevice({})).toBe(true);
    expect(gates.canSaveToCloud({})).toBe(true);
    expect(gates.canShareAsLink({ private: true })).toBe(false);
    expect(gates.canUseAiTools({ private: true })).toBe(false);
    expect(tools.EDIT_TOOLS).toContain("get_share_link");
    expect(tools.LIVE_TOOLS).toContain("get_share_link");
  });

  it("VITE_DISABLE_SHARE_LINKS: no link for any diagram, and no get_share_link for agents", async () => {
    const { gates, tools } = await withDeployment({ SHARE_LINKS: false });
    for (const state of [null, {}, { private: false }, { private: true }])
      expect(gates.canShareAsLink(state)).toBe(false);
    expect(gates.canUseAiTools({})).toBe(true);
    expect(gates.canSaveToCloud({})).toBe(true);
    expect(tools.EDIT_TOOLS).not.toContain("get_share_link");
    expect(tools.LIVE_TOOLS).toEqual(["describe_diagram", "check_diagram"]);
    expect(tools.publishedTools(false)).toHaveLength(6);
  });

  it("VITE_DISABLE_AI_TOOLS: no AI tools for any diagram; the on-device model stays", async () => {
    const { gates } = await withDeployment({ AI_TOOLS: false });
    for (const state of [null, {}, { private: true }]) expect(gates.canUseAiTools(state)).toBe(false);
    expect(gates.canUseOnDevice({})).toBe(true);
    expect(gates.canUseOnDevice({ private: true, onDevice: true })).toBe(true);
    expect(gates.canShareAsLink({})).toBe(true);
  });

  it("VITE_DISABLE_ONDEVICE: the on-device model is off for every diagram, even one that allowed it", async () => {
    const { gates } = await withDeployment({ ON_DEVICE: false });
    expect(gates.canUseOnDevice({})).toBe(false);
    expect(gates.canUseOnDevice({ private: true, onDevice: true })).toBe(false);
    expect(gates.canUseAiTools({})).toBe(true);
  });

  it("VITE_PRIVATE_BY_DEFAULT: New diagrams are private starts on, and turning it off is remembered", async () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    });
    try {
      const key = "diagrams.newDiagramsPrivate.v1";
      vi.resetModules();
      vi.doMock("./deployment", async (importOriginal) => ({
        ...(await importOriginal<typeof deployment>()),
        PRIVATE_BY_DEFAULT: true,
      }));
      let { newDiagramsPrivate } = await import("./privacyPrefs");
      expect(newDiagramsPrivate.get()).toBe(true);
      expect(data.has(key)).toBe(false);
      newDiagramsPrivate.set(false);
      expect(data.get(key)).toBe("0");
      // A reload keeps the person's choice.
      vi.resetModules();
      ({ newDiagramsPrivate } = await import("./privacyPrefs"));
      expect(newDiagramsPrivate.get()).toBe(false);
      newDiagramsPrivate.set(true);
      expect(data.has(key)).toBe(false);
      // The public default is untouched: off, and only "on" is stored.
      vi.doUnmock("./deployment");
      vi.resetModules();
      data.clear();
      ({ newDiagramsPrivate } = await import("./privacyPrefs"));
      expect(newDiagramsPrivate.get()).toBe(false);
      newDiagramsPrivate.set(true);
      expect(data.get(key)).toBe("1");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
