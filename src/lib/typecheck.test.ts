import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);

// Each case launches two real compiler processes. This is a compatibility/no-emit
// probe, not a speed budget; use CI's hang backstop on busy local machines too.
it.each([
  { pkg: "@typescript/native", bin: "tsc" },
  { pkg: "typescript", bin: "tsc6" },
])("$pkg accepts valid code, rejects errors and never emits", { timeout: 40_000 }, ({ pkg, bin: binary }) => {
  const output = resolve("tests/.output");
  mkdirSync(output, { recursive: true });
  const fixture = mkdtempSync(join(output, "compiler-probe-"));
  const source = join(fixture, "probe.ts");
  const config = join(fixture, "tsconfig.json");
  const compiler = (pkg: string, bin: string) => {
    const manifest = require.resolve(`${pkg}/package.json`);
    const { bin: bins } = JSON.parse(readFileSync(manifest, "utf8")) as { bin: Record<string, string> };
    return resolve(dirname(manifest), bins[bin]);
  };
  const bin = compiler(pkg, binary);
  try {
    writeFileSync(
      config,
      JSON.stringify({
        compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, target: "ES2022", types: [] },
        files: ["probe.ts"],
      }),
    );
    for (const valid of [true, false]) {
      writeFileSync(
        source,
        valid
          ? 'export const count: number = 1;\nexport const name: string = "ok";\n'
          : 'export const count: number = "wrong";\nexport const name: string = 42;\n',
      );
      const result = spawnSync(process.execPath, [bin, "--project", config, "--pretty", "false"], {
        encoding: "utf8",
        timeout: 40_000,
      });
      if (valid) expect(result.status, result.stderr + result.stdout).toBe(0);
      else expect(result.status, result.stderr + result.stdout).not.toBe(0);
      const diagnostics = [...result.stdout.matchAll(/error TS(\d+):/g)].map((m) => m[1]).sort();
      expect(diagnostics).toEqual(valid ? [] : ["2322", "2322"]);
      expect(readdirSync(fixture).sort()).toEqual(["probe.ts", "tsconfig.json"]);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
