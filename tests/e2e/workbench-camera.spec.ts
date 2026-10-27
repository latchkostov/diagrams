import type { Page } from "@playwright/test";
import { sampledContrast } from "./pngContrast";
import { test, expect, gotoCanvas, gotoLive, expectTheme, pauseClock, waitForCameraIdle } from "./fixtures";

/** Finish the paused-clock move before checking its final view readout. */
async function finishCameraClock(page: Page, duration: number) {
  await page.clock.fastForward(duration);
  await expect
    .poll(
      async () => {
        await page.clock.fastForward(1000);
        return page.getByTestId("canvas-wrap").getAttribute("data-camera-state");
      },
      { intervals: [0] },
    )
    .toBe("idle");
}

for (const theme of ["light", "dark"])
  for (const large of [false, true])
    test(`Follow frame, text floor and rendered contrast (${large ? "large" : "retry"}, ${theme})`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(
        (theme) => localStorage.setItem("diagrams.settings.v1", JSON.stringify({ themePreference: theme })),
        theme,
      );
      await page.clock.install();
      await gotoLive(
        page,
        large
          ? "./?view=canvas&example=black-friday-commerce&live=1&sim=doors-open&paused=1"
          : "./?view=canvas&example=retry-storm&live=1&sim=three-quick-retries&paused=1",
      );
      await expectTheme(page, theme);
      await pauseClock(page);
      const time = page.getByTestId("live-timeline-input");
      await time.fill(large ? "273" : "159");
      await time.press("ArrowRight");
      await expect(page.getByTestId("live-note-text")).toBeVisible();
      await page.getByTestId("live-view-menu").click();
      await page.getByTestId("view-follow").click();
      await page.clock.runFor(1400);
      await waitForCameraIdle(page);
      await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-detail-view", "follow");
      await expect(page.getByTestId("live-view-menu")).toContainText("Following");
      const pinIds = await page
        .getByTestId(/^focus-offscreen-/)
        .evaluateAll((els) => els.map((el) => (el.getAttribute("data-testid") ?? "").slice("focus-offscreen-".length)));
      for (const id of pinIds)
        await expect(page.getByTestId(`rf__node-${id}`)).toHaveAttribute("data-detail-hidden", "");
      const near = await page.getByTestId(/^connection-stroke-/).evaluateAll((els) =>
        els.flatMap((el) => {
          const edge = el.closest("[data-live-near][data-live-dim]");
          if (!edge || edge.hasAttribute("data-detail-hidden")) return [];
          const path = el as SVGPathElement,
            length = path.getTotalLength(),
            matrix = path.getScreenCTM();
          if (!matrix) return [];
          const wrap = document.querySelector('[data-testid="canvas-wrap"]');
          if (!wrap) throw new Error("Expected the canvas frame");
          const pane = wrap.getBoundingClientRect();
          return Array.from({ length: 15 }, (_, i) => 0.15 + i * 0.05).flatMap((t) => {
            const p = path.getPointAtLength(length * t),
              next = path.getPointAtLength(Math.min(length, length * t + 1));
            const at = new DOMPoint(p.x, p.y).matrixTransform(matrix),
              after = new DOMPoint(next.x, next.y).matrixTransform(matrix);
            const distance = Math.hypot(after.x - at.x, after.y - at.y) || 1;
            const normal = { x: -(after.y - at.y) / distance, y: (after.x - at.x) / distance };
            if (at.x < pane.left + 40 || at.x > pane.right - 40 || at.y < pane.top + 40 || at.y > pane.bottom - 40)
              return [];
            const top = document.elementFromPoint(at.x, at.y);
            if (top?.closest('[data-testid^="node-"], [data-testid^="edge-label-"], [data-testid^="focus-offscreen-"]'))
              return [];
            return [
              {
                x: at.x,
                y: at.y,
                width: 0,
                height: 0,
                normal,
                ground: { x: at.x + normal.x * 5, y: at.y + normal.y * 5 },
                edge: el.getAttribute("data-testid") ?? "unknown-stroke",
              },
            ];
          });
        }),
      );
      const dim = await page.getByTestId(/^rf__node-/).evaluateAll((els) =>
        els
          .filter((el) => el.hasAttribute("data-live-dim") && !el.hasAttribute("data-detail-hidden"))
          .flatMap((el) => {
            const texts = [
              ...el.querySelectorAll<HTMLElement>('[data-testid="card-title"], [data-testid="card-second-line"]'),
            ];
            if (texts.length < 2 || texts.some((text) => getComputedStyle(text).visibility !== "visible")) return [];
            const card = el.getBoundingClientRect();
            return [
              texts.map((text) => {
                const r = text.getBoundingClientRect();
                return {
                  x: r.x,
                  y: r.y,
                  width: r.width,
                  height: r.height,
                  ground: { x: card.right - 8, y: card.bottom - 8 },
                };
              }),
            ];
          }),
      );
      expect(near.length).toBeGreaterThan(0);
      expect(dim.length).toBeGreaterThan(0);
      const png = await page.screenshot();
      await info.attach("rendered-frame", { body: png, contentType: "image/png" });
      const edgeRatios = await sampledContrast(page, png, near);
      const byEdge = new Map<string, number[]>();
      for (let i = 0; i < near.length; i++)
        byEdge.set(near[i].edge, [...(byEdge.get(near[i].edge) ?? []), edgeRatios[i]]);
      for (const [edge, ratios] of byEdge) {
        ratios.sort((a, b) => a - b);
        expect(ratios[Math.floor(ratios.length / 2)], edge).toBeGreaterThanOrEqual(3);
      }
      const titleRatios = await sampledContrast(page, png, dim[0]);
      await info.attach("png-contrast-measurements", {
        body: JSON.stringify({
          theme,
          large,
          edges: [...byEdge].map(([edge, values]) => ({ edge, median: values[Math.floor(values.length / 2)] })),
          titleRatios,
        }),
        contentType: "application/json",
      });
      for (const ratio of titleRatios) expect(ratio, "dimmed title and second-line ink").toBeGreaterThanOrEqual(4.5);
      const sizes = await page
        .getByTestId("canvas-wrap")
        .getByTestId(/^(card-title|card-second-line)$/)
        .evaluateAll((els) =>
          els
            .filter((el) => getComputedStyle(el).visibility === "visible")
            .map((el) => {
              let scale = 1;
              for (let ancestor: Element | null = el; ancestor; ancestor = ancestor.parentElement) {
                const style = getComputedStyle(ancestor);
                if (style.transform !== "none") {
                  const matrix = new DOMMatrix(style.transform);
                  scale *= Math.hypot(matrix.a, matrix.b);
                }
                if (style.scale !== "none") scale *= parseFloat(style.scale);
              }
              return parseFloat(getComputedStyle(el).fontSize) * scale;
            }),
        );
      for (const size of sizes) expect(size).toBeGreaterThanOrEqual(10.5);
      await page.getByTestId("live-view-menu").click();
      await page.getByTestId("zoom-in-button").click();
      await finishCameraClock(page, 400);
      await expect(page.getByTestId("live-view-menu")).toContainText("Custom");
      await page.getByTestId("canvas-wrap").focus();
      await page.keyboard.press("Shift+Digit3");
      await finishCameraClock(page, 800);
      await expect(page.getByTestId("live-view-menu")).toContainText("Following");
    });

