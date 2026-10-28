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
  expect(catalogBucket("tutorials.runtime.title")).toBe("tutorials");
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
