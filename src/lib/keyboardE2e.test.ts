import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { tutorialEntries } from "../tutorials/catalog/ids";
import { keyboardExceptions } from "../tutorials/keyboard";
import { keyboardTutorialGroups } from "../../tests/e2e/keyboard-tutorial-groups";

it("registers every keyboard lesson exactly once across the bounded spec groups", () => {
  const files = ["tutorials-keyboard", "tutorials-keyboard-2", "tutorials-keyboard-3", "tutorials-keyboard-4"];
  const registered = files.flatMap((file) => {
    const source = readFileSync(`tests/e2e/${file}.spec.ts`, "utf8");
    const parts = [...source.matchAll(/keyboardTutorialGroups\[(\d+)\]/g)].map((match) => Number(match[1]));
    expect(parts).toHaveLength(1);
    expect(source).toContain("await runKeyboardTutorial(page, consoleErrors, id)");
    return parts;
  });
  expect(registered.sort()).toEqual([0, 1, 2, 3]);
  const ids = registered.flatMap((part) => keyboardTutorialGroups[part]);
  expect([...ids].sort()).toEqual(
    tutorialEntries
      .filter((entry) => !keyboardExceptions[entry.id])
      .map(({ id }) => id)
      .sort(),
  );
  expect(new Set(ids).size).toBe(ids.length);
  const sizes = keyboardTutorialGroups.map((part) => part.length);
  expect(Math.min(...sizes)).toBeGreaterThan(0);
  expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
});
