import type { Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, gotoLive, expectTheme, pauseClock, waitForCameraIdle, viewportTransform } from "./fixtures";
import { sampledContrast } from "./pngContrast";
import diagram from "../../src/examples/black-friday-commerce.json" with { type: "json" };
import delivery from "../../src/examples/delivery-dispatch.json" with { type: "json" };

for (const theme of ["light", "dark"])
  test(`large Overview names every individual card and zone, and filters routes (${theme})`, async ({ page }, info) => {
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
    // Owner decision: titles occupy a reserved band above the outline, clear of all parts (and of every chip).
    for (const group of diagram.groups) {
      const chip = page.getByTestId(`zone-focus-${group.id}`);
      await expect(chip).toBeVisible();
      await expect(chip).toContainText(group.label);
      const box = await chip.boundingBox();
      const region = await page.getByTestId(`group-${group.id}`).boundingBox();
      if (!box || !region) throw new Error(`Missing region ${group.id}`);
      const clear = await chip.evaluate((el) => {
        const a = el.getBoundingClientRect();
        const root = el.closest('[data-testid="canvas-wrap"]');
        if (!root) throw new Error("Missing canvas");
        return [...root.querySelectorAll('[data-testid="card-title"]')].every((title) => {
          const b = title.parentElement?.getBoundingClientRect();
          return b && (a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
        });
      });
      expect(clear, `${group.id} header clears every chip`).toBe(true);
      expect(box.x + box.width).toBeGreaterThanOrEqual(region.x);
      expect(box.x).toBeLessThanOrEqual(region.x + region.width);
      expect(box.y + box.height).toBeLessThanOrEqual(region.y);
    }
    const titleCollisions = await page.getByTestId("canvas-wrap").evaluate((root) => {
      const titles = [...root.querySelectorAll('[data-testid^="zone-focus-"]')];
      const cards = [...root.querySelectorAll('[data-testid^="node-"]')].filter((el) =>
        el.querySelector('[data-testid="card-title"]'),
      );
      const overlap = (a: Element, b: Element) => {
        const x = a.getBoundingClientRect(),
          y = b.getBoundingClientRect();
        return x.left < y.right && x.right > y.left && x.top < y.bottom && x.bottom > y.top;
      };
      return titles.flatMap((title, i) =>
        [...cards, ...titles.slice(i + 1)]
          .filter((part) => overlap(title, part))
          .map((part) => [title.getAttribute("data-testid"), part.getAttribute("data-testid")]),
      );
    });
    expect(titleCollisions).toEqual([]);
    const edges = await page.getByTestId(/^connection-stroke-/).evaluateAll((els) =>
      els.map((el) => {
        const wrapper = el.closest("[data-id]");
        const matrix = (el as SVGPathElement).getScreenCTM();
        if (!wrapper || !matrix) throw new Error("Expected an edge wrapper and screen transform");
        return {
          visible: getComputedStyle(el).visibility === "visible",
          main: wrapper.hasAttribute("data-live-main"),
          near: wrapper.hasAttribute("data-live-near"),
          weight:
            parseFloat(getComputedStyle(el).strokeWidth) *
            (getComputedStyle(el).vectorEffect === "non-scaling-stroke" ? 1 : Math.hypot(matrix.a, matrix.b)),
        };
      }),
    );
    expect(edges.some((e) => e.visible)).toBe(true);
    expect(edges.some((e) => !e.visible)).toBe(true);
    for (const edge of edges) {
      expect(edge.visible).toBe(edge.main || edge.near);
      if (edge.visible) {
        expect(edge.weight).toBeGreaterThanOrEqual(1);
        expect(edge.weight).toBeLessThanOrEqual(3.5);
      }
    }
    const regions = [];
    for (const id of ["group-aws", "group-storefront", "node-checkout-api", "node-web"]) {
      const box = await page.getByTestId(id).evaluate((el) => {
        const title = el.querySelector('[data-testid="card-title"]');
        const surface = title?.parentElement ?? el;
        const b = surface.getBoundingClientRect();
        const root = el.closest('[data-testid="canvas-wrap"]');
        if (!root) throw new Error("Missing outline canvas");
        const blockers = [...root.querySelectorAll('[data-testid="card-title"],[data-testid^="zone-focus-"]')]
          .map((n) => (n.getAttribute("data-testid") === "card-title" ? n.parentElement : n))
          .filter((n): n is HTMLElement => n instanceof HTMLElement && n !== surface)
          .map((n) => n.getBoundingClientRect());
        const ys = [b.y + b.height / 2, ...Array.from({ length: 14 }, (_, i) => b.y + (b.height * (i + 1)) / 16)];
        const y = ys.find((y) =>
          blockers.every((r) => b.x + 2 < r.left || b.x - 2 > r.right || y + 4 < r.top || y - 4 > r.bottom),
        );
        if (y === undefined) throw new Error("No exposed outline segment");
        return { x: b.x, y, width: b.width, height: b.height };
      });
      if (!box) throw new Error(`Missing ${id}`);
      regions.push({ x: box.x - 2, y: box.y - 4, width: 4, height: 8, ground: { x: 1410, y: 120 } });
    }
    const png = await page.screenshot();
    const contrast = await sampledContrast(page, png, regions);
    for (const [i, ratio] of contrast.entries())
      expect(
        ratio,
        `PNG outline against board (${["aws", "storefront", "checkout", "web"][i]})`,
      ).toBeGreaterThanOrEqual(3);
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
          const chip = title.parentElement?.getAttribute("aria-label") === title.getAttribute("data-label");
          const card = chip ? title.parentElement : title.closest('[data-testid^="rf__node-"]');
          const tile = card?.querySelector('[data-testid="card-icon"]');
          const icon = chip ? tile : tile?.firstElementChild;
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
            Math.max(...title.textContent.split("\n").map((line) => ink.measureText(line).width)) * zoom <=
              box.width + 0.5 &&
            box.left >= bounds.left - 0.5 &&
            box.right <= bounds.right + 0.5 &&
            getComputedStyle(icon).visibility === "visible" &&
            icon.getBoundingClientRect().height >= Math.min(chip ? 12 : 14, bounds.height - 0.5) - 0.5;
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
      const card =
        title.parentElement?.getAttribute("aria-label") === title.getAttribute("data-label")
          ? title.parentElement
          : title.closest('[data-testid^="rf__node-"]');
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
      const count = delivery.nodes.length;
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
        for (const { id } of delivery.nodes) await expect(page.getByTestId(`node-${id}`)).toBeAttached();
        await expectNodeIdentity(page, count);
        if (target === 0.35 && nodeVariant === "card" && process.env.OVERVIEW_CAPTURE_DIR) {
          await mkdir(process.env.OVERVIEW_CAPTURE_DIR, { recursive: true });
          await page.screenshot({ path: join(process.env.OVERVIEW_CAPTURE_DIR, `delivery-dispatch-35-${theme}.png`) });
        }
      }
    });
