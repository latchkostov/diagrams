import fc from "fast-check";
import { expect, it } from "vitest";
import { popDue, pushDue, removeDue, type Due } from "./dueHeap";
import { propertyRuns } from "../test/fastCheck";
import { countingReads, GROWTH_FACTOR, LINEAR_LIMIT } from "../test/complexity";

it("removes arbitrary entries and preserves stable ordering and every index", () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 100 }), { maxLength: 200 }),
      fc.array(fc.nat(199)),
      (ends, removed) => {
        const heap: Due[] = [];
        const indices = new Map<number, number>();
        ends.forEach((end, id) => pushDue(heap, { id, end }, indices));
        const remaining = new Map(heap.map((due) => [due.id, due]));
        for (const id of removed) {
          expect(removeDue(heap, id, indices)).toEqual(remaining.get(id));
          remaining.delete(id);
          heap.forEach((item, index) => expect(indices.get(item.id)).toBe(index));
          expect(indices.size).toBe(heap.length);
        }
        const popped = [];
        while (heap.length) popped.push(popDue(heap, indices));
        expect(popped).toEqual([...remaining.values()].sort((a, b) => a.end - b.end || a.id - b.id));
        expect(indices.size).toBe(0);
      },
    ),
    { numRuns: propertyRuns(40) },
  );
});

it("cancels by index without scanning the heap", () => {
  const reads = (count: number) => {
    const heap: Due[] = [];
    const indices = new Map<number, number>();
    for (let id = 0; id < count; id++) pushDue(heap, { id, end: id }, indices);
    const counted = countingReads(heap);
    expect(removeDue(counted.items, count - 2, indices)?.id).toBe(count - 2);
    return counted.reads();
  };
  expect(reads(8000)).toBeLessThanOrEqual(reads(8000 / GROWTH_FACTOR) * LINEAR_LIMIT);
});
