import { spawnSync } from "node:child_process";
import process from "node:process";
import { expect, it } from "vitest";

it("the gate's dev config removes eager local catalogs before Vite expands imports", () => {
  const probe = `
    import { readFileSync } from "node:fs";
    import { runnerImport } from "vite";
    const { module } = await runnerImport("./vite.config.ts", { root: process.cwd(), configFile: false, logLevel: "error" });
    const plugin = module.default.plugins.flat(Infinity).find(p => p?.name === "parity-public-examples-only");
    if (!plugin) throw new Error("Missing public-fixture guard in gate dev mode");
    const source = readFileSync("src/examples/index.ts", "utf8");
    const code = await plugin.transform.call({ error(message) { throw new Error(message); } }, source, process.cwd() + "/src/examples/index.ts");
    if (code === source || code.includes("eager: true")) throw new Error("Eager local catalog was not removed");
    console.log("public fixtures only");
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
    encoding: "utf8",
    env: { ...process.env, VITEST: "", E2E_GATE: "1", VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" },
  });
  expect(result.status, result.stderr + result.stdout).toBe(0);
  expect(result.stdout).toContain("public fixtures only");
});
