import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { engineVersion } from "../../scripts/engine-version";
import { ENGINE_VERSION } from "./version";

describe("the engine version", () => {
  it("is defined for this build: 12 hex digits of src/sim and src/model", () => {
    expect(ENGINE_VERSION).toMatch(/^[0-9a-f]{12}$/);
    expect(ENGINE_VERSION).toBe(engineVersion(process.cwd()));
  });

  it("changes with the simulator's code, not with its tests or line endings", () => {
    const root = mkdtempSync(join(tmpdir(), "engine-version-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "src/sim"), { recursive: true });
    mkdirSync(join(root, "src/model"), { recursive: true });
    writeFileSync(join(root, "src/sim/engine.ts"), "export const STEP = 10;\n");
    writeFileSync(join(root, "src/model/types.ts"), "export type X = 1;\n");
    const before = engineVersion(root);
    writeFileSync(join(root, "src/sim/engine.test.ts"), "test file\n");
    expect(engineVersion(root)).toBe(before);
    writeFileSync(join(root, "src/sim/engine.ts"), "export const STEP = 10;\r\n");
    expect(engineVersion(root)).toBe(before);
    writeFileSync(join(root, "src/sim/engine.ts"), "export const STEP = 20;\n");
    expect(engineVersion(root)).not.toBe(before);
  });
});
