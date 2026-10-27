import { expect, it } from "vitest";
import { opGrowth, ops } from "../../test/opCounter";
import { LABEL, placeLabels, wrapLines } from "./labels";

it("bounds imported label wrapping before splitting words or searching widths", () => {
  const hostile = (n: number) => `${"x".repeat(n)} ${"y".repeat(n)} ${"z".repeat(n)} ${"a ".repeat(n)}`;
  const small = hostile(128);
  const large = hostile(1024);
  expect(
    opGrowth(
      () => wrapLines(small, 2),
      () => wrapLines(large, 2),
    ),
  ).toBeLessThan(24);
  const manyWords = "a ".repeat(200_000);
  expect(ops(() => expect(wrapLines(manyWords, 3)).toBeNull(), LABEL.maxLineChars)).toBeGreaterThan(0);
});

it("keeps normal wrapping and retains the full text when a long imported label becomes a hover dot", () => {
  expect(wrapLines("Authorize payment", 2)).toEqual(["Authorize", "payment"]);
  expect(wrapLines("Redrive after 5 failed receives", 2)).toEqual(["Redrive after 5", "failed receives"]);
  expect(wrapLines("single", 3)).toBeNull();
  const text = "Long imported label ".repeat(1000).trim();
  const placed = placeLabels(
    [
      {
        id: "e",
        text,
        points: [
          { x: 0, y: 0 },
          { x: 800, y: 0 },
        ],
      },
    ],
    { nodes: [] },
  ).get("e");
  expect(placed).toMatchObject({ mode: "dot", text });
});
