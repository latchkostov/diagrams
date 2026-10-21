import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, savedDiagram, STORAGE_KEYS, waitForSelectionSettled } from "./fixtures";

const slug = "kafka-order-pipeline";
async function seed(page: Page, diagram: object) {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    STORAGE_KEYS.autosavePrefix + slug,
    JSON.stringify({ format: "diagrams/v1", title: "Deferred canvas", nodes: [], edges: [], ...diagram }),
  ] as const);
}

for (const gesture of ["double-click", "F2"] as const)
  test(`boundary rename survives a delayed inspector download: ${gesture}`, async ({ page }) => {
    test.skip(process.env.E2E_TARGET !== "build", "Checks the production chunk boundary");
    const held = Promise.withResolvers<undefined>();
    let requested = false;
    await page.route(/\/assets\/GroupPanel-[^/]+\.js$/, async (route) => {
      requested = true;
      await held.promise;
      await route.continue();
    });
    try {
      await seed(page, { groups: [{ id: "region", label: "Region", x: 0, y: 0, width: 500, height: 300 }] });
      await gotoCanvas(page, slug);
      const boundary = page.getByTestId("group-label-region");
      if (gesture === "double-click") await boundary.dblclick();
      else {
        await boundary.click();
        await waitForSelectionSettled(page);
        await page.keyboard.press("F2");
      }
      await expect.poll(() => requested).toBe(true);
      await waitForSelectionSettled(page);
      const label = page.getByTestId("inspector-field-label");
      await expect(label).toHaveCount(0);
      held.resolve(undefined);
      await expect(label).toBeFocused();
      expect(await label.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 6]);
      await page.keyboard.type("West region");
      await expect(boundary).toContainText("West region");
      await expect.poll(async () => (await savedDiagram(page)).groups?.[0].label).toBe("West region");
    } finally {
      held.resolve(undefined);
    }
  });

for (const outcome of ["ready", "failed"] as const)
  for (const kind of ["png", "svg"] as const)
    test(`${kind} export waits for deferred geometry: ${outcome}`, async ({ page, context }) => {
      test.skip(process.env.E2E_TARGET !== "build", "Checks the production chunk boundary");
      const held = Promise.withResolvers<undefined>();
      let requested = false;
      await page.route(/\/assets\/extendedGeometry-[^/]+\.js$/, async (route) => {
        requested = true;
        await held.promise;
        if (outcome === "failed") await route.abort("failed");
        else await route.continue();
      });
      // Observe the SVG used to rasterize PNG, so both exports must contain the real outline.
      await page.addInitScript(() => {
        const query = Document.prototype.querySelector;
        Document.prototype.querySelector = function (selector: string) {
          const result = query.call(this, selector);
          if (selector === '[data-testid="canvas-wrap"] .react-flow__viewport')
            document.documentElement.dataset.imageCaptureStarted = "1";
          return result;
        };
        const decode = HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode = function () {
          if (this.src.startsWith("data:image/svg+xml"))
            document.documentElement.dataset.exportSvg = decodeURIComponent(this.src.slice(this.src.indexOf(",") + 1));
          return decode.call(this);
        };
      });
      try {
        await seed(page, {
          annotations: [
            { id: "cloud", kind: "shape", shape: "doc", text: "Cloud", x: 0, y: 0, width: 200, height: 120 },
          ],
        });
        await gotoCanvas(page, slug);
        await expect.poll(() => requested).toBe(true);
        const outline = page.getByTestId("annotation-cloud").getByTestId("shape-outline");
        expect(await outline.evaluate((el) => el.firstElementChild?.tagName)).toBe("rect");
        let downloads = 0;
        page.on("download", () => downloads++);
        await page.getByTestId("file-button").click();
        if (kind === "png") await page.getByTestId("export-png").click();
        else {
          await page.getByTestId("file-more-formats").click();
          await page.getByTestId("export-image").click();
          await page.getByTestId("image-options-toggle").click();
          await page.getByTestId("image-format-svg").click();
          await page.getByTestId("image-export").click();
        }
        await expect(page.getByTestId("image-export-cancel")).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.dataset.imageCaptureStarted)).toBe("1");
        await page.evaluate(
          () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        expect(downloads).toBe(0);
        const downloaded = outcome === "ready" ? page.waitForEvent("download") : undefined;
        held.resolve(undefined);
        if (outcome === "failed") {
          await expect(page.getByTestId("toast").filter({ hasText: "export" })).toHaveAttribute("data-kind", "error");
          await expect(page.getByTestId("image-export-cancel")).toHaveCount(0);
          expect(downloads).toBe(0);
          return;
        }
        if (!downloaded) throw new Error("Missing expected download");
        const download = await downloaded;
        expect(await download.failure()).toBeNull();
        const path = await download.path();
        if (!path) throw new Error("Image download failed");
        const svg =
          kind === "svg"
            ? readFileSync(path, "utf8")
            : await page.evaluate(() => document.documentElement.dataset.exportSvg);
        if (!svg) throw new Error("Missing exported SVG");
        const exported = await context.newPage();
        try {
          await exported.setContent(svg);
          const captured = exported.getByTestId("annotation-cloud").getByTestId("shape-outline");
          expect(await captured.evaluate((el) => el.firstElementChild?.tagName)).toBe("path");
          expect(await captured.evaluate((el) => el.firstElementChild?.getAttribute("d"))).toBe(
            await outline.evaluate((el) => el.firstElementChild?.getAttribute("d")),
          );
        } finally {
          await exported.close();
        }
      } finally {
        held.resolve(undefined);
      }
    });
