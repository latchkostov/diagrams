import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect, gotoCanvas, gotoLive, expectTheme, pauseClock, waitForCameraIdle } from "./fixtures";

for (const theme of ["light", "dark"]) {
  test.describe(`workbench follow-ups (${theme})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(
        (theme) => localStorage.setItem("diagrams.settings.v1", JSON.stringify({ themePreference: theme })),
        theme,
      );
    });

    test("editing pins have one orthogonal connection and stay inside the seam", async ({ page }, info) => {
      await gotoCanvas(page, "outbox-saga-checkout");
      await page.getByTestId("node-order-api").click();
      await page.getByTestId("view-focus").click();
      await waitForCameraIdle(page);
      await expectTheme(page, theme);
      const pin = page.getByTestId("focus-offscreen-saga");
      await expect(pin).toBeVisible();
      const frame = await page.getByTestId("canvas-wrap").boundingBox();
      const box = await pin.boundingBox();
      if (!frame || !box) throw new Error("Expected editing frame and pin");
      expect(box.x).toBeGreaterThanOrEqual(frame.x + 28);
      expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width - 28);
      expect(
        await page
          .getByTestId("frame-detail")
          .evaluate((el) => [...el.children].some((child) => child instanceof SVGElement)),
      ).toBe(false);
      const colour = await page.getByTestId("connection-stroke-saga-to-order-api").evaluate((el) => {
        const reference = document.createElement("span");
        reference.style.color = "var(--accent)";
        const parent = el.parentElement;
        if (!parent) throw new Error("Expected a connection group");
        parent.append(reference);
        const result = { stroke: getComputedStyle(el).stroke, accent: getComputedStyle(reference).color };
        reference.remove();
        return result;
      });
      expect(colour.stroke).toBe(colour.accent);
      const label = page.getByTestId("edge-label-saga-to-order-api");
      const ink = await label.evaluate((el) => {
        const canvas = document.querySelector<HTMLElement>('[data-testid="canvas-wrap"]');
        if (!canvas) throw new Error("Expected the canvas frame");
        return parseFloat(getComputedStyle(el).fontSize) * parseFloat(canvas.style.getPropertyValue("--rf-zoom-exact"));
      });
      expect(ink).toBeGreaterThanOrEqual(11);
      await capture("02-editing", theme, page, info);
    });

    test("Follow frames all narrated nodes, caps strokes and clears bottom pins", async ({ page }, info) => {
      await page.clock.install();
      await gotoLive(page, "./?view=canvas&example=black-friday-commerce&live=1&sim=doors-open&paused=1");
      await pauseClock(page);
      await page.getByTestId("live-timeline-input").fill("205");
      await page.getByTestId("live-timeline-input").press("ArrowRight");
      if ((await page.getByTestId("live-play").getAttribute("data-state")) === "playing")
        await page.getByTestId("live-play").click();
      await page.getByTestId("live-view-menu").click();
      await page.getByTestId("view-follow").click();
      await page.clock.runFor(1400);
      await waitForCameraIdle(page);
      const frame = await page.getByTestId("canvas-wrap").boundingBox();
      const legend = await page.getByTestId("live-route-legend").boundingBox();
      if (!frame || !legend) throw new Error("Expected live frame and legend");
      for (const id of ["checkout-api", "payments", "orders-db"]) {
        const card = page.getByTestId(`rf__node-${id}`);
        await expect(card).not.toHaveAttribute("data-detail-hidden", "");
        await expect(page.getByTestId(`focus-offscreen-${id}`)).toHaveCount(0);
        const box = await card.boundingBox();
        if (!box) throw new Error(`Expected narrated card ${id}`);
        expect(box.x).toBeGreaterThanOrEqual(frame.x + 28);
        expect(box.y).toBeGreaterThanOrEqual(frame.y + 28);
        expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width - 28);
        expect(box.y + box.height).toBeLessThan(legend.y - 28);
      }
      const strokes = await page.getByTestId(/^connection-stroke-/).evaluateAll((els) =>
        els.flatMap((el) => {
          const path = el as SVGPathElement;
          if (!path.parentElement?.parentElement?.hasAttribute("data-live-near")) return [];
          const matrix = path.getScreenCTM();
          return matrix ? [parseFloat(getComputedStyle(path).strokeWidth) * Math.hypot(matrix.a, matrix.b)] : [];
        }),
      );
      expect(strokes.length).toBeGreaterThan(0);
      for (const width of strokes) expect(width).toBeLessThanOrEqual(2.01);
      const pins = await page.getByTestId(/^focus-offscreen-/).evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { id: el.getAttribute("data-testid"), x: r.x, y: r.y, width: r.width, height: r.height };
        }),
      );
      for (const pin of pins) expect(pin.y + pin.height).toBeLessThan(legend.y);
      const intersections = await page.getByTestId(/^connection-stroke-/).evaluateAll(
        (els, pins) =>
          els.flatMap((el) => {
            if (el.parentElement?.parentElement?.hasAttribute("data-detail-hidden")) return [];
            const path = el as SVGPathElement,
              matrix = path.getScreenCTM();
            if (!matrix) return [];
            const length = path.getTotalLength();
            return Array.from({ length: Math.ceil(length / 2) + 1 }, (_, i) => {
              const p = path.getPointAtLength(Math.min(length, i * 2));
              return new DOMPoint(p.x, p.y).matrixTransform(matrix);
            }).flatMap((p) =>
              pins
                .filter(
                  (pin) =>
                    p.x > pin.x + 1 && p.x < pin.x + pin.width - 1 && p.y > pin.y + 1 && p.y < pin.y + pin.height - 1,
                )
                .map((pin) => `${el.getAttribute("data-testid")} crosses ${pin.id} at ${p.x},${p.y}`),
            );
          }),
        pins,
      );
      expect(intersections).toEqual([]);
      await capture("07-live-large", theme, page, info);
    });
  });
}

async function capture(
  state: string,
  theme: string,
  page: import("@playwright/test").Page,
  info: import("@playwright/test").TestInfo,
) {
  const dir = process.env.FU1_SCREENSHOTS;
  if (dir) mkdirSync(dir, { recursive: true });
  await page.getByTestId("canvas-wrap").evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  const png = await page.screenshot(dir ? { path: join(dir, `${state}-${theme}.png`) } : {});
  await info.attach(`${state}-${theme}`, { body: png, contentType: "image/png" });
}
