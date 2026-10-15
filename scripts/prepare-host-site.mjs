import path from "node:path";
import process from "node:process";
import console from "node:console";
import { parseArgs } from "node:util";
import { runnerImport } from "vite";

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "/" },
    dir: { type: "string", default: "dist" },
  },
});
const root = path.resolve(import.meta.dirname, "..");
const { prepareSite } = (
  await runnerImport(path.join(root, "scripts/prepare-site.ts"), { root, configFile: false, logLevel: "error" })
).module;
prepareSite(path.resolve(values.dir), values.base);
console.log(`Prepared built index.html for ${values.base} (relative assets also work at deep fallback routes).`);
process.exit(0);
