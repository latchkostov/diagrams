import { beforeAll, describe, expect, it } from "vitest";
import { INTERNAL_DEFAULTS } from "../../scripts/deployment-env";
import { productionBuild, startupChunks } from "../test/productionBuild";

// The self-hosting switches (src/lib/deployment.ts) remove code, not just menu rows: real builds of the app with
// and without them. A copy built without share links carries no code that makes a link (the dialogs, the
// encryption's dialog, the agents' get_share_link); one without AI tools carries no WebMCP and no Copy for AI; one
// without the on-device model carries no request box for it. The public build keeps all of it (so the checks can
// fail). A password-protected Interactive HTML file is a file, not a link: every build makes one, so the encryption
// and the password field's strength hint stay in all of them. Edit together is opt-in (VITE_ENABLE_COLLAB): without
// it no room code ships, and with it a copy's own trackers, STUN and TURN replace the approved ones.

interface Output {
  code: string;
  catalogCode: string;
  modules: string[];
  html: string;
  files: string[];
  /** The startup JavaScript: the entry and what it imports statically. */
  startup: string;
  headers: string;
}

/** A production build with exactly these deployment variables (src/test/productionBuild.ts). */
async function buildWith(env: Record<string, string>): Promise<Output> {
  const { chunks, assets, html } = await productionBuild(env);
  const catalog = (c: (typeof chunks)[number]) =>
    Object.keys(c.modules).some((id) => id.startsWith("\0virtual:i18n/catalog/"));
  return {
    // Locale dictionaries use English lookup keys even for features absent from this copy. Check executable
    // feature chunks separately: those lookup keys do not contain the feature's implementation.
    code: chunks
      .filter((c) => !catalog(c))
      .map((c) => c.code)
      .join("\n"),
    catalogCode: chunks
      .filter(catalog)
      .map((c) => c.code)
      .join("\n"),
    modules: chunks.flatMap((c) =>
      Object.entries(c.modules)
        .filter(([, m]) => m.renderedLength > 0)
        .map(([id]) => id.replaceAll("\\", "/")),
    ),
    html,
    files: [...chunks, ...assets].map((o) => o.fileName),
    startup: startupChunks({ chunks, assets, html })
      .map((c) => c.code)
      .join("\n"),
    headers: String(assets.find((asset) => asset.fileName === "headers.json")?.source ?? ""),
  };
}

