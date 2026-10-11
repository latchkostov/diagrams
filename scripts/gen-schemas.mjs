// Writes the static agent docs (public/schema/diagram.v1.json, ops.v1.json, stencils.json) from the
// code, so they never drift from the app. Runs before every build (`prebuild`); run it by hand with
// `pnpm schemas`. The source is src/ai/webmcp/publicSchemas.ts, loaded through Vite so TypeScript and
// the app's imports work unchanged.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { runnerImport } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const { module } = await runnerImport(path.join(root, "src/ai/webmcp/publicSchemas.ts"), {
  root,
  configFile: false,
  logLevel: "error",
});
const files = module.publicSchemaFiles();
const outDir = path.join(root, "public", "schema");
fs.mkdirSync(outDir, { recursive: true });
let changed = 0;
for (const [name, text] of Object.entries(files)) {
  const file = path.join(outDir, name);
  const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (before === text) continue;
  fs.writeFileSync(file, text);
  changed++;
}
console.log(
  `schemas: ${changed ? `wrote ${changed} of` : "unchanged,"} ${Object.keys(files).length} files in public/schema/`,
);
process.exit(0);
