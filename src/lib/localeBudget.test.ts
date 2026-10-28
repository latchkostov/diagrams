import { expect, it } from "vitest";
import {
  checkLocaleSizes,
  checkCoreLocaleSizes,
  CORE_LOCALE_BUDGET,
  LOCALE_BUDGET,
} from "../../scripts/locale-budget.mjs";

it("gates every locale, accepts the boundary and allows English-only copies", () => {
  expect(checkLocaleSizes([{ file: "ru.js", gzip: LOCALE_BUDGET }])?.gzip).toBe(LOCALE_BUDGET);
  expect(() =>
    checkLocaleSizes([
      { file: "de.js", gzip: 1 },
      { file: "ru.js", gzip: LOCALE_BUDGET + 1 },
    ]),
  ).toThrow("ru.js");
  expect(checkLocaleSizes([])).toBeUndefined();
});

it("gates core separately and the complete set by summed transfer bytes", () => {
  expect(checkCoreLocaleSizes([{ file: "ar-core-hash.js", gzip: CORE_LOCALE_BUDGET }])?.gzip).toBe(CORE_LOCALE_BUDGET);
  expect(() => checkLocaleSizes([{ file: "ar-core-hash.js", gzip: CORE_LOCALE_BUDGET + 1 }])).toThrow(
    "core locale budget",
  );
  expect(() =>
    checkLocaleSizes([
      { file: "ru-core-hash.js", gzip: CORE_LOCALE_BUDGET },
      { file: "ru-tutorials-hash.js", gzip: LOCALE_BUDGET - CORE_LOCALE_BUDGET + 1 },
    ]),
  ).toThrow("locale budget: ru:");
  expect(checkCoreLocaleSizes([])).toBeUndefined();
});
