import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);

it("the native checker and the API compiler accept valid code, reject the same errors and never emit", () => {
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
  const compilers = [compiler("@typescript/native", "tsc"), compiler("typescript", "tsc6")];
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
      for (const bin of compilers) {
        const result = spawnSync(process.execPath, [bin, "--project", config, "--pretty", "false"], {
          encoding: "utf8",
        });
        if (valid) expect(result.status, result.stderr + result.stdout).toBe(0);
        else expect(result.status, result.stderr + result.stdout).not.toBe(0);
        const diagnostics = [...result.stdout.matchAll(/error TS(\d+):/g)].map((m) => m[1]).sort();
        expect(diagnostics).toEqual(valid ? [] : ["2322", "2322"]);
        expect(readdirSync(fixture).sort()).toEqual(["probe.ts", "tsconfig.json"]);
      }
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
