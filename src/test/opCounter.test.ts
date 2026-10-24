import { expect, it } from "vitest";
import { opGrowth, ops } from "./opCounter";
import { validateFragment } from "../../scripts/fragments";
import { callbacks, linear, quadratic, trim, serialize, optionalTrim, optionalSlice } from "./opCounterFixture";

it("does not instrument tooling outside src when the checkout itself is under a src directory", () => {
  expect(ops(() => validateFragment("2026-10-23-test.md", "## Test\nText"))).toBe(0);
});

it("preserves short-circuiting through optional property and call chains", () => {
  expect(optionalTrim()).toBeUndefined();
  expect(optionalSlice()).toBeUndefined();
  expect(optionalTrim({ label: " x " })).toBe("x");
  expect(optionalSlice({ label: " abc " })).toBe("ab");
});

it("counts actual loop iterations and callback entries, including nested loops", () => {
  expect(ops(() => linear(10))).toBe(11);
  expect(ops(() => quadratic(10))).toBe(111);
  expect(ops(() => callbacks(10))).toBe(21);
  expect(
    opGrowth(
      () => linear(100),
      () => linear(800),
    ),
  ).toBeLessThan(9);
  expect(
    opGrowth(
      () => quadratic(100),
      () => quadratic(800),
      Infinity,
    ),
  ).toBeGreaterThan(24);
});

it("counts native trimming work and distinguishes slicing before trimming", () => {
  expect(
    opGrowth(
      () => trim(" ".repeat(100)),
      () => trim(" ".repeat(800)),
    ),
  ).toBeGreaterThan(7);
  expect(
    opGrowth(
      () => trim(" ".repeat(100).slice(0, 10)),
      () => trim(" ".repeat(800).slice(0, 10)),
    ),
  ).toBe(1);
});

it("counts characters serialized by native JSON, including repeated growing prefixes", () => {
  expect(
    opGrowth(
      () => serialize(100),
      () => serialize(800),
    ),
  ).toBeLessThan(9);
  const repeated = (n: number) => {
    for (let i = 1; i <= n; i++) serialize(i);
  };
  expect(
    opGrowth(
      () => repeated(100),
      () => repeated(800),
      Infinity,
    ),
  ).toBeGreaterThan(24);
  expect(() =>
    opGrowth(
      () => repeated(100),
      () => repeated(800),
    ),
  ).toThrow("Operation budget exceeded");
});

it("restores scopes on nesting and errors, and rejects unobserved work", () => {
  expect(
    ops(() => {
      linear(10);
      ops(() => quadratic(10));
      linear(10);
    }),
  ).toBe(22);
  expect(() =>
    ops(() => {
      throw new Error("fixture");
    }),
  ).toThrow("fixture");
  expect(ops(() => linear(10))).toBe(11);
  expect(() =>
    opGrowth(
      () => undefined,
      () => undefined,
    ),
  ).toThrow("No operation probes");
  expect(() => ops(() => Promise.resolve())).toThrow("synchronous");
});