/** Code that makes a link: what a build without share links must not carry. */
const LINK_MAKING = {
  strings: [
    "Share link copied", // Copy share link, and the Share link dialog
    "Link with password copied", // Link with password…
    "In the link", // Embed code's source that puts the diagram in its URL (the private one stays)
    "share-option-password", // Share…'s Link with password…
    "share-option-embed-public", // Share…'s public section: Embed on a public page…
    "share-public-toggle", // …and the step that opens it
  ],
  modules: [] as RegExp[],
  code: [] as RegExp[],
};
/** Interactive HTML's Require a password: a file, so in every build (its field and hint are the password link's). */
const FILE_PASSWORD = {
  strings: ["Require a password", "Try four or more random words", "Diagram (password protected)"],
  modules: [] as RegExp[],
  /** WebCrypto's encrypt. */
  code: [/\.encrypt\(/],
};
/** AI that reads the diagram outside the app: what a build without AI tools must not carry. */
const AI_TOOLING = {
  strings: ["Copy prompt", "Build with AI", "item.copy-for-ai", "registerTool"],
  // Lazy chunks of their own: gone whole. (Code imported statically is checked by its strings: a module the
  // minifier emptied still lists its length from before minifying.)
  modules: [/\/ai\/webmcp\/(WebMcpBridge\.tsx|useWebMcp\.ts|adapter\.ts|tools\.ts)$/, /\/ai\/ui\/copyForAi\.ts$/],
  code: [] as RegExp[],
};
/** The on-device model: the AI panel's request box. (The Lab's evals that run it are in dev and e2e builds only.) */
const ON_DEVICE = {
  strings: [] as string[],
  modules: [/\/ai\/ondevice\/OnDeviceInput\.tsx$/, /\/ai\/ondevice\/(session|pipeline)\.ts$/],
  code: [] as RegExp[],
};

function found(out: Output, what: { strings: string[]; modules: RegExp[]; code: RegExp[] }): string[] {
  return [
    ...what.strings.filter((s) => out.code.includes(s)),
    ...what.modules.filter((re) => out.modules.some((id) => re.test(id))).map(String),
    ...what.code.filter((re) => re.test(out.code)).map(String),
  ];
}
const all = (what: { strings: string[]; modules: RegExp[]; code: RegExp[] }) =>
  [...what.strings, ...what.modules.map(String), ...what.code.map(String)].sort();

let publicBuild: Output;
let internal: Output;
let locked: Output;
/** Edit together on, with a self-hosted copy's own endpoints (collaboration plan Q9). */
let ownRooms: Output;

/** A room's code: the room module, the session and Yjs. */
const ROOM_CODE = [/\/src\/collab\//, /\/node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?yjs\//];
const roomModules = (out: Output) => ROOM_CODE.filter((re) => out.modules.some((id) => re.test(id))).map(String);
const OWN = {
  VITE_ENABLE_COLLAB: "1",
  VITE_COLLAB_TRACKERS: "wss://tracker.intranet.example/announce",
  VITE_COLLAB_STUN: "stun:stun.intranet.example:3478",
  VITE_COLLAB_TURN: "turns:turn.intranet.example:5349",
  VITE_COLLAB_TURN_USERNAME: "rooms",
  VITE_COLLAB_TURN_CREDENTIAL: "intranet-only",
};
/** What a build must never carry outside a room's code: the copy's endpoints and the TURN credential. */
const OWN_VALUES = ["tracker.intranet.example", "stun.intranet.example", "turn.intranet.example", "intranet-only"];

/** What a developer's shell or CI might have set: the fixtures must not see it. */
const AMBIENT = { VITE_BRAND_NAME: "Ambient Brand", VITE_DISABLE_SHARE_LINKS: "1", VITE_DISABLE_ONDEVICE: "1" };

beforeAll(async () => {
  const saved = { ...process.env };
  Object.assign(process.env, AMBIENT);
  try {
    publicBuild = await buildWith({});
    // Internal copies can use relay rooms independently of share links.
    internal = await buildWith({
      ...INTERNAL_DEFAULTS,
      VITE_COLLAB: "server",
      VITE_COLLAB_SERVER: "wss://relay.intranet.example/tools/collab/v1",
      VITE_BRAND_NAME: "Acme Diagrams (internal)",
    } as Record<string, string>);
    locked = await buildWith({
      VITE_DISABLE_SHARE_LINKS: "1",
      VITE_DISABLE_LINK_OPEN: "1",
      VITE_DISABLE_AI_TOOLS: "1",
      VITE_DISABLE_ONDEVICE: "1",
    });
    ownRooms = await buildWith(OWN);
  } finally {
    for (const key of Object.keys(AMBIENT)) if (!(key in saved)) Reflect.deleteProperty(process.env, key);
    Object.assign(process.env, saved);
  }
}, 360_000);

describe("self-hosting switches in the production build", () => {
  it("build fixtures ignore ambient deployment settings (the shell's, .env files)", () => {
    // Built while AMBIENT was set: the public fixture is still the public site.
    expect(publicBuild.html).toContain("<title>Live Diagrams</title>");
    expect(publicBuild.code.includes("Ambient Brand")).toBe(false);
    expect(found(publicBuild, LINK_MAKING)).toHaveLength(all(LINK_MAKING).length);
    expect(found(publicBuild, ON_DEVICE)).toHaveLength(all(ON_DEVICE).length);
  });

  it("the public build carries links, AI tools and the on-device model", () => {
    expect(found(publicBuild, LINK_MAKING).sort()).toEqual(all(LINK_MAKING));
    expect(found(publicBuild, AI_TOOLING).sort()).toEqual(all(AI_TOOLING));
    expect(found(publicBuild, ON_DEVICE).sort()).toEqual(all(ON_DEVICE));
    expect(publicBuild.html).toContain("<title>Live Diagrams</title>");
  });

  it("without share links, no code that makes a link ships; opening one still does", () => {
    expect(internal.catalogCode).toContain("Share link copied");
    expect(found(internal, LINK_MAKING)).toEqual([]);
    expect(internal.code.includes("Opening the shared diagram")).toBe(true);
    expect(internal.modules.some((id) => id.endsWith("/interop/shareCrypto.ts"))).toBe(true);
  });

  it("without AI tools, no WebMCP, Copy for AI or copied prompts ship; the on-device model stays", () => {
    expect(found(internal, AI_TOOLING)).toEqual([]);
    expect(found(internal, ON_DEVICE).sort()).toEqual(all(ON_DEVICE));
    // Not even an unused file of them: the bundler's leftovers for dropped imports are removed.
    expect(internal.files.filter((f) => /WebMcpBridge|copyForAi/.test(f))).toEqual([]);
  });

  it("every build exports password-protected Interactive HTML (a file, not a link)", () => {
    for (const out of [publicBuild, internal, locked])
      expect(found(out, FILE_PASSWORD).sort()).toEqual(all(FILE_PASSWORD));
  });

  it("names the page and the top bar after VITE_BRAND_NAME", () => {
    expect(internal.html).toContain("<title>Acme Diagrams (internal)</title>");
    expect(internal.html).not.toContain("<title>Live Diagrams</title>");
    expect(internal.code.includes("Acme Diagrams (internal)")).toBe(true);
  });

  it("with everything off, no AI panel, no on-device model and no link opening", () => {
    expect(found(locked, LINK_MAKING)).toEqual([]);
    expect(found(locked, AI_TOOLING)).toEqual([]);
    expect(found(locked, ON_DEVICE)).toEqual([]);
    // No rail and no panel (their test ids), and no file of the panel's either.
    expect(locked.code.includes("ai-rail-badge")).toBe(false);
    expect(locked.code.includes("What AI agents changed in this diagram")).toBe(false);
    expect(locked.files.filter((f) => /AiPanel/.test(f))).toEqual([]);
    expect(publicBuild.code.includes("ai-rail-badge")).toBe(true);
    expect(publicBuild.files.filter((f) => /AiPanel-[^/]*\.(js|css)$/.test(f))).toHaveLength(2);
    expect(locked.code.includes("Opening shared links is turned off here")).toBe(true);
  });
});

describe("Edit together in the production build", () => {
  it("off by default: no room code, no Yjs, no endpoints", () => {
    for (const out of [publicBuild, locked]) {
      expect(roomModules(out)).toEqual([]);
      expect(out.code).not.toMatch(/tracker\.(?:openwebtorrent\.com|webtorrent\.dev)|stun\.cloudflare\.com/);
    }
  });

  it("server rooms work without share links and carry no WebRTC or STUN", () => {
    expect(roomModules(internal)).toEqual(ROOM_CODE.map(String));
    expect(internal.code).toContain("livediagrams.relay.v1");
    expect(internal.code).toContain("wss://relay.intranet.example/tools/collab/v1");
    expect(internal.startup).not.toContain("relay.intranet.example");
    expect(internal.headers).toContain("connect-src 'self' wss://relay.intranet.example;");
    expect(internal.code.match(/.{0,40}(?:RTCPeerConnection|stuns?:|stun\.cloudflare\.com).{0,80}/g) ?? []).toEqual([]);
    expect(internal.modules.some((id) => id.endsWith("/collab/transport/tracker.ts"))).toBe(false);
    expect(internal.startup).not.toContain("livediagrams.relay.v1");
    for (const value of OWN_VALUES) expect(internal.code, value).not.toContain(value);
  });

  it("on, with a copy's own trackers, STUN and TURN instead of the approved ones", () => {
    expect(roomModules(ownRooms)).toEqual(ROOM_CODE.map(String));
    for (const value of ["wss://tracker.intranet.example/announce", "stun:stun.intranet.example:3478"])
      expect(ownRooms.code, value).toContain(value);
    expect(ownRooms.code).toContain("turns:turn.intranet.example:5349");
    expect(ownRooms.code).toContain("intranet-only");
    // Only in the room's own code: not at startup (the import.meta.env object startup modules read included).
    for (const value of OWN_VALUES) expect(ownRooms.startup, value).not.toContain(value);
    expect(ownRooms.code).not.toMatch(/tracker\.(?:openwebtorrent\.com|webtorrent\.dev)|stun\.cloudflare\.com/);
  });
});
