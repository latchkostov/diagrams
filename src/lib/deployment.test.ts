import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APPROVED_STUN,
  APPROVED_TRACKERS,
  brandHtml,
  brandName,
  iceServerList,
  trackerList,
  DEFAULT_BRAND,
  localeList,
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
  locales: "",
  languageChoice: true,
  collab: false,
  collabTrackers: [...APPROVED_TRACKERS],
  collabIceServers: APPROVED_STUN.map((urls) => ({ urls })),
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
      expect(readDeployment({ VITE_ENABLE_COLLAB: value })).toEqual({ ...PUBLIC, collab: true });
    }
    for (const value of ["", "0", "false", "no", "off", "2"])
      expect(readDeployment({ VITE_DISABLE_SHARE_LINKS: value, VITE_PRIVATE_BY_DEFAULT: value })).toEqual(PUBLIC);
  });

  it("Edit together is opt-in, and never without share links", () => {
    expect(readDeployment({}).collab).toBe(false);
    expect(readDeployment({ VITE_ENABLE_COLLAB: "0" }).collab).toBe(false);
    expect(readDeployment({ VITE_ENABLE_COLLAB: "1", VITE_DISABLE_SHARE_LINKS: "1" }).collab).toBe(false);
    expect(readDeployment({ ...INTERNAL_DEFAULTS, VITE_ENABLE_COLLAB: "1" }).collab).toBe(false);
  });

  it("a room's trackers: wss:// URLs, deduplicated; unset, the approved two; anything else stops the build", () => {
    expect(trackerList(undefined)).toEqual(APPROVED_TRACKERS);
    expect(trackerList(" ")).toEqual(APPROVED_TRACKERS);
    expect(trackerList("wss://t.example.com, wss://t2.example.com:8443/announce wss://t.example.com")).toEqual([
      "wss://t.example.com",
      "wss://t2.example.com:8443/announce",
    ]);
    expect(trackerList("ws://localhost:8000")).toEqual(["ws://localhost:8000"]);
    for (const bad of ["https://t.example.com", "ws://t.example.com", "wss://t.example.com/a?b", "wss://*.example.com"])
      expect(() => trackerList(bad), bad).toThrow(/VITE_COLLAB_TRACKERS/);
  });

  it("a room's ICE servers: the approved STUN unless named or none; TURN only with its username and credential", () => {
    expect(iceServerList({})).toEqual([{ urls: "stun:stun.cloudflare.com:3478" }]);
    expect(iceServerList({ VITE_COLLAB_STUN: "none" })).toEqual([]);
    expect(iceServerList({ VITE_COLLAB_STUN: "stun:stun.example.com:3478, stuns:stun2.example.com" })).toEqual([
      { urls: "stun:stun.example.com:3478" },
      { urls: "stuns:stun2.example.com" },
    ]);
    expect(
      iceServerList({
        VITE_COLLAB_STUN: "none",
        VITE_COLLAB_TURN: "turn:turn.example.com:3478?transport=udp turns:turn.example.com:5349",
        VITE_COLLAB_TURN_USERNAME: "rooms",
        VITE_COLLAB_TURN_CREDENTIAL: "s3cret",
      }),
    ).toEqual([
      {
        urls: ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:5349"],
        username: "rooms",
        credential: "s3cret",
      },
    ]);
    expect(() => iceServerList({ VITE_COLLAB_STUN: "https://stun.example.com" })).toThrow(/VITE_COLLAB_STUN/);
    expect(() => iceServerList({ VITE_COLLAB_TURN: "turn:turn.example.com" })).toThrow(/USERNAME/);
    expect(() =>
      iceServerList({
        VITE_COLLAB_TURN: "stun:x.example.com",
        VITE_COLLAB_TURN_USERNAME: "u",
        VITE_COLLAB_TURN_CREDENTIAL: "c",
      }),
    ).toThrow(/VITE_COLLAB_TURN takes/);
    expect(() => iceServerList({ VITE_COLLAB_TURN_USERNAME: "u" })).toThrow(/need VITE_COLLAB_TURN/);
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

  it("the languages: tags in order, deduplicated; one language means no choice; a typo stops the build", () => {
    expect(localeList(undefined)).toBe("");
    expect(localeList(" de, en  de ")).toBe("de,en");
    expect(localeList("pt-BR,sr-Latn")).toBe("pt-BR,sr-Latn");
    expect(() => localeList("de,Deutsch")).toThrow(/isn't a language tag/);
    expect(readDeployment({ VITE_LOCALES: "de,en" })).toEqual({ ...PUBLIC, locales: "de,en", languageChoice: true });
    expect(readDeployment({ VITE_LOCALES: "de" })).toEqual({ ...PUBLIC, locales: "de", languageChoice: false });
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
      locales: deployment.LOCALES,
      languageChoice: deployment.LANGUAGE_CHOICE,
      collab: deployment.COLLAB,
      // Not in src/lib/deployment.ts: only the room's own code reads them (src/collab/room/endpoints.ts).
      collabTrackers: PUBLIC.collabTrackers,
      collabIceServers: PUBLIC.collabIceServers,
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
    // Agents' turns keep Undo this change, Revert to here and their stencil choices: that's history, not inference.
    expect(gates.canUseAiHistory({})).toBe(true);
    expect(gates.canUseAiHistory({ private: true, onDevice: true })).toBe(true);
    expect(gates.canUseAiHistory({ private: true })).toBe(false);
    expect(gates.canUseAiHistory({ localOnly: true })).toBe(false);
  });

  it("the AI panel's history follows privacy alone, under every switch", async () => {
    for (const overrides of [{}, { AI_TOOLS: false }, { ON_DEVICE: false }, { AI_TOOLS: false, ON_DEVICE: false }]) {
      const { gates } = await withDeployment(overrides);
      expect(gates.canUseAiHistory({}), JSON.stringify(overrides)).toBe(true);
      expect(gates.canUseAiHistory({ private: true }), JSON.stringify(overrides)).toBe(false);
    }
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
