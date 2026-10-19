import { resolve } from "node:path";
import process from "node:process";
import { runnerImport } from "vite";

const root = process.cwd();
const {
  module: { writeViewerBundle },
} = await runnerImport(resolve(root, "scripts/viewer-bundle.ts"), { root, configFile: false, logLevel: "error" });
await writeViewerBundle(root);
