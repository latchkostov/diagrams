import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build, normalizePath, type Plugin, type PluginOption, type Rollup, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { catalog } from "../src/stencils/catalog";
import { PAYLOAD_BLOCK, STENCIL_ICONS_OPEN, viewerCsp } from "../src/export/inject";
import { deploymentDefines } from "./deployment-env";
import { i18n } from "./i18n-plugin";

/**
 * The Interactive HTML export's template (File ▸ Export as ▸ Interactive HTML…, docs/INTEROP.md): the viewer
 * (src/export/viewerEntry.tsx) built on its own into ONE self-contained HTML page, its script and styles
 * inline, the fonts as data URIs, and a placeholder for the diagram that src/export/inject.ts fills.
 *
 *  - Its own Vite build (an IIFE, no code splitting), so nothing of it lands in the app's chunks, and the app
 *    never loads it until someone exports: the build emits it as `export/interactive-viewer-<hash>.html`, and
 *    the app reads that name from `virtual:interactive-viewer` and fetches it same-origin. The name changes with
 *    its content, so a cached copy is never stale.
 *  - Deterministic: the same sources give the same bytes (no dates, no build ids, no environment variables),
 *    so a copy kept elsewhere (the agent skill's offline export) can be checked against a fresh build.
 *  - The page's CSP allows exactly its one inline script and one inline style, by sha256.
 *  - No module worker (file:// can't load one) and no blob: worker either (a host's CSP may forbid it): the
 *    live particles draw on the main thread, the renderer's fallback. The worker's `new Worker(…)` is cut out
 *    of the build, so no worker file is emitted or referenced.
 *  - Icons: the app's 175 icon files are left out; the viewer's iconUrls reads the few the file carries.
 *  - Fonts: Mona Sans and Geist Mono, Latin only (what the app's text needs; other scripts fall back to the
 *    system's fonts), inlined: font-src data:.
 */

export const VIEWER_ENTRY = "src/export/viewerEntry.tsx";
const VIRTUAL = "virtual:interactive-viewer";
const RESOLVED = "\0" + VIRTUAL;
/** Where the template lives in the dev server (the build hashes the name). */
const DEV_PATH = "export/interactive-viewer.html";

export const FONTS: { family: string; file: string }[] = [
  {
    family: "Mona Sans Variable",
    file: "node_modules/@fontsource-variable/mona-sans/files/mona-sans-latin-wght-normal.woff2",
  },
  {
    family: "Geist Mono Variable",
    file: "node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2",
  },
];
/** Fontsource's "latin" unicode-range. */
export const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";

/** Modules that must never be in the exported file: they reach the network, AI, or the app's storage. */
const FORBIDDEN: [string, RegExp][] = [
  ["the stencil icon files", /[/\\]src[/\\]stencils[/\\]icons[/\\]/],
  ["the particle worker", /[/\\]src[/\\]live[/\\]particleWorker\.ts$/],
  ["the AI panel and agent tools", /[/\\]src[/\\]ai[/\\](ui[/\\]AiPanel|webmcp|ondevice)/],
  ["cloud storage", /[/\\]src[/\\]interop[/\\](storage|gdrive)[/\\]/],
  // Making or opening links. The password crypto itself (passwordCrypto.ts, encryptedToken.ts) is in: a
  // password-protected file decrypts with it (src/export/lock.ts).
  ["share links", /[/\\]src[/\\]interop[/\\](share|shareCrypto|passwordLink)\.ts$/],
  ["the example diagrams", /[/\\]src[/\\]examples[/\\][^/\\]+\.json$/],
  ["local-only examples", /[/\\]examples[/\\]private[/\\]|[/\\]localOnly\.dev\.ts$/],
  // Architecture checks are for editing: the engine, the Checks card and the checks worker never ship in a file.
  ["the architecture checks", /[/\\]src[/\\]checks[/\\]/],
  ["the checks markers", /[/\\]src[/\\]canvas[/\\]checks[/\\]ChecksMarkers\.tsx$/],
  // Message-type analysis serves the inspector, Checks and the app's edge reader; a file carries none of them.
  ["the message-type analysis", /[/\\]src[/\\](model[/\\]messageTypes|canvas[/\\]edges[/\\]carriedTypes)\.ts$/],
];

