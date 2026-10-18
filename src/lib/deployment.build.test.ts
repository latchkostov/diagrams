import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build, type Rollup } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEPLOYMENT_VARIABLES, INTERNAL_DEFAULTS } from "../../scripts/deployment-env";

// The self-hosting switches (src/lib/deployment.ts) remove code, not just menu rows: real builds of the app with
// and without them. A copy built without share links carries no code that makes a link (the dialogs, the
// encryption's dialog, the agents' get_share_link); one without AI tools carries no WebMCP and no Copy for AI; one
// without the on-device model carries no request box for it. The public build keeps all of it (so the checks can
// fail). A password-protected Interactive HTML file is a file, not a link: every build makes one, so the encryption
// and the password field's strength hint stay in all of them.

interface Output {
  code: string;
  catalogCode: string;
  modules: string[];
  html: string;
  files: string[];
}

/** No .env files: a fixture is exactly its variables, whatever the checkout's .env.local says. */
let noEnvFiles: string;
afterAll(() => rmSync(noEnvFiles, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

async function buildWith(env: Record<string, string>): Promise<Output> {
  // A production build, as `pnpm build` makes it (Vitest runs with NODE_ENV=test, which Vite reads as development),
  // with exactly the fixture's deployment variables: none from the shell (a developer's or CI's) or a .env file.
  const saved = { ...process.env };
  for (const key of DEPLOYMENT_VARIABLES) Reflect.deleteProperty(process.env, key);
  Object.assign(process.env, { NODE_ENV: "production", ...env });
  let result: Awaited<ReturnType<typeof build>>;
  try {
    result = await build({
      configFile: resolve("vite.config.ts"),
      envDir: noEnvFiles,
      logLevel: "silent",
      build: { write: false },
    });
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) Reflect.deleteProperty(process.env, key);
    Object.assign(process.env, saved);
  }
  const output = (Array.isArray(result) ? result : [result]).flatMap((r) => (r as Rollup.RolldownOutput).output);
  const chunks = output.filter((o): o is Rollup.OutputChunk => o.type === "chunk");
  const page = output.find((o): o is Rollup.OutputAsset => o.type === "asset" && o.fileName === "index.html");
  return {
    // Locale dictionaries use English lookup keys even for features absent from this copy. Check executable
    // feature chunks separately: those lookup keys do not contain the feature's implementation.
    code: chunks
      .filter((c) => !Object.keys(c.modules).some((id) => id.startsWith("\0virtual:i18n/catalog/")))
      .map((c) => c.code)
      .join("\n"),
    catalogCode: chunks
      .filter((c) => Object.keys(c.modules).some((id) => id.startsWith("\0virtual:i18n/catalog/")))
      .map((c) => c.code)
      .join("\n"),
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

/** What a developer's shell or CI might have set: the fixtures must not see it. */
const AMBIENT = { VITE_BRAND_NAME: "Ambient Brand", VITE_DISABLE_SHARE_LINKS: "1", VITE_DISABLE_ONDEVICE: "1" };

beforeAll(async () => {
  noEnvFiles = mkdtempSync(join(tmpdir(), "deployment-build-"));
  const saved = { ...process.env };
  Object.assign(process.env, AMBIENT);
  try {
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
  } finally {
    for (const key of Object.keys(AMBIENT)) if (!(key in saved)) Reflect.deleteProperty(process.env, key);
    Object.assign(process.env, saved);
  }
}, 240_000);

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
