import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
import { tutorialEntries } from "../tutorials/catalog/ids";
import { pointerTutorialGroups } from "../../tests/e2e/pointer-tutorial-groups";

it("registers both pointer paths for every lesson exactly once across the bounded spec groups", () => {
  const files = readdirSync("tests/e2e").filter((file) => /^tutorials-solutions(?:-\d+)?\.spec\.ts$/.test(file));
  const registered = files.flatMap((file) => {
    const source = readFileSync(`tests/e2e/${file}`, "utf8");
    const parts = [...source.matchAll(/pointerTutorialGroups\[(\d+)\]/g)].map((match) => Number(match[1]));
    expect(parts).toHaveLength(1);
    expect(source).toContain("await runPointerSolution(page, consoleErrors, id)");
    expect(source).toContain("await runPointerSkipAll(page, consoleErrors, id)");
    expect(source.match(/test\.fixme\(!!quarantined, quarantineReason\)/g)).toHaveLength(2);
    return parts;
  });
  expect(registered.sort()).toEqual([0, 1, 2, 3]);
  const entries = registered.flatMap((part) => pointerTutorialGroups[part]);
  expect([...entries].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
    [...tutorialEntries].sort((a, b) => a.id.localeCompare(b.id)),
  );
  expect(new Set(entries.map(({ id }) => id)).size).toBe(entries.length);
  const sizes = pointerTutorialGroups.map((part) => part.length);
  expect(Math.min(...sizes)).toBeGreaterThan(0);
  expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
});