/**
 * Editing-only panels the read-only canvas never shows (CanvasView renders them only with its editing chrome,
 * LiveSession's simulation editor only with an editor), each swapped for a stub with the same exports. A single
 * bundle would otherwise carry all of them (about 150 kB). A new export one of them gains fails the build
 * ("missing export"), and the module itself coming back fails it too (FORBIDDEN, below).
 */
export const EDITOR_ONLY: { name: string; path: string; stub: (root: string) => string }[] = [
  // Read-only canvases never open editing menus or quick-add. In particular, saved-route
  // rendering must not carry the actions that author and reset those routes.
  {
    name: "the editing action catalog",
    path: "/src/editor/builtinActions.ts",
    stub: () => "export const builtinActions = () => []; export const quickAddMenu = () => [];",
  },
  { name: "the inspector", path: "/src/canvas/Inspector.tsx", stub: () => "export const Inspector = () => null;" },
  {
    name: "the docked node Live readout",
    path: "/src/planning/LiveDetails.tsx",
    stub: () => "export const LiveDetails = () => null; export const LiveOutcomes = () => null;",
  },
  {
    name: "the docked connection Live readout",
    path: "/src/planning/EdgeLiveDetails.tsx",
    stub: () => "export const EdgeLiveDetails = () => null;",
  },
  {
    name: "the stencil rail",
    path: "/src/canvas/Palette.tsx",
    stub: (root) =>
      `export const Palette = () => null;\nexport { STENCIL_DND_MIME } from ${JSON.stringify(
        resolve(root, "src/lib/canvasBridge.ts").replaceAll("\\", "/"),
      )};`,
  },
  // Carried types on hovered and focused flow edges: the app shows them; a file stays within the skill's download
  // budget (src/ai/skill/skill.test.ts) without the message-type analysis they need.
  {
    name: "the carried-types reader",
    path: "/src/canvas/edges/EdgeMessages.tsx",
    stub: () => "export const EdgeMessages = () => null;",
  },
  // A read-only canvas never moves an edge's end: no reconnect handles, so none of their pointer gesture either.
  {
    name: "the reconnect handles",
    path: "/src/canvas/edges/EdgeEnds.tsx",
    stub: () => "export const EdgeEnds = () => null;",
  },
  // Nor does it draw connections: no connection gesture, snap radius or dot resolver (connectDots.ts and its lazy
  // connectTarget.ts). Its annotation lookup only serves the stencil rail's drops, and the rail is stubbed too.
  {
    name: "the connection gesture",
    path: "/src/canvas/placement/useConnectionPlacement.ts",
    stub: () =>
      "const none = () => {};\nexport const useConnectionPlacement = () => [() => undefined, none, none, none, none, none];",
  },
  {
    name: "the connection snap radius",
    path: "/src/canvas/interaction/ConnectionRadius.tsx",
    stub: () => "export const ConnectionRadius = () => null;",
  },
  {
    name: "the connection dot resolver",
    path: "/src/canvas/interaction/connectDots.ts",
    stub: () =>
      [
        "export const requestDots = () => {};",
        "export const onDots = () => () => {};",
        'export const connectionAt = () => ({ target: { kind: "outside" }, at: { x: 0, y: 0 } });',
        "export const connectionMarks = () => ({ show() {}, clear() {} });",
      ].join("\n"),
  },
  { name: "the start card", path: "/src/canvas/StartCard.tsx", stub: () => "export const StartCard = () => null;" },
  {
    name: "the first-run hint",
    path: "/src/canvas/FirstRunHint.tsx",
    stub: () => "export const FirstRunHint = () => null;",
  },
  {
    name: "the shortcuts sheet",
    path: "/src/components/ShortcutsDialog.tsx",
    stub: () => "export const ShortcutsDialog = () => null;",
  },
  { name: "the simulation editor", path: "/src/live/SimPanel.tsx", stub: () => "export const SimPanel = () => null;" },
  {
    name: "the simulation editor loader",
    path: "/src/live/lazySimPanel.tsx",
    stub: () => "export const SimPanel = Object.assign(() => null, { preload() {} });",
  },
  // Architecture checks (editing only): a read-only canvas runs none, so no count, card, markers or worker.
  {
    name: "the checks scheduler",
    path: "/src/canvas/checks/useChecks.ts",
    stub: () =>
      [
        "const state = { result: null, stale: false, warnings: 0, byElement: new Map(), name: () => undefined, evidence: { status: 'none' } };",
        "const store = { subscribe: () => () => {}, get: () => state, getHot: () => null, setHot() {}, markStale() {}, runSimulations() {}, stopSimulations: () => false };",
        "export const useChecks = () => store;",
      ].join("\n"),
  },
  {
    name: "the checks worker client",
    path: "/src/canvas/checks/runner.ts",
    stub: () => 'export const runChecksOffThread = () => Promise.reject(new Error("No checks in an exported file."));',
  },
  {
    name: "editor-only callout fixes",
    path: "/src/live/useObservedTrouble.ts",
    stub: () => "export const useObservedTrouble = () => ({ trouble: undefined, dismiss() {}, shown() {} });",
  },
  {
    name: "the checks count, card and markers",
    path: "/src/canvas/checks/ChecksViews.tsx",
    stub: () =>
      [
        "export const DiagramCardMeta = () => null;",
        "export const ChecksCardView = () => null;",
        "export const ChecksMarkersView = () => null;",
        "export const SelectionFindings = () => null;",
      ].join("\n"),
  },
];
const STUB = "\0interactive-viewer:editor-only:";
/** An import whose last segment names one of them (the resolved path is checked before it's swapped). */
const STUBBED = new RegExp(
  `(?:^|/)(${EDITOR_ONLY.map((p) => (p.path.split("/").pop() ?? "").replace(/\.tsx?$/, "")).join("|")})$`,
);
const pathPattern = (path: string) => new RegExp(`${path.replace(/[.]/g, "\\.").replace(/\//g, "[/\\\\]")}$`);
FORBIDDEN.push(...EDITOR_ONLY.map(({ name, path }): [string, RegExp] => [name, pathPattern(path)]));

