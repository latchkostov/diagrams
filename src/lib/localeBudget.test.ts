import { expect, it } from "vitest";
import { checkLocaleSizes, LOCALE_BUDGET } from "../../scripts/locale-budget.mjs";

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