test("large Overview exposes zone focus and returns with Escape", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoCanvas(page, "black-friday-commerce");
  await waitForCameraIdle(page);
  await expect(page.getByTestId("view-focus")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("fit-view-button").click();
  await waitForCameraIdle(page);
  await expect(page.getByTestId("overview-dig-hint")).toBeVisible();
  await expect(page.getByTestId("annotation-text-note-routes")).not.toBeVisible();
  await expect(page.getByTestId("annotation-note-routes")).toBeVisible();
  const zone = page.getByTestId(/^zone-focus-/).first();
  await zone.click();
  await waitForCameraIdle(page);
  await expect(page.getByTestId("view-focus")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await waitForCameraIdle(page);
  await expect(page.getByTestId("fit-view-button")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("overview-dig-hint")).toHaveCount(0);
});

test("the text floor preserves authored card geometry while zooming", async ({ page }) => {
  await gotoCanvas(page, "aws-serverless-orders");
  await waitForCameraIdle(page);
  await page.getByTestId("zoom-100").click();
  await waitForCameraIdle(page);
  const boxes = () =>
    page.getByTestId("card-title").evaluateAll((els) =>
      els.map((el) => {
        const node = el.closest<HTMLElement>('[data-testid^="rf__node-"]');
        if (!node) throw new Error("Expected a card wrapper");
        return [node.dataset.testid, node.offsetWidth, node.offsetHeight];
      }),
    );
  const original = await boxes();
  await page.getByTestId("zoom-out-button").click();
  await waitForCameraIdle(page);
  await expect.poll(boxes).toEqual(original);
});

for (const theme of ["light", "dark"])
  for (const width of [1440, 390])
    test(`Play and Pause use contrasting primary ink (${theme}, ${width})`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.addInitScript(
        (theme) => localStorage.setItem("diagrams.settings.v1", JSON.stringify({ themePreference: theme })),
        theme,
      );
      await page.clock.install();
      await gotoLive(page, "./?view=canvas&example=retry-storm&sim=three-quick-retries&paused=1");
      await pauseClock(page);
      const button = page.getByTestId("live-play");
      for (const state of ["paused", "playing"]) {
        await expect(button).toHaveAttribute("data-state", state);
        const colours = await button.evaluate((el) => {
          const style = getComputedStyle(el);
          const reference = document.createElement("span");
          reference.style.color = "var(--text)";
          reference.style.background = "var(--bg)";
          el.append(reference);
          const primary = getComputedStyle(reference);
          const result = {
            fill: style.backgroundColor,
            glyph: style.color,
            ink: primary.color,
            ground: primary.backgroundColor,
          };
          reference.remove();
          return result;
        });
        expect(colours.fill).toBe(colours.ink);
        expect(colours.glyph).toBe(colours.ground);
        await page.mouse.move(2, 2);
        const box = await button.boundingBox();
        if (!box) throw new Error("Expected Play / Pause");
        const png = await page.screenshot();
        const [contrast] = await sampledContrast(page, png, [
          {
            x: box.x + box.width / 2 - 6,
            y: box.y + box.height / 2 - 6,
            width: 12,
            height: 12,
            ground: { x: box.x + 6, y: box.y + box.height / 2 },
          },
        ]);
        expect(contrast).toBeGreaterThanOrEqual(4.5);
        await info.attach(`${theme}-${width}-${state}-contrast`, {
          body: JSON.stringify({ contrast, colours }),
          contentType: "application/json",
        });
        await info.attach(`${theme}-${width}-${state}`, { body: png, contentType: "image/png" });
        if (state === "paused") await button.click();
      }
    });

test("Edit Focus pins never cover a painted card", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoCanvas(page, "outbox-saga-checkout");
  await page.getByTestId("node-order-api").click();
  await page.getByTestId("view-focus").click();
  await waitForCameraIdle(page);
  const pins = page.getByTestId(/^focus-offscreen-/);
  await expect(pins.first()).toBeVisible();
  const cards = await page.getByTestId(/^rf__node-/).evaluateAll((els) =>
    els
      .filter((el) => !el.hasAttribute("data-detail-hidden") && el.querySelector('[data-testid="card-title"]'))
      .map((el) => {
        const { x, y, width, height } = el.getBoundingClientRect();
        return { x, y, width, height };
      }),
  );
  for (const pin of await pins.all()) {
    const box = await pin.boundingBox();
    if (!box) throw new Error("Expected a pin");
    for (const card of cards)
      expect(
        box.x < card.x + card.width &&
          box.x + box.width > card.x &&
          box.y < card.y + card.height &&
          box.y + box.height > card.y,
      ).toBe(false);
  }
});
