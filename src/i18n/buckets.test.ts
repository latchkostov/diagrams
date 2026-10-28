import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { coreCatalogs, surfaceCatalogs, catalogs } from "virtual:i18n/catalogs";
import { catalogBucket, catalogBuckets, lintCatalogBuckets } from "../../scripts/i18n-plugin";
import en from "./en";

it("assigns every key exactly once and rejects missing or overlapping prefixes", () => {
  expect(() => lintCatalogBuckets()).not.toThrow();
  expect(() => catalogBucket("newSurface.title")).toThrow("exactly one");
  catalogBuckets.core.push("tutorials");
  try {
    expect(() => lintCatalogBuckets()).toThrow("exactly one");
  } finally {
    catalogBuckets.core.pop();
  }
  expect(catalogBucket("tutorials.loading")).toBe("core");
  expect(catalogBucket("tutorials.runtime.title")).toBe("tutorialTitles");
  expect(catalogBucket("stencil.genericDatabaseName")).toBe("core");
  expect(catalogBucket("autoscaling.minCount")).toBe("simulation");
});

it.each(["de", "ar", "ru", "en-XA"])(
  "%s: core omits optional text and merging restores the full catalog",
  async (code) => {
    const core = (await coreCatalogs[code]()).default;
    const optional = await Promise.all(Object.values(surfaceCatalogs[code]).map((load) => load!()));
    const merged = Object.assign({}, core, ...optional.map((m) => m.default));
    const full = (await catalogs[code]()).default;
    // Compare function source too: ICU plurals and rich placeholders retain the same compiler/helpers.
    const source = (messages: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(messages).map(([k, v]) => [k, String(v)]));
    expect(source(merged)).toEqual(source(full));
    const keys = Object.keys(en).sort();
    expect(core[keys.indexOf("tutorials.runtime.title")]).toBeUndefined();
    expect((core as Record<string, unknown>)[en["tutorials.runtime.title"]]).toBeUndefined();
    expect(Object.keys(core).length).toBeLessThan(Object.keys(full).length);
  },
);

// Shared shell components render before optional catalog readiness on multiple surfaces.
it("keeps every message used by eagerly rendered shell components in core", () => {
  const files = [
    "src/App.tsx",
    "src/components/TopBar.tsx",
    "src/interop/ui/menus.tsx",
    "src/canvas/chrome/ToolRail.tsx",
    "src/canvas/chrome/CanvasControls.tsx",
    "src/canvas/chrome/PrivateBadge.tsx",
    "src/canvas/Inspector.tsx",
    "src/canvas/inspector/DockTabs.tsx",
    "src/components/ModeSwitch.tsx",
    "src/canvas/StartCard.tsx",
    "src/canvas/chrome/CanvasOverlays.tsx",
    "src/ai/ui/events.ts",
    "src/ai/ui/unseen.ts",
  ];
  const optional: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const [, key] of source.matchAll(/\b(?:t|msg|tRich)\("([^"]+)"/g))
      if (catalogBucket(key) !== "core") optional.push(`${file}: ${key}`);
  }
  expect(optional).toEqual([]);
});

it("loads command titles separately from tutorial lesson text", async () => {
  const titles = (await surfaceCatalogs.de.tutorialTitles!()).default as Record<string, unknown>;
  const lessons = (await surfaceCatalogs.de.tutorials!()).default as Record<string, unknown>;
  const full = (await catalogs.de()).default as Record<string, unknown>;
  const key = Object.keys(en).sort().indexOf("tutorials.mobileApi.title");
  const lookup = Object.hasOwn(full, key) ? key : en["tutorials.mobileApi.title"];
  expect(String(titles[lookup])).toBe(String(full[lookup]));
  expect(lessons[lookup]).toBeUndefined();
  expect(Object.keys(titles).length).toBeLessThan(Object.keys(lessons).length / 8);
});

it("keeps command discovery messages within its requested catalogs", () => {
  for (const file of ["src/palette/PaletteDialog.tsx", "src/palette/sources.ts", "src/palette/rank.ts"]) {
    for (const [, key] of readFileSync(file, "utf8").matchAll(/\b(?:t|msg|tRich)\("([^"]+)"/g))
      expect(["core", "tutorialTitles", "stencils"], `${file}: ${key}`).toContain(catalogBucket(key));
  }
});
