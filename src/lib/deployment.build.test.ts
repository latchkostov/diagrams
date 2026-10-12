import { resolve } from "node:path";
import { build, type Rollup } from "vite";
import { beforeAll, describe, expect, it } from "vitest";
import { INTERNAL_DEFAULTS } from "../../scripts/deployment-env";

// The self-hosting switches (src/lib/deployment.ts) remove code, not just menu rows: real builds of the app with
// and without them. A copy built without share links carries no code that makes a link (the dialogs, the
// encryption, the agents' get_share_link); one without AI tools carries no WebMCP and no Copy for AI; one without
// the on-device model carries no request box for it. The public build keeps all of it (so the checks can fail).

interface Output {
  code: string;
  modules: string[];
  html: string;
  files: string[];
}

async function buildWith(env: Record<string, string>): Promise<Output> {
  // A production build, as `pnpm build` makes it (Vitest runs with NODE_ENV=test, which Vite reads as development).
  const saved = { ...process.env };
  Object.assign(process.env, { NODE_ENV: "production", ...env });
  let result: Awaited<ReturnType<typeof build>>;
  try {
    result = await build({ configFile: resolve("vite.config.ts"), logLevel: "silent", build: { write: false } });
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) Reflect.deleteProperty(process.env, key);
    Object.assign(process.env, saved);
  }
  const output = (Array.isArray(result) ? result : [result]).flatMap((r) => (r as Rollup.RolldownOutput).output);
  const chunks = output.filter((o): o is Rollup.OutputChunk => o.type === "chunk");
  const page = output.find((o): o is Rollup.OutputAsset => o.type === "asset" && o.fileName === "index.html");
  return {
    code: chunks.map((c) => c.code).join("\n"),
    modules: chunks.flatMap((c) =>
      Object.entries(c.modules)
        .filter(([, m]) => m.renderedLength > 0)
        .map(([id]) => id.replaceAll("\\", "/")),
    ),
    html: String(page?.source ?? ""),
    files: output.map((o) => o.fileName),
  };
}

/** Code that makes a link: what a build without share links must not carry. */
const LINK_MAKING = {
  strings: [
    "Share link copied", // Copy share link, and the Share link dialog
    "Link with password copied", // Copy link with password…
    "Embed code copied", // Embed code…
    "export-share-link", // the File menu's rows
    "export-embed",
    "export:share", // the canvas right-click's (and so the palette's) commands
    "Try four or more random words", // the password's strength hint
  ],
  modules: [] as RegExp[],
  /** WebCrypto's encrypt (opening a password link only decrypts). */
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
/** The on-device model's request box. (The Lab's model evals, a development page, keep their own copy.) */
const ON_DEVICE = {
  strings: [] as string[],
  modules: [/\/ai\/ondevice\/OnDeviceInput\.tsx$/],
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

beforeAll(async () => {
  publicBuild = await buildWith({});
  internal = await buildWith({ ...INTERNAL_DEFAULTS, VITE_BRAND_NAME: "Acme Diagrams (internal)" } as Record<
    string,
    string
  >);
  locked = await buildWith({
    VITE_DISABLE_SHARE_LINKS: "1",
    VITE_DISABLE_LINK_OPEN: "1",
    VITE_DISABLE_AI_TOOLS: "1",
    VITE_DISABLE_ONDEVICE: "1",
  });
}, 240_000);

describe("self-hosting switches in the production build", () => {
  it("the public build carries links, AI tools and the on-device model", () => {
    expect(found(publicBuild, LINK_MAKING).sort()).toEqual(all(LINK_MAKING));
    expect(found(publicBuild, AI_TOOLING).sort()).toEqual(all(AI_TOOLING));
    expect(found(publicBuild, ON_DEVICE).sort()).toEqual(all(ON_DEVICE));
    expect(publicBuild.html).toContain("<title>Live Diagrams</title>");
  });

  it("without share links, no code that makes a link ships; opening one still does", () => {
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
