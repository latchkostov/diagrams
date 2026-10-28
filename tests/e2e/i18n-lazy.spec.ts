import { readFileSync } from "node:fs";
import en from "../../src/i18n/en";
import { test, expect, gotoCanvas } from "./fixtures";
import { holdChunk } from "./chunk";
import { openSurface } from "./lazy-surface-helpers";

for (const code of ["de", "ar", "ru"]) {
  test(`${code}: first canvas renders while every optional catalog is held`, async ({ page }) => {
    await page.addInitScript((locale) => localStorage.setItem("diagrams.locale", locale), code);
    const held = await holdChunk(
      page,
      new RegExp(String.raw`/assets/${code}-(?:tutorials|stencils|simulation|exports|ai)-[\w-]+\.js(?:\?|$)`),
    );
    try {
      await gotoCanvas(page, "kafka-order-pipeline");
      const words = JSON.parse(readFileSync(`src/i18n/locales/${code}.json`, "utf8")) as Record<string, string>;
      await expect(page.getByTestId("file-button")).toContainText(words["file.menu"]);
      expect(await page.evaluate(() => document.documentElement.lang)).toBe(code);
    } finally {
      held.release();
    }
  });
}

const cases = [
  { id: "tutorial.app", bucket: "tutorials", pending: "tutorial-app-loading", ready: "tutorial-start" },
  { id: "canvas.stencils", bucket: "stencils", pending: "palette-loading", ready: "palette-item-generic.database" },
  {
    id: "inspector.simulation",
    bucket: "simulation",
    pending: "inspector.simulation-loading",
    ready: "inspector-section-node-simulation",
  },
] as const;
for (const code of ["de", "ar"]) {
  const words = JSON.parse(readFileSync(`src/i18n/locales/${code}.json`, "utf8")) as Record<string, string>;
  for (const surface of cases) {
    test(`${code}: ${surface.id} holds its catalog, recovers with Retry and preserves interaction`, async ({
      page,
    }) => {
      await page.addInitScript((locale) => localStorage.setItem("diagrams.locale", locale), code);
      const pattern = new RegExp(
        `/(?:assets/${code}-${surface.bucket}-[\\w-]+\\.js|@id/__x00__virtual:i18n/catalog/${code}-${surface.bucket})(?:\\?|$)`,
      );
      const held = await holdChunk(page, pattern);
      try {
        await openSurface(page, surface.id);
        await expect.poll(held.requested).toBe(true);
        await expect(page.getByTestId(surface.pending)).toBeVisible();
        await expect(page.getByTestId(surface.ready)).toHaveCount(0);
        await expect(page.getByTestId(surface.pending)).toContainText(
          words[surface.id === "tutorial.app" ? "tutorials.loading" : "common.loading"],
        );
        expect(await page.evaluate(() => document.documentElement.dir)).toBe(code === "ar" ? "rtl" : "ltr");
        expect(await page.evaluate(() => getComputedStyle(document.body).cursor)).not.toMatch(/wait|progress/);
        if (surface.id === "canvas.stencils") {
          await page.getByTestId("palette-toggle").click();
          await page.getByTestId("palette-search").fill("generic.database");
          await expect(page.getByTestId("palette-search")).toBeFocused();
        }
        if (surface.id === "inspector.simulation") {
          await expect(page.getByTestId("inspector-field-label")).toBeFocused();
          await page.getByTestId("inspector-field-label").fill("Caller translated later");
          await expect(page.getByTestId("node-caller")).toContainText("Caller translated later");
        }
        if (code === "de" && surface.id === "canvas.stencils") {
          await page.getByTestId("file-button").click();
          await page.getByTestId("file-more-formats").click();
          await page.getByTestId("export-image").click();
          await page.getByTestId("image-options-toggle").click();
          await page.getByTestId("image-format-svg").click();
          const download = page.waitForEvent("download");
          await page.getByTestId("image-export").click();
          const svg = await download;
          expect(svg.suggestedFilename()).toMatch(/\.svg$/);
          expect(await svg.failure()).toBeNull();
          await page.keyboard.press("Escape");
        }
        // These optional editing surfaces never block image export/recording readiness.
        await page.evaluate(async () => {
          await window.__lazySurfaces?.ensureLoaded();
        });
        held.fail = true;
        held.release();
        await expect(page.getByTestId("lazy-load-retry")).toBeVisible();
        await expect(page.getByTestId("lazy-load-retry")).toHaveText(words["common.retry"]);
        await expect(page.getByTestId("toast").filter({ has: page.getByTestId("lazy-load-retry") })).toContainText(
          words["ai.loadFailed"],
        );
        await expect(page.getByTestId(surface.ready)).toHaveCount(0);
        held.fail = false;
        await page.getByTestId("lazy-load-retry").click();
        await expect(page.getByTestId(surface.ready)).toBeVisible();
        await expect(page.getByTestId(surface.pending)).toHaveCount(0);
        if (surface.id === "canvas.stencils") {
          await expect(page.getByTestId(surface.ready)).toContainText(words["stencil.genericDatabaseName"]);
          await expect(page.getByTestId(surface.ready)).toHaveAttribute(
            "title",
            `${words["stencil.genericDatabaseName"]} (${words["stencil.vendorGeneric"]})\n${words["stencil.genericDatabaseDescription"]}`,
          );
          await expect(page.getByTestId("palette-search")).toHaveValue("generic.database");
          await expect(page.getByTestId("palette-search")).toBeFocused();
        } else if (surface.id === "tutorial.app") {
          await expect(page.getByTestId("tutorial-app")).toContainText(words["tutorials.mobileApi.title"]);
          await expect(page.getByTestId("tutorial-start")).toBeFocused();
        } else {
          await expect(page.getByTestId(surface.ready)).toContainText(
            words["inspector.simulation"] ?? en["inspector.simulation"],
          );
          await expect(page.getByTestId("inspector-field-label")).toHaveValue("Caller translated later");
        }
      } finally {
        held.release();
      }
    });
  }
}
