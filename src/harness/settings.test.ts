import { afterEach, expect, it, vi } from "vitest";
import { initialSettings } from "./settings";

afterEach(() => vi.unstubAllGlobals());
function stored(value: unknown, dark = false) {
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(value) });
  vi.stubGlobal("window", { matchMedia: () => ({ matches: dark }) });
  return initialSettings();
}
it("keeps a legacy explicit theme and the library pin", () => {
  expect(stored({ theme: "light", libraryPinned: true }, true)).toMatchObject({
    theme: "light",
    themePreference: "light",
    libraryPinned: true,
  });
});
it("resolves Match system from the device rather than a stale saved effective theme", () => {
  expect(stored({ theme: "light", themePreference: "system" }, true)).toMatchObject({
    theme: "dark",
    themePreference: "system",
  });
  expect(stored({ theme: "dark", themePreference: "system" })).toMatchObject({
    theme: "light",
    themePreference: "system",
  });
});
it("falls back to the device for an invalid preference", () => {
  expect(stored({ themePreference: "invalid" }, true)).toMatchObject({ theme: "dark", themePreference: "system" });
});
