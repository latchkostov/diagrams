import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build, normalizePath, type Plugin, type Rollup } from "vite";
import react from "@vitejs/plugin-react";
import { FONTS, LATIN, viewerSwaps } from "./interactive-viewer";
import { deploymentDefines } from "./deployment-env";
import { i18n } from "./i18n-plugin";
import { catalog } from "../src/stencils/catalog";
import type { ViewerAttribution } from "../src/export/viewer/options";

export const BUNDLE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; media-src blob:; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'";

/** Same viewer restrictions as Interactive HTML, with external scripts, CSS and fonts for app CSPs. */
export async function buildViewerBundle(
  root: string,
  options: { attribution?: ViewerAttribution; plugins?: Plugin[] } = {},
): Promise<Map<string, string | Uint8Array>> {
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const result = await build({
      configFile: false,
      root,
      base: "./",
      mode: "production",
      logLevel: "warn",
      publicDir: false,
      envPrefix: "LIVE_DIAGRAMS_VIEWER_NEVER_",
      plugins: [
        ...(options.plugins ?? []),
        {
          name: "viewer-bundle-assets",
          enforce: "pre",
          resolveId(source) {
            if (source === "virtual:viewer-fonts.css") return "\0viewer-fonts.css";
            if (source.endsWith("/stencils/iconUrls")) return "\0viewer-bundle-icons";
          },
          transform(code, id) {
            if (!id.replaceAll("\\", "/").endsWith("/src/live/liveRenderer.ts")) return null;
            const probe = 'new Worker("http://[", options).terminate()';
            if (!code.includes(probe)) this.error("Viewer worker probe changed; update the bundle restriction.");
            return code.replace(probe, '(() => { throw new Error("No workers in the platform viewer"); })()');
          },
          load(id) {
            if (id === "\0viewer-fonts.css")
              return FONTS.map(
                ({ family, file }) =>
                  `@font-face{font-family:"${family}";font-style:normal;font-display:swap;font-weight:100 900;src:url("${normalizePath(resolve(root, file))}") format("woff2");unicode-range:${LATIN}}`,
              ).join("\n");
            if (id === "\0viewer-bundle-icons") {
              const entries = [...new Set(catalog.map((s) => s.icon))].sort().map((name) => {
                const source = readFileSync(resolve(root, `src/stencils/icons/${name}.svg`));
                const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
                const file = `${name}-${hash}.svg`;
                this.emitFile({ type: "asset", fileName: `assets/${file}`, source });
                return `${JSON.stringify(`./icons/${name}.svg`)}: new URL(/* @vite-ignore */ ${JSON.stringify(`./${file}`)}, import.meta.url).href`;
              });
              return `export const iconUrls = {${entries.join(",")}}; export function iconUrl(icon) { return iconUrls["./icons/" + icon + ".svg"]; }`;
            }
          },
        },
        viewerSwaps(root),
        i18n({ catalogs: false }),
        react(),
      ],
      define: {
        __VIEWER_ATTRIBUTION__: JSON.stringify(options.attribution ?? "show"),
        "process.env.NODE_ENV": JSON.stringify("production"),
        "import.meta.env.DEV": "false",
        "import.meta.env.PROD": "true",
        "import.meta.env.MODE": JSON.stringify("production"),
        "import.meta.env.VITE_E2E": JSON.stringify(""),
        __BUILD_SHA__: JSON.stringify(""),
        // Test-only engine oracles fold out (vite.config.ts).
        __TEST_ORACLES__: "false",
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
          input: resolve(root, "src/export/viewerBundleEntry.tsx"),
          output: {
            format: "es",
            codeSplitting: false,
            entryFileNames: "assets/viewer-[hash].js",
            assetFileNames: "assets/[name]-[hash][extname]",
          },
        },
      },
    });
    const output = (Array.isArray(result) ? result : [result]).flatMap((r) => (r as Rollup.RolldownOutput).output);
    const files = new Map<string, string | Uint8Array>();
    for (const file of output) files.set(file.fileName, file.type === "chunk" ? file.code : file.source);
    const entry = output.find((f) => f.type === "chunk" && f.isEntry);
    if (!entry) throw new Error("Viewer bundle has no entry.");
    const styles = output
      .filter((f) => f.fileName.endsWith(".css"))
      .map((f) => `<link rel="stylesheet" href="./${f.fileName}">`)
      .join("\n");
    files.set(
      "index.html",
      `<!doctype html>
<html lang="en" data-theme="light"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${BUNDLE_CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><link rel="icon" href="data:,">
<title>Live Diagrams</title>${styles}</head>
<body><div id="root"></div><script type="module" src="./${entry.fileName}"></script></body></html>
`,
    );
    // Stable discovery for host packaging; all runtime assets have content hashes.
    files.set(
      "manifest.json",
      JSON.stringify({ entry: entry.fileName, files: [...files.keys()].sort() }, null, 2) + "\n",
    );
    return files;
  } finally {
    process.env.NODE_ENV = env;
  }
}

export async function writeViewerBundle(root: string): Promise<void> {
  const files = await buildViewerBundle(root);
  const outDir = resolve(root, "dist-viewer");
  // Fixed child of this checkout; remove stale hashes only after a successful build.
  rmSync(outDir, { recursive: true, force: true });
  for (const [name, source] of files) {
    mkdirSync(resolve(root, outDir, name, ".."), { recursive: true });
    writeFileSync(resolve(root, outDir, name), source);
  }
  const hash = createHash("sha256");
  for (const [name, source] of [...files].sort(([a], [b]) => a.localeCompare(b))) hash.update(name).update(source);
  console.log(`Viewer bundle: ${files.size} files, sha256 ${hash.digest("hex")}`);
}

/** E2E's production build prepares the fixture once, before browser workers start. */
export function viewerBundleFixture(): Plugin {
  let root = process.cwd();
  return {
    name: "viewer-bundle-fixture",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    async generateBundle() {
      for (const [fileName, source] of await buildViewerBundle(root))
        this.emitFile({ type: "asset", fileName: `viewer/${fileName}`, source });
    },
  };
}
