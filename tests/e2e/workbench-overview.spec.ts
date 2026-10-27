import type { Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, gotoLive, expectTheme, pauseClock, waitForCameraIdle, viewportTransform } from "./fixtures";
import { sampledContrast } from "./pngContrast";
import diagram from "../../src/examples/black-friday-commerce.json" with { type: "json" };

for (const theme of ["light", "dark"])
  test(`large Overview names every individual card, reserves headers and filters routes (${theme})`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(
      (theme) => localStorage.setItem("diagrams.settings.v1", JSON.stringify({ themePreference: theme })),
      theme,
    );
    await page.clock.install();
    await gotoLive(page, "./?view=canvas&example=black-friday-commerce&live=1&sim=doors-open&paused=1");
    await expectTheme(page, theme);
    await pauseClock(page);
    await page.getByTestId("live-timeline-input").fill("204");
    await page.getByTestId("live-timeline-input").press("ArrowRight");
    await page.getByTestId("live-view-menu").click();
    await page.getByTestId("view-overview").click();
    await page.clock.runFor(1400);
    await waitForCameraIdle(page);
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-detail-overview", "");
    await expect(page.getByTestId("overview-dig-hint")).toHaveText("Select a service, or a zone name, to focus");
    await expectNodeIdentity(page, diagram.nodes.length);
    for (const group of diagram.groups) {
      const band = await page.getByTestId(`zone-focus-${group.id}`).boundingBox();
      const region = await page.getByTestId(`group-${group.id}`).boundingBox();
      if (!band || !region) throw new Error(`Missing region ${group.id}`);
      expect(band.x).toBeGreaterThanOrEqual(region.x - 0.5);
      // A zone too short for a free band keeps its header immediately above its outline.
      if (band.y < region.y - 0.5) expect(band.y + band.height).toBeLessThanOrEqual(region.y);
      else expect(band.y).toBeGreaterThanOrEqual(region.y - 0.5);
      expect(band.x + band.width).toBeLessThanOrEqual(region.x + region.width + 0.5);
      expect(band.y + band.height).toBeLessThanOrEqual(region.y + region.height + 0.5);
    }
    const headers = await page.getByTestId(/^zone-focus-/).evaluateAll((els) =>
      els.map((el) => {
        const { x, y, width, height } = el.getBoundingClientRect();
        return { x, y, width, height };
      }),
    );
    const cards = await page.getByTestId(/^node-/).evaluateAll((els) =>
      els
        .filter((el) => getComputedStyle(el).visibility === "visible")
        .map((el) => {
          const { x, y, width, height } = el.getBoundingClientRect();
          return { x, y, width, height };
        }),
    );
    for (const header of headers)
      for (const card of cards)
        expect(
          header.x < card.x + card.width &&
            card.x < header.x + header.width &&
            header.y < card.y + card.height &&
            card.y < header.y + header.height,
        ).toBe(false);
    const edges = await page.getByTestId(/^connection-stroke-/).evaluateAll((els) =>
      els.map((el) => {
        const wrapper = el.closest("[data-id]");
        const matrix = (el as SVGPathElement).getScreenCTM();
        if (!wrapper || !matrix) throw new Error("Expected an edge wrapper and screen transform");
        return {
          visible: getComputedStyle(el).visibility === "visible",
          main: wrapper.hasAttribute("data-live-main"),
          near: wrapper.hasAttribute("data-live-near"),
          weight: parseFloat(getComputedStyle(el).strokeWidth) * Math.hypot(matrix.a, matrix.b),
        };
      }),
    );
    expect(edges.some((e) => e.visible)).toBe(true);
    expect(edges.some((e) => !e.visible)).toBe(true);
    for (const edge of edges) {
      expect(edge.visible).toBe(edge.main || edge.near);
      if (edge.visible) expect(edge.weight).toBeGreaterThanOrEqual(1.49);
    }
    const regions = [];
    for (const id of ["group-aws", "group-storefront", "node-checkout-api", "node-web"]) {
      const box = await page.getByTestId(id).boundingBox();
      if (!box) throw new Error(`Missing ${id}`);
      regions.push({ x: box.x - 2, y: box.y + box.height / 2 - 4, width: 4, height: 8, ground: { x: 1410, y: 120 } });
    }
    const png = await page.screenshot();
    const contrast = await sampledContrast(page, png, regions);
    for (const ratio of contrast) expect(ratio, "PNG outline against board").toBeGreaterThanOrEqual(3);
    await info.attach("overview-outline-contrast", {
      body: JSON.stringify({ theme, contrast }),
      contentType: "application/json",
    });
    await info.attach(`07-live-large-overview-${theme}`, { body: png, contentType: "image/png" });
    if (process.env.OVERVIEW_CAPTURE_DIR) {
      await mkdir(process.env.OVERVIEW_CAPTURE_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.OVERVIEW_CAPTURE_DIR, `07-live-large-overview-${theme}.png`) });
    }
    await page.getByTestId("zone-focus-storefront").click();
    await page.clock.runFor(1400);
    await waitForCameraIdle(page);
    await expect(page.getByTestId("node-catalog-bff")).toBeVisible();
    await page.getByTestId("node-catalog-bff").click();
    await expect(page.getByTestId("inspector")).toBeVisible();
  });

