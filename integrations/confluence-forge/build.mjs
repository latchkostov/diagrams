import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { runnerImport } from "vite";

const app = dirname(fileURLToPath(import.meta.url));
const root = resolve(app, "../..");
const {
  module: { buildForge },
} = await runnerImport(resolve(app, "build.ts"), { root, configFile: false });
await buildForge(root, process.argv.includes("--fake"), process.env.FORGE_TEST_WORKER);
