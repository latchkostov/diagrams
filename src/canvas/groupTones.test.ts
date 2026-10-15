import { expect, it } from "vitest";
import { isPresetGroupTone, resolveGroupTone, toneColor } from "./groupTones";

it.each(["__proto__", "constructor", "toString", "hasOwnProperty"])("rejects inherited tone %s", (tone) => {
  expect(isPresetGroupTone(tone)).toBe(false);
  expect(resolveGroupTone(tone)).toBe(toneColor.neutral);
});
