import { test, expect, gotoGallery, expectNoErrors } from "./fixtures";

const tiles = (page: import("@playwright/test").Page) => page.getByTestId(/^stencil-tile-/);

test.describe("gallery", () => {
  test("loads every stencil and reports the count", async ({ page, consoleErrors }) => {
    await gotoGallery(page);
    const count = await tiles(page).count();
    expect(count).toBeGreaterThan(50);
    await expect(page.getByTestId("stencil-count")).toContainText(`${count} stencils from`);
    await expect(page.getByTestId("stencil-count")).not.toContainText("missing");
    expectNoErrors(consoleErrors);
  });

  test("search filters the tiles", async ({ page }) => {
    await gotoGallery(page);
    const total = await tiles(page).count();
    await page.getByTestId("gallery-search").fill("kafka");
    await expect(page.getByTestId("stencil-tile-kafka.topic")).toBeVisible();
    await expect(page.getByTestId("stencil-tile-postgres")).toHaveCount(0);
    const filtered = await tiles(page).count();
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThan(total);
    await expect(page.getByTestId("stencil-count")).toHaveText(`${filtered} of ${total} stencils`);

    await page.getByTestId("gallery-search").fill("zzz-no-such-stencil");
    await expect(tiles(page)).toHaveCount(0);
    await expect(page.getByTestId("stencil-count")).toHaveText(`0 of ${total} stencils`);
  });

  test("slash focuses search", async ({ page }) => {
    await gotoGallery(page);
    await page.keyboard.press("/");
    await expect(page.getByTestId("gallery-search")).toBeFocused();
  });

  test("vendor chip filters to that vendor and toggles off", async ({ page }) => {
    await gotoGallery(page);
    const total = await tiles(page).count();
    const chip = page.getByTestId("vendor-chip-azure");
    const chipCount = Number((await chip.textContent())!.match(/(\d+)\s*$/)![1]);
    await chip.click();
    await expect(tiles(page)).toHaveCount(chipCount);
    await expect(page.getByTestId("stencil-tile-azure.functions")).toBeVisible();
    await expect(page.getByTestId("stencil-tile-kafka.topic")).toHaveCount(0);
    await chip.click();
    await expect(tiles(page)).toHaveCount(total);
    await page.getByTestId("vendor-chip-azure").click();
    await page.getByTestId("vendor-chip-all").click();
    await expect(tiles(page)).toHaveCount(total);
  });

  test("every stencil tile shows an icon that actually loaded", async ({ page }) => {
    await gotoGallery(page);
    // Scoped by testid; the only <img> in a tile is the stencil icon.
    const broken = await tiles(page).evaluateAll(async (els) => {
      const bad: string[] = [];
      for (const el of els) {
        const imgs = [...el.querySelectorAll("img")];
        if (!imgs.length) {
          bad.push(`${el.getAttribute("data-testid")}: no <img>`);
          continue;
        }
        for (const img of imgs) {
          if (!img.complete)
            await new Promise((r) => {
              img.addEventListener("load", r, { once: true });
              img.addEventListener("error", r, { once: true });
            });
          if (!(img.naturalWidth > 0)) bad.push(`${el.getAttribute("data-testid")}: ${img.getAttribute("src")}`);
        }
      }
      return bad;
    });
    expect(broken, broken.join("\n")).toEqual([]);
  });

  test("category rail lists every category with a count", async ({ page }) => {
    await gotoGallery(page);
    for (const c of ["messaging", "compute", "data", "network", "observability", "security", "clients", "generic"]) {
      await expect(page.getByTestId(`rail-${c}`)).toBeEnabled();
      await expect(page.getByTestId(`gallery-section-${c}`)).toBeVisible();
    }
  });
});
