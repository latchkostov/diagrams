import { expect, it } from "vitest";
import { boundaryAround } from "./arrange";
import { createBoundaryRefitter, planBoundaryRefits } from "./boundaryFit";
import { countingReads } from "../test/complexity";

it.each([false, true])("fits nested and empty boundaries independently of order (%s)", (reverse) => {
  const empty = { id: "empty", group: "outer", x: 900, y: 500, width: 0, height: 0 };
  const groups = [
    { id: "outer", x: 0, y: 0, width: 1, height: 1 },
    { id: "inner", group: "outer", x: 0, y: 0, width: 1, height: 1 },
    empty,
  ];
  const leaf = { id: "leaf", group: "inner", x: 100, y: 200, width: 220, height: 72 };
  const annotation = { id: "note", group: "inner", x: 400, y: 250, width: 100, height: 100 };
  const plan = planBoundaryRefits(reverse ? groups.reverse() : groups, [leaf, annotation]);
  const inner = boundaryAround([leaf, annotation]);
  expect(plan.get("inner")).toEqual(inner);
  expect(plan.get("outer")).toEqual(boundaryAround([{ id: "inner", ...inner }, empty]));
  expect(plan.has("empty")).toBe(false);
  expect(empty).toEqual({ id: "empty", group: "outer", x: 900, y: 500, width: 0, height: 0 });
});

it("fits only requested boundaries and terminates on invalid cycles", () => {
  const groups = [
    { id: "a", group: "b", x: 0, y: 0, width: 1, height: 1 },
    { id: "b", group: "a", x: 0, y: 0, width: 1, height: 1 },
    { id: "empty", x: 0, y: 0, width: 0, height: 0 },
  ];
  expect(planBoundaryRefits(groups, [])).toEqual(new Map());
  expect(
    planBoundaryRefits([groups[2]], [{ id: "n", group: "empty", x: 0, y: 0, width: 10, height: 10 }], new Set()),
  ).toEqual(new Map());
});

it("reuses indexed geometry and child fits across collision moves", () => {
  const groups = countingReads([
    { id: "outer", x: 0, y: 0, width: 1, height: 1 },
    { id: "inner", group: "outer", x: 0, y: 0, width: 1, height: 1 },
  ]);
  const leaf = { id: "leaf", group: "inner", x: 100, y: 200, width: 220, height: 72 };
  const elements = countingReads([leaf]);
  const refit = createBoundaryRefitter(groups.items, elements.items);
  refit();
  const preparedReads = groups.reads() + elements.reads();
  leaf.y += 400;
  const child = refit(new Set(["inner"])).get("inner")!;
  expect(child).toEqual(boundaryAround([leaf]));
  // A later parent-only fit uses the latest child box rather than the original input.
  expect(refit(new Set(["outer"])).get("outer")).toEqual(boundaryAround([{ id: "inner", ...child }]));
  expect(groups.reads() + elements.reads()).toBe(preparedReads);
});
