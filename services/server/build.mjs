import { build } from "esbuild";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { outfile: { type: "string", default: "dist/main.js" } } });

// ws uses require for Node builtins and optional accelerators. Keep that working in the ESM bundle.
await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  outfile: values.outfile,
});