/** Check painted glyph sizes and containment, rather than the presence of invisible DOM text. */
async function expectNodeIdentity(page: Page, count: number) {
  await expect(page.getByTestId("card-title")).toHaveCount(count);
  await expect
    .poll(async () =>
      page.getByTestId("card-title").evaluateAll((titles) =>
        titles.flatMap((title) => {
          const card = title.closest('[data-testid^="rf__node-"]');
          const icon = card?.querySelector('[data-testid="card-icon"]')?.firstElementChild;
          const wrap = title.closest('[data-testid="canvas-wrap"]');
          if (!card || !icon || !wrap) return ["Missing identity elements"];
          const zoom = Number((wrap as HTMLElement).style.getPropertyValue("--rf-zoom-exact"));
          const cs = getComputedStyle(title),
            box = title.getBoundingClientRect(),
            bounds = card.getBoundingClientRect();
          const ink = document.createElement("canvas").getContext("2d");
          if (!ink) throw new Error("Missing text measurement context");
          ink.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          ink.letterSpacing = cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing;
          const readable =
            cs.visibility === "visible" &&
            !!title.textContent?.trim() &&
            parseFloat(cs.fontSize) * zoom >= 9 &&
            ink.measureText(title.textContent).width * zoom <= box.width + 0.5 &&
            box.left >= bounds.left - 0.5 &&
            box.right <= bounds.right + 0.5 &&
            getComputedStyle(icon).visibility === "visible" &&
            icon.getBoundingClientRect().height >= Math.min(14, bounds.height - 0.5) - 0.5;
          return readable
            ? []
            : [
                {
                  title: title.textContent,
                  zoom,
                  font: parseFloat(cs.fontSize) * zoom,
                  ink: ink.measureText(title.textContent ?? "").width * zoom,
                  titleWidth: box.width,
                  left: box.left - bounds.left,
                  right: box.right - bounds.right,
                  icon: icon.getBoundingClientRect().height,
                  height: bounds.height,
                },
              ];
        }),
      ),
    )
    .toEqual([]);
  for (const title of await page.getByTestId("card-title").all()) await expect(title).toBeVisible();
  const overlap = await page.getByTestId("card-title").evaluateAll((titles) => {
    const cards = titles.map((title) => {
      const card = title.closest('[data-testid^="rf__node-"]');
      if (!card) throw new Error("Missing title card");
      return card;
    });
    return titles.some((title, i) => {
      const a = title.getBoundingClientRect();
      return cards.some((card, j) => {
        if (i === j) return false;
        const b = card.getBoundingClientRect();
        return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      });
    });
  });
  expect(overlap, "titles stay clear of every other card").toBe(false);
}

for (const theme of ["light", "dark"])
  for (const nodeVariant of ["card", "compact", "iconOnly"])
    test(`delivery-dispatch retains icons and names at 35% and 24% (${theme}, ${nodeVariant})`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.addInitScript(
        ({ theme, nodeVariant }) =>
          localStorage.setItem("diagrams.settings.v1", JSON.stringify({ themePreference: theme, nodeVariant })),
        { theme, nodeVariant },
      );
      await gotoLive(page, "./?view=canvas&example=delivery-dispatch&live=1&paused=1");
      await expectTheme(page, theme);
      await waitForCameraIdle(page);
      const count = await page.getByTestId("card-title").count();
      expect(count).toBeGreaterThan(0);
      for (const target of [0.35, 0.24]) {
        const current = Number((await viewportTransform(page)).match(/scale\(([^)]+)\)/)?.[1]);
        const pane = await page.getByTestId("canvas-wrap").boundingBox();
        if (!pane) throw new Error("Missing canvas");
        await page.getByTestId("canvas-pane").dispatchEvent("wheel", {
          deltaY:
            Math.log2(current / target) / (await page.evaluate(() => (/Mac/.test(navigator.platform) ? 0.02 : 0.002))),
          ctrlKey: true,
          clientX: pane.x + pane.width / 2,
          clientY: pane.y + pane.height / 2,
          bubbles: true,
        });
        await expect
          .poll(async () => Number((await viewportTransform(page)).match(/scale\(([^)]+)\)/)?.[1]))
          .toBeCloseTo(target, 2);
        await waitForCameraIdle(page);
        await expectNodeIdentity(page, count);
        if (target === 0.35 && nodeVariant === "card" && process.env.OVERVIEW_CAPTURE_DIR) {
          await mkdir(process.env.OVERVIEW_CAPTURE_DIR, { recursive: true });
          await page.screenshot({ path: join(process.env.OVERVIEW_CAPTURE_DIR, `delivery-dispatch-35-${theme}.png`) });
        }
      }
    });
