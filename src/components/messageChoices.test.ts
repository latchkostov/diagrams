import { expect, it } from "vitest";
import { MAX_CHOICES, selectMessageChoices } from "./messageChoices";

it("ranks an exact match ahead of a full page of substring matches in either population", () => {
  const types = [...Array.from({ length: 100 }, (_, i) => `A${i}`), "A"];
  for (const selected of [types, []]) {
    const result = selectMessageChoices(types, selected, "a");
    expect(result.options[0]).toBe("A");
    expect(result.options).toHaveLength(MAX_CHOICES);
    expect(result.matchingSelectedOverflow).toBe(selected.length ? 1 : 0);
    expect(result.matchingUnselectedOverflow).toBe(selected.length ? 0 : 1);
    expect(result.hiddenSelectionCount).toBe(selected.length ? 1 : 0);
  }
});

it("counts matching overflow independently of nonmatching hidden selections", () => {
  const selected = Array.from({ length: 150 }, (_, i) => `Other${i}`);
  const choices = Array.from({ length: 250 }, (_, i) => `Match${i}`);
  const result = selectMessageChoices(choices, selected, "Match");
  expect(result.options).toEqual(choices.slice(0, MAX_CHOICES));
  expect(result.hiddenSelectionCount).toBe(150);
  expect(result.matchingSelectedOverflow).toBe(0);
  expect(result.matchingUnselectedOverflow).toBe(150);
});

it("reports each matching population's overflow and puts an unselected exact match first", () => {
  const selected = Array.from({ length: 150 }, (_, i) => `A${i}`);
  const choices = [...Array.from({ length: 250 }, (_, i) => `AB${i}`), "A"];
  const result = selectMessageChoices(choices, selected, "A");
  expect(result.options[0]).toBe("A");
  expect(result.options).toHaveLength(2 * MAX_CHOICES);
  expect(result.hiddenSelectionCount).toBe(50);
  expect(result.matchingSelectedOverflow).toBe(50);
  expect(result.matchingUnselectedOverflow).toBe(151);
});

it("deduplicates names and ignores a stale search after the search control disappears", () => {
  const result = selectMessageChoices(["A", "A"], ["A"], "missing");
  expect(result.options).toEqual(["A"]);
  expect(result.hiddenSelectionCount).toBe(0);
  expect(result.matchingSelectedOverflow + result.matchingUnselectedOverflow).toBe(0);
});
