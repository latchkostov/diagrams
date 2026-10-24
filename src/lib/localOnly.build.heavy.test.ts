import { resolve } from "node:path";
import { build, type Plugin, type Rollup } from "vite";
import { describe, expect, it } from "vitest";
import { noPrivateExamples } from "../../vite.config";
import { localOnlyFixture } from "../lab/localOnlyFixture";

// Replace the registry before Vite can transform its glob. Build tests only ever load synthetic data.
const syntheticRegistry: Plugin = {
  name: "synthetic-local-example-registry",
  enforce: "pre",
  load(id) {
    if (!id.replaceAll("\\", "/").endsWith("/src/examples/index.ts")) return;
    return `export const examples = import.meta.env.DEV ? [{ localOnly: true, diagram: ${JSON.stringify(localOnlyFixture)} }] : [];`;
  },
};

async function privacyBuild(dev: boolean, guard = true): Promise<Rollup.OutputChunk[]> {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [syntheticRegistry, ...(guard ? [noPrivateExamples()] : [])],
    define: { "import.meta.env.DEV": JSON.stringify(dev) },
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve("src/lib/localOnly.ts"), formats: ["es"], fileName: "privacy" },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
  return outputs.flatMap((output) => output.output).filter((out): out is Rollup.OutputChunk => out.type === "chunk");
}

describe("production privacy build guard", () => {
  it("tree-shakes every fingerprint string and the entire dev fingerprint module", async () => {
    const chunks = await privacyBuild(false);
    const code = chunks.map((chunk) => chunk.code).join("\n");
    for (const value of [
      ...localOnlyFixture.nodes.flatMap((node) => [node.id, node.label, node.sublabel]),
      ...localOnlyFixture.edges.map((edge) => edge.label),
    ].filter((value): value is string => !!value)) {
      expect(code).not.toContain(value);
      expect(code).not.toContain(value.toLowerCase());
    }
    expect(code).not.toContain("localFingerprints");
    expect(
      chunks
        .flatMap((chunk) => Object.entries(chunk.modules))
        .filter(([id, module]) => id.includes("localOnly.dev") && module.renderedLength > 0),
    ).toEqual([]);
    // Ensure the synthetic data was actually present when building the dev code path.
    const dev = await privacyBuild(true, false);
    expect(dev.map((chunk) => chunk.code).join("\n")).toContain(localOnlyFixture.nodes[0].label);
  }, 20_000);

  it("fails closed if fingerprint code survives in a production build", async () => {
    await expect(privacyBuild(true)).rejects.toThrow("Local-only example or fingerprint data bundled");
  }, 20_000);
});
