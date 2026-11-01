import { test, expect, gotoCanvas, openLibrary, STORAGE_KEYS } from "./fixtures";
import { lazySurfacesFixture } from "../../src/lab/lazySurfacesFixture";

for (const mode of ["build", "dev"])
  test(
    `the stencil library fetches visible artwork without fetching the whole catalog${mode === "dev" ? " (dev server)" : ""}`,
    { tag: mode === "dev" ? "@dev" : [] },
    async ({ page }) => {
      await page.addInitScript(({ diagram, key }) => localStorage.setItem(key, JSON.stringify(diagram)), {
        diagram: lazySurfacesFixture(),
        key: STORAGE_KEYS.autosavePrefix + "blocking-call",
      });
      await gotoCanvas(page, "blocking-call");
      const requests = new Set<string>();
      page.on("request", (request) => {
        // Dev artwork lives under /src; ?import module requests are not image downloads.
        if (request.resourceType() === "image" && /\.svg(?:\?|$)/.test(request.url())) requests.add(request.url());
      });
      await openLibrary(page);
      await page.getByTestId("palette-search").fill("a");
      const menu = page.getByTestId("palette");
      await expect
        .poll(() =>
          menu.evaluate((element) => {
            const visible = Array.from(element.querySelectorAll('[data-testid^="palette-item-"]')).flatMap((holder) => {
              const image = holder.firstElementChild?.firstElementChild;
              if (!(image instanceof HTMLImageElement)) return [];
              const box = image.getBoundingClientRect();
              const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
              return hit && holder.contains(hit) ? [image] : [];
            });
            return visible.length > 0 && visible.every((image) => image.complete && image.naturalWidth > 0);
          }),
        )
        .toBe(true);
      const icons = await menu.evaluate((element) =>
        Array.from(element.querySelectorAll('[data-testid^="palette-item-"]')).flatMap((holder) => {
          const image = holder.firstElementChild?.firstElementChild;
          const id = holder.getAttribute("data-testid");
          return id && image instanceof HTMLImageElement ? [{ id, src: image.src }] : [];
        }),
      );
      const sources = new Set(icons.map((icon) => icon.src));
      const fetched = [...requests].filter((url) => sources.has(url)).length;
      expect(fetched).toBeGreaterThan(0);
      expect(fetched).toBeLessThanOrEqual(Math.min(24, Math.ceil(icons.length / 8)));
      const last = icons.at(-1);
      expect(last).toBeDefined();
      if (!last) throw new Error("Expected stencil artwork in the library");
      const lastIcon = page.getByTestId(last.id);
      await lastIcon.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          lastIcon.evaluate((holder) => {
            const image = holder.firstElementChild?.firstElementChild;
            return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
          }),
        )
        .toBe(true);
    },
  );
