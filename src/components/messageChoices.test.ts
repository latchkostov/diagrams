import { expect, it, vi } from "vitest";
import { opGrowth } from "../test/opCounter";
import { GROWTH_FACTOR } from "../test/complexity";
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

it("reuses normalized vocabularies across broad queries and unrelated draft renders", () => {
  const choices = Array.from({ length: 30_000 }, (_, i) => `Type${i}`);
  const selected = choices.slice(0, 150);
  selectMessageChoices(choices, selected);
  const normalize = vi.spyOn(String.prototype, "toLocaleLowerCase");
  try {
    for (const query of ["Type", "Type2", "Type", "absent"]) selectMessageChoices(choices, selected, query);
    expect(normalize).toHaveBeenCalledTimes(4); // Only the queries, never the 30,000 names again.
    selectMessageChoices(choices, ["New selection"], "Type");
    expect(normalize).toHaveBeenCalledTimes(6); // A changed selection normalizes only its new name and query.
  } finally {
    normalize.mockRestore();
  }
});
it("skips ranking for an empty query and bounds retained matches at two vocabulary sizes", () => {
  for (const count of [3750, 30_000]) {
    const choices = Array.from({ length: count }, (_, i) => `Type${i}`);
    selectMessageChoices(choices);
    const filter = vi.spyOn(Array.prototype, "filter");
    const push = Array.prototype.push;
    let largestBucket = 0;
    Array.prototype.push = function (this: unknown[], ...items: unknown[]) {
      const size = push.apply(this, items);
      largestBucket = Math.max(largestBucket, size);
      return size;
    };
    let empty, broad;
    try {
      empty = selectMessageChoices(choices);
      expect(filter).not.toHaveBeenCalled();
      broad = selectMessageChoices(choices, undefined, "Type");
      for (const result of filter.mock.results) expect(result.value.length).toBeLessThanOrEqual(MAX_CHOICES * 2);
    } finally {
      filter.mockRestore();
      Array.prototype.push = push;
    }
    expect(largestBucket).toBeLessThanOrEqual(MAX_CHOICES);
    expect(empty.options).toEqual(choices.slice(0, MAX_CHOICES));
    expect(broad.options).toEqual(choices.slice(0, MAX_CHOICES));
    expect(broad.matchingUnselectedOverflow).toBe(count - MAX_CHOICES);
  }
});
it("returns zero matching choices without changing either population", () => {
  const choices = Array.from({ length: 250 }, (_, i) => `Type${i}`);
  const value = ["Type0"];
  const result = selectMessageChoices(choices, value, "absent");
  expect(result.options).toEqual([]);
  expect(result.all).toEqual(choices);
  expect(result.selected).toEqual(new Set(value));
  expect(result.hiddenSelectionCount).toBe(1);
  expect(result.matchingSelectedOverflow + result.matchingUnselectedOverflow).toBe(0);
  expect(selectMessageChoices(choices, value).options).toHaveLength(MAX_CHOICES + 1);
});

it("scans broad searches linearly using cached normalized entries", () => {
  const search = (count: number) => {
    const choices = Array.from({ length: count }, (_, i) => `Type${i}`);
    selectMessageChoices(choices);
    return () => selectMessageChoices(choices, undefined, "Type");
  };
  expect(opGrowth(search(3750), search(3750 * GROWTH_FACTOR), 9, ["src/components/messageChoices.ts"])).toBeLessThan(9);
});