const NO_LOCAL = "\0interactive-viewer:no-local-examples";
const WORKER = 'new Worker(new URL("./particleWorker.ts", import.meta.url), { type: "module", name: "particles" })';

/** The swaps that make the app's modules fit a file with no network (see the header). */
export function viewerSwaps(root: string): Plugin {
  const own = (id: string, path: string) => id.replaceAll("\\", "/").endsWith(path);
  return {
    name: "interactive-viewer-swaps",
    enforce: "pre",
    async resolveId(source, importer, options) {
      // Forward slashes, as Vite ids are: a Windows path would make a second copy of the module (two icon maps).
      if (source.endsWith("/stencils/iconUrls")) return normalizePath(resolve(root, "src/export/viewer/iconUrls.ts"));
      if (/i18n\/stencils$/.test(source)) return normalizePath(resolve(root, "src/export/viewer/stencilText.ts"));
      // Development's content check for local-only examples: never in a file (a single bundle keeps a stub of
      // every module it reaches, used or not).
      if (source === "./localOnly.dev" && importer && own(importer, "/src/lib/localOnly.ts")) return NO_LOCAL;
      // The editing-only panels, whoever imports them.
      if (!importer || importer.startsWith("\0") || !STUBBED.test(source)) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      const panel = resolved && EDITOR_ONLY.find((p) => own(resolved.id, p.path));
      return panel ? `${STUB}${panel.path}:stub` : null;
    },
    load(id) {
      if (id === NO_LOCAL) return "export const matchesLocalExample = () => false;";
      const panel = id.startsWith(STUB) && EDITOR_ONLY.find((p) => id === `${STUB}${p.path}:stub`);
      return panel ? panel.stub(root) : null;
    },
    transform(code, id) {
      if (!own(id, "/src/live/liveRenderer.ts")) return null;
      if (!code.includes(WORKER))
        this.error("interactive viewer: liveRenderer.ts no longer creates its worker as expected; update WORKER.");
      return code.replace(WORKER, '(() => { throw new Error("The exported file draws on the main thread."); })()');
    },
    generateBundle(_options, bundle) {
      for (const out of Object.values(bundle)) {
        if (out.type !== "chunk") continue;
        const ids = Object.entries(out.modules)
          .filter(([, m]) => m.renderedLength > 0)
          .map(([id]) => id);
        for (const [what, pattern] of FORBIDDEN)
          if (ids.some((id) => pattern.test(id)))
            this.error(
              `interactive viewer: ${what} got into the template (${ids.filter((id) => pattern.test(id)).join(", ")})`,
            );
      }
    },
  };
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("base64");

function fontFaces(root: string): string {
  return FONTS.map(
    ({ family, file }) =>
      `@font-face{font-family:"${family}";font-style:normal;font-display:swap;font-weight:100 900;` +
      `src:url(data:font/woff2;base64,${readFileSync(resolve(root, file)).toString("base64")}) format("woff2");` +
      `unicode-range:${LATIN}}`,
  ).join("");
}

/** Text that can't end the element it's inlined in. */
function checkInline(text: string, tag: "script" | "style") {
  if (new RegExp(`</${tag}|<!--`, "i").test(text))
    throw new Error(`interactive viewer: the inline ${tag} contains "</${tag}" or "<!--"`);
}

/** The page around the code: `script` and `style` exactly as they go in (their hashes are of these strings). */
export function assembleTemplate(script: string, style: string): string {
  checkInline(script, "script");
  checkInline(style, "style");
  const icons = Object.fromEntries(catalog.map((s) => [s.id, s.icon]).sort(([a], [b]) => (a < b ? -1 : 1)));
  return [
    "<!doctype html>",
    '<html lang="en" data-theme="light">',
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${viewerCsp(sha256(script), sha256(style))}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="generator" content="Live Diagrams (livediagrams.dev): interactive HTML export">',
    // No favicon request: an empty icon of its own.
    '<link rel="icon" href="data:,">',
    "<title>Live Diagrams</title>",
    `<style>${style}</style>`,
    "</head>",
    "<body>",
    '<div id="root"></div>',
    `${STENCIL_ICONS_OPEN}${JSON.stringify(icons).replace(/</g, "\\u003c")}</script>`,
    PAYLOAD_BLOCK,
    `<script>${script}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/**
 * Builds the template. `plugins`: extra build checks to run on the viewer's bundle too (vite.config.ts passes
 * the private-example guard). Usable from Node on its own: `await buildViewerTemplate(process.cwd())`.
 */
export async function buildViewerTemplate(root: string, plugins: PluginOption[] = []): Promise<string> {
  return (await buildViewer(root, plugins)).html;
}

/** The template and the modules its script is made of (the tests check what's in and what isn't). */
export async function buildViewer(
  root: string,
  plugins: PluginOption[] = [],
): Promise<{ html: string; modules: string[] }> {
  // Vite and the React plugin read NODE_ENV for production mode (Vitest sets "test"): always production.
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    return await buildTemplate(root, plugins);
  } finally {
    process.env.NODE_ENV = env;
  }
}

async function buildTemplate(root: string, plugins: PluginOption[]): Promise<{ html: string; modules: string[] }> {
  const result = await build({
    configFile: false,
    root,
    base: "./",
    mode: "production",
    logLevel: "warn",
    // No environment variables (a prefix none has): none belongs in a file people pass around, and the
    // output stays fixed.
    envPrefix: "LIVE_DIAGRAMS_VIEWER_NEVER_",
    // The viewer stays English: its code calls t() like the app's, with no catalogs to switch to.
    plugins: [viewerSwaps(root), i18n({ catalogs: false }), react(), ...plugins],
    define: {
      // A production build whatever the process says (the e2e build, Vitest), so the output never varies.
      "process.env.NODE_ENV": JSON.stringify("production"),
      "import.meta.env.DEV": "false",
      "import.meta.env.PROD": "true",
      "import.meta.env.MODE": JSON.stringify("production"),
      "import.meta.env.VITE_E2E": JSON.stringify(""),
      // Test-only engine oracles fold out (vite.config.ts).
      __TEST_ORACLES__: "false",
      __BUILD_SHA__: JSON.stringify(""),
      // The public site's switches (src/lib/deployment.ts): the viewer has no links or AI of its own anyway.
      ...deploymentDefines({}),
    },
    build: {
      write: false,
      copyPublicDir: false,
      modulePreload: false,
      cssCodeSplit: false,
      reportCompressedSize: false,
      assetsInlineLimit: 0,
      rolldownOptions: {
        input: resolve(root, VIEWER_ENTRY),
        // Vite's preload helper passes import.meta.url beside each lazy import; with every import inlined it
        // preloads nothing, so the IIFE's `{}` in its place is harmless.
        onwarn(warning, warn) {
          if (warning.code !== "EMPTY_IMPORT_META") warn(warning);
        },
        output: {
          format: "iife",
          codeSplitting: false,
          entryFileNames: "viewer.js",
          assetFileNames: "[name][extname]",
        },
      },
    },
  });
  const output = (Array.isArray(result) ? result : [result]).flatMap((r) => (r as Rollup.RolldownOutput).output);
  const chunks = output.filter((o): o is Rollup.OutputChunk => o.type === "chunk");
  const assets = output.filter((o): o is Rollup.OutputAsset => o.type === "asset");
  if (chunks.length !== 1) throw new Error(`interactive viewer: expected one script, got ${chunks.length}`);
  const others = assets.filter((a) => !a.fileName.endsWith(".css"));
  if (others.length)
    throw new Error(
      `interactive viewer: files the page would have to fetch: ${others.map((a) => a.fileName).join(", ")}`,
    );
  const css = assets.map((a) => String(a.source)).join("");
  const modules = Object.entries(chunks[0].modules)
    .filter(([, m]) => m.renderedLength > 0)
    .map(([id]) => id.replaceAll("\\", "/"));
  return { html: assembleTemplate(chunks[0].code.trim(), fontFaces(root) + css.trim()), modules };
}

/** The template's file name in a build: its content's hash in the name. */
export const templateFileName = (template: string) =>
  `export/interactive-viewer-${createHash("sha256").update(template).digest("hex").slice(0, 10)}.html`;

/**
 * Builds the template beside the app and tells the app where it is (`virtual:interactive-viewer`). In the dev
 * server it's built on first request, again after a change.
 */
export function interactiveViewer(
  plugins: () => PluginOption[] = () => [],
): Plugin & { api: { template: () => Promise<string> } } {
  let root = process.cwd();
  let isBuild = false;
  let template: Promise<string> | undefined;
  const get = () => (template ??= buildViewerTemplate(root, plugins()));
  return {
    name: "interactive-viewer",
    /** The current template (the agent skill's /skill/ folder and zip serve it: scripts/skill-assets.ts). */
    api: { template: () => get() },
    configResolved(config) {
      root = config.root;
      isBuild = config.command === "build";
    },
    buildStart() {
      // A fresh template per build (the watcher's rebuilds too); started now, beside the app's own build.
      template = undefined;
      if (isBuild) void get().catch(() => {});
    },
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null;
    },
    async load(id) {
      if (id !== RESOLVED) return null;
      const path = isBuild ? templateFileName(await get()) : DEV_PATH;
      return `/** The Interactive HTML template, relative to the page (scripts/interactive-viewer.ts). */\nexport const templatePath = ${JSON.stringify(path)};\n`;
    },
    async generateBundle() {
      if (!isBuild) return;
      const html = await get();
      this.emitFile({ type: "asset", fileName: templateFileName(html), source: html });
    },
    configureServer(server: ViteDevServer) {
      server.watcher.on("change", () => (template = undefined));
      server.middlewares.use(`/${DEV_PATH}`, (_req, res, next) => {
        get().then(
          (html) => {
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.end(html);
          },
          (error: unknown) => {
            template = undefined;
            next(error);
          },
        );
      });
    },
  };
}
