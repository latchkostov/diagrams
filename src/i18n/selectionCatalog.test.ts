import { expect, it } from "vitest";
import ar from "./locales/ar.json";
import { format } from "./icu";

it.each([
  ["menu.selectionAddedBoundary", "أضيفت إلى Example"],
  ["menu.selectionRemovedBoundary", "أزيلت من الحدود"],
] as const)("%s preserves every Arabic plural form and localized count", (key, prefix) => {
  for (const count of [0, 1, 2, 3, 7, 11, 99, 100, 101, 102, 1.5, 1000, 5000]) {
    const number = new Intl.NumberFormat("ar").format(count);
    const noun = new Intl.PluralRules("ar").select(count) === "one" ? "عقدة" : "عقد";
    expect(format(ar[key], "ar", { count, name: "Example", selection: "Selection" })).toBe(
      `${prefix}: ${number} ${noun}. Selection.`,
    );
  }
});
