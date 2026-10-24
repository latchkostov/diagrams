import { expect, it } from "vitest";
import { createGrowEdgesEqual } from "./growEdges";

it("compares an unchanged incoming array only once, even when it equals a retained selection", () => {
  let reads = 0;
  const edge = { id: "edge", source: "a", target: "b" };
  const a = [edge];
  const b = [
    {
      ...edge,
      get source() {
        reads++;
        return "a";
      },
      selected: true,
    },
  ];
  const equal = createGrowEdgesEqual();
  expect(equal(a, a)).toBe(true);
  expect(reads).toBe(0);
  expect(equal(a, b)).toBe(true);
  expect(reads).toBeGreaterThan(0);
  const compared = reads;
  for (let update = 0; update < 24; update++) expect(equal(a, b)).toBe(true);
  expect(reads).toBe(compared);
  expect(equal(a, [{ ...edge, target: "c" }])).toBe(false);
  expect(equal([{ ...edge, target: "c" }], b)).toBe(false);
});

it("invalidates placement for every label-affecting edge change", () => {
  const a = [{ id: "edge", source: "a", target: "b", data: {}, hidden: false }];
  const equal = createGrowEdgesEqual();
  for (const patch of [{ id: "new" }, { source: "c" }, { target: "c" }, { data: {} }, { hidden: true }])
    expect(equal(a, [{ ...a[0], ...patch }])).toBe(false);
  expect(equal(a, [])).toBe(false);
});
