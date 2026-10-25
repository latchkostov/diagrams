// Isolate dev skill serving from viewer compilation: use the same committed viewer in both runs.
// This starts no app page, and closes its server even when a request fails.
import { performance } from "node:perf_hooks";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { createServer, runnerImport } from "vite";

const root = path.resolve(import.meta.dirname, "../..");
const { skillAssetsPlugin } = (await runnerImport(path.join(root, "scripts/skill-assets.ts"), { configFile: false }))
  .module;
const template = readFileSync(path.join(root, "skills/livediagrams/scripts/lib/viewer-template.html"), "utf8");
const port = Number(process.env.SKILL_DEV_PORT ?? 6470);
if (port === 5190 || port === 6000) throw new Error("Choose another skill benchmark port");
const serverRoot = path.join(root, "tests/.output/skill-dev-server");
mkdirSync(serverRoot, { recursive: true });
const server = await createServer({
  root: serverRoot,
  configFile: false,
  publicDir: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [skillAssetsPlugin(async () => template)],
  server: { host: "127.0.0.1", port, strictPort: true, watch: null },
});
try {
  const start = performance.now();
  await server.listen();
  const startupMs = performance.now() - start;
  const samples = [];
  for (let i = 0; i < 3; i++) {
    server.watcher.emit("all", "change", "skill-benchmark");
    const start = performance.now();
    const response = await globalThis.fetch(`http://127.0.0.1:${port}/skill/scripts/lib/viewer-template.html`);
    if (!response.ok || (await response.text()) !== template) throw new Error("Incorrect dev viewer response");
    samples.push(performance.now() - start);
  }
  console.log(JSON.stringify({ startupMs, coldViewerMs: samples }, null, 2));
} finally {
  await server.close();
}
