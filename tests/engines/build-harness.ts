import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { build, type Rollup } from "vite";
import { i18n } from "../../scripts/i18n-plugin";
import { deploymentDefines } from "../../scripts/deployment-env";
import { engineVersion } from "../../scripts/engine-version";

/** Where the harness bundle goes: one script, run as is in each browser and in Node. */
export const HARNESS = resolve("tests/.output/engines/harness.js");

/** Bundles tests/engines/harness.ts (the live controller and engine, English messages) into one classic script. */
export default async function buildHarness(): Promise<void> {
  const result = await build({
    configFile: false,
    root: resolve("."),
    logLevel: "warn",
    mode: "production",
    plugins: [i18n()],
    define: {
      ...deploymentDefines({}),
      "import.meta.env.VITE_E2E": JSON.stringify(""),
      __BUILD_SHA__: JSON.stringify(""),
      __ENGINE_VERSION__: JSON.stringify(engineVersion(resolve("."))),
    },
    build: {
      write: false,
      minify: false,
      modulePreload: false,
      copyPublicDir: false,
      rolldownOptions: {
        input: resolve("tests/engines/harness.ts"),
        output: { format: "iife", codeSplitting: false },
      },
    },
  });
  const output = (Array.isArray(result) ? result : [result]).flatMap((r) => (r as Rollup.RolldownOutput).output);
  const chunk = output.find((o): o is Rollup.OutputChunk => o.type === "chunk");
  if (!chunk) throw new Error("engine harness: no script built");
  mkdirSync(dirname(HARNESS), { recursive: true });
  writeFileSync(HARNESS, chunk.code);
}
