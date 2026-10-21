import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { build, type Rollup } from "vite";
import { buildViewerBundle, BUNDLE_CSP } from "../../scripts/viewer-bundle";
import { i18n } from "../../scripts/i18n-plugin";
import { checkManifest, checkBudget } from "./check.mjs";

/** Offline packaging. The fake bridge can only be built into tests/.output, never deployable resources. */
export async function buildForge(root: string, fake = false, testWorker?: string): Promise<void> {
  const app = resolve(root, "integrations/confluence-forge");
  checkManifest(readFileSync(resolve(app, "manifest.yml"), "utf8"));
  if (testWorker !== undefined && !/^\d+$/.test(testWorker)) throw new Error("Invalid Forge test worker");
  const out =
    testWorker !== undefined
      ? resolve(root, `tests/.output/confluence-forge-${testWorker}/${fake ? "fake" : "real"}`)
      : fake
        ? resolve(root, "tests/.output/confluence-forge")
        : resolve(app, "dist");
  const viewer = await buildViewerBundle(root, { attribution: "hide" });
  const viewerEntry = (JSON.parse(String(viewer.get("manifest.json"))) as { entry: string }).entry;
  const prepared = new Map<string, string | Uint8Array>();
  for (const surface of ["view", "config"]) {
    const result = await build({
      root: app,
      configFile: false,
      base: "./",
      publicDir: false,
      envPrefix: "FORGE_NEVER_",
      mode: "production",
      logLevel: "warn",
      plugins: [
        {
          name: "forge-resource",
          enforce: "pre",
          resolveId(id) {
            if (fake && id === "@forge/bridge") return resolve(app, "test/fake-bridge.ts");
            // The viewer is already built, isolated and CSP-safe; import it before our platform code.
            if (id === "virtual:forge-viewer") return { id: `./${viewerEntry.replace("assets/", "")}`, external: true };
          },
        },
        i18n({ catalogs: false }),
      ],
      define: { "process.env.NODE_ENV": '"production"' },
      build: {
        write: false,
        copyPublicDir: false,
        modulePreload: false,
        cssCodeSplit: false,
        assetsInlineLimit: 0,
        rolldownOptions: {
          input: resolve(app, `src/${surface === "view" ? "view" : "configure"}.ts`),
          output: {
            format: "es",
            codeSplitting: false,
            entryFileNames: "assets/forge-[hash].js",
            assetFileNames: "assets/forge-[hash][extname]",
          },
        },
      },
    });
    const output = (Array.isArray(result) ? result : [result]).flatMap((r) => (r as Rollup.RolldownOutput).output);
    if (!fake && output.some((file) => file.type === "chunk" && file.code.includes("__forgeTest")))
      throw new Error("A fake bridge must never ship in deployable Forge resources");
    if (surface === "view")
      for (const [name, source] of viewer)
        if (name !== "index.html" && name !== "manifest.json") prepared.set(`view/${name}`, source);
    for (const file of output)
      prepared.set(`${surface}/${file.fileName}`, file.type === "chunk" ? file.code : file.source);
    const entry = output.find((file) => file.type === "chunk" && file.isEntry);
    if (!entry) throw new Error("Forge resource has no entry");
    const css = [...(surface === "view" ? viewer.keys() : []), ...output.map((file) => file.fileName)].filter((name) =>
      name.endsWith(".css"),
    );
    // Forge supplies its own policy. This additional restrictive policy excludes all runtime fetch, workers and frames.
    prepared.set(
      `${surface}/index.html`,
      `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${BUNDLE_CSP}"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><link rel="icon" href="data:,"><title>Live Diagram</title>${css.map((name) => `<link rel="stylesheet" href="./${name}">`).join("")}</head><body>${surface === "view" ? '<div id="root"></div>' : ""}<script type="module" src="./${entry.fileName}"></script></body></html>`,
    );
  }
  checkBudget(prepared);
  // Fixed, verified children of the checkout, and only after both builds have succeeded.
  rmSync(out, { recursive: true, force: true });
  for (const [name, source] of prepared) {
    mkdirSync(resolve(out, name, ".."), { recursive: true });
    writeFileSync(resolve(out, name), source);
  }
  console.log(`Forge ${fake ? "fake-bridge fixture" : "resources"}: ${prepared.size} files; no account required.`);
}
