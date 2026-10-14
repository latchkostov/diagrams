import { afterEach, expect, it, vi } from "vitest";
import { state } from "./core";
import { formatNumber } from "./number";

afterEach(() => {
  state.l = "en";
  vi.restoreAllMocks();
});
it("reuses value-equivalent formatter options and separates locales and option values", () => {
  const constructor = vi.spyOn(Intl, "NumberFormat");
  state.l = "de";
  expect(formatNumber(1234.5, { useGrouping: false, maximumFractionDigits: 1 })).toBe("1234,5");
  for (let i = 0; i < 27; i++) formatNumber(i, { maximumFractionDigits: 1, useGrouping: false });
  expect(constructor).toHaveBeenCalledTimes(1);
  expect(formatNumber(1234.5, { useGrouping: true, maximumFractionDigits: 1 })).toBe("1.234,5");
  state.l = "en";
  expect(formatNumber(1234.5, { useGrouping: false, maximumFractionDigits: 1 })).toBe("1234.5");
  expect(constructor).toHaveBeenCalledTimes(3);
});
