import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { timeoutReferences, checkWaits } from "./e2e-waits.mjs";

test("rejects direct, optional, bracket and aliased timeout references", () => {
  for (const source of [
    "await page.waitForTimeout(500)",
    "await guest?.waitForTimeout(500)",
    'await page["waitForTimeout"](500)',
    "const wait = page.waitForTimeout.bind(page)",
  ])
    assert.deepEqual(timeoutReferences(source), [1]);
  assert.deepEqual(timeoutReferences('// page.waitForTimeout(500)\nconst text = "waitForTimeout"'), []);
});

test("only an exact, justified exception passes; stale exceptions fail", () => {
  const root = mkdtempSync(join(tmpdir(), "e2e-waits-"));
  try {
    const directory = join(root, "tests/e2e");
    mkdirSync(directory, { recursive: true });
    const list = join(directory, "wait-for-timeout-allowlist.json");
    writeFileSync(join(directory, "sample.spec.ts"), "await page.waitForTimeout(1)");
    writeFileSync(list, "[]");
    assert.equal(checkWaits(root).length, 1);
    const exception = { file: "tests/e2e/sample.spec.ts", line: 1, reason: "Example reason in a guard fixture" };
    writeFileSync(list, JSON.stringify([exception]));
    assert.deepEqual(checkWaits(root), []);
    writeFileSync(list, JSON.stringify([{ ...exception, reason: "" }]));
    assert.throws(() => checkWaits(root), /reason/);
    writeFileSync(list, JSON.stringify([exception]));
    writeFileSync(join(directory, "sample.spec.ts"), "await expect(page).toHaveURL('/')");
    assert.match(checkWaits(root)[0], /unused/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
