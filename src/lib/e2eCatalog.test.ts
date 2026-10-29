import { expect, it } from "vitest";
import { catalogRequest } from "../../scripts/e2e-catalog";

it.each(["de", "ar", "pt-BR", "en-XA"])("intercepts %s core and surface catalogs in both servers", (code) => {
  for (const bucket of ["core", "stencils", "tutorials", "simulation", "ai"]) {
    for (const suffix of ["", "?import", "?t=123"]) {
      expect(catalogRequest(code).test(`http://localhost:6480/assets/${code}-${bucket}-aB9_x-2.js${suffix}`)).toBe(
        true,
      );
      expect(
        catalogRequest(code).test(`http://localhost:6481/@id/__x00__virtual:i18n/catalog/${code}-${bucket}${suffix}`),
      ).toBe(true);
    }
  }
});

it("holds only the selected language and surface buckets", () => {
  const request = catalogRequest("de", "stencils|simulation");
  for (const url of [
    "/assets/de-stencils-aB9_x-2.js",
    "/assets/de-simulation-aB9_x-2.js?import",
    "/@id/__x00__virtual:i18n/catalog/de-stencils",
    "/@id/__x00__virtual:i18n/catalog/de-simulation?t=123",
  ])
    expect(request.test(url), url).toBe(true);
  for (const url of [
    "/assets/ar-stencils-aB9_x-2.js",
    "/assets/de-core-aB9_x-2.js",
    "/@id/__x00__virtual:i18n/catalog/de-core",
    "/@id/__x00__virtual:i18n/catalog/de-stencils-extra",
    "/assets/de-stencils-aB9_x-2Xjs",
  ])
    expect(request.test(url), url).toBe(false);
});
