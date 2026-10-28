import type { Page } from "@playwright/test";
import { expect, fitDiagram, viewportTransform, waitForCameraIdle } from "./fixtures";

export async function zoomIdentity(page: Page, target = 0.24) {
  await waitForCameraIdle(page);
  const current = Number((await viewportTransform(page)).match(/scale\(([^)]+)\)/)?.[1]);
  const pane = await page.getByTestId("canvas-wrap").boundingBox();
  if (!pane) throw new Error("Missing canvas");
  await page.getByTestId("canvas-pane").dispatchEvent("wheel", {
    deltaY: Math.log2(current / target) / (await page.evaluate(() => (/Mac/.test(navigator.platform) ? 0.02 : 0.002))),
    ctrlKey: true,
    clientX: pane.x + pane.width / 2,
    clientY: pane.y + pane.height / 2,
    bubbles: true,
  });
  await expect
    .poll(async () => Number((await viewportTransform(page)).match(/scale\(([^)]+)\)/)?.[1]))
    .toBeCloseTo(target, 2);
  await waitForCameraIdle(page);
}

/**
 * Live draws its particles at 60% zoom and above; below it the calm chip view stops the particle canvas on
 * purpose (lowzoom-chips.spec.ts). A fitted Live view of a wide example can open below 60%, so this zooms in
 * to read the particles (the same threshold as before) and then fits the view again.
 */
export async function expectLiveParticles(page: Page, min: number, timeout = 10_000) {
  await waitForCameraIdle(page);
  const zoom = Number((await viewportTransform(page)).match(/scale\(([^)]+)\)/)?.[1]);
  if (zoom < 0.6) await zoomIdentity(page, 0.8);
  await expect
    .poll(async () => Number(await page.getByTestId("live-canvas").getAttribute("data-particles")), { timeout })
    .toBeGreaterThan(min);
  if (zoom < 0.6) await fitDiagram(page);
  await waitForCameraIdle(page);
}

/**
 * The painted name fits its own width and its card, clears the readable floor (9 screen pixels), keeps a
 * ~14 px icon (capped by the card's height), and never overlaps a still-visible second line.
 */
export async function expectFittedIdentity(page: Page, id: string, name: string) {
  const node = page.getByTestId(`node-${id}`);
  const title = node.getByTestId("card-title");
  await expect(title).toHaveAttribute("data-label", name);
  await expect(title).toBeVisible();
  await expect
    .poll(() =>
      title.evaluate((el) => {
        const style = getComputedStyle(el);
        const measure = document.createElement("canvas").getContext("2d");
        const wrap = el.closest<HTMLElement>('[data-testid="canvas-wrap"]');
        const wrapper = el.closest<HTMLElement>('[data-testid^="rf__node-"]');
        const chip = el.parentElement?.getAttribute("aria-label") === el.getAttribute("data-label");
        const card = chip ? el.parentElement : wrapper;
        const tile = card?.querySelector('[data-testid="card-icon"]');
        const icon = chip ? tile : tile?.firstElementChild;
        if (!measure || !wrap || !card || !icon) throw new Error("Missing identity measurement surface");
        measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        measure.letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
        const box = el.getBoundingClientRect();
        const bounds = card.getBoundingClientRect();
        // Identity scaling can be held while the viewport zoom keeps changing.
        const zoom = bounds.width / (card as HTMLElement).offsetWidth;
        const second = card.querySelector<HTMLElement>('[data-testid="card-second-line"]');
        const line =
          second && getComputedStyle(second).visibility === "visible" ? second.getBoundingClientRect() : null;
        const failures = [
          !el.textContent?.trim() || el.textContent === "…" ? "empty" : "",
          Math.max(...(el.textContent ?? "").split("\n").map((line) => measure.measureText(line).width)) * zoom >
          box.width + 0.5
            ? "overflows its width"
            : "",
          parseFloat(style.fontSize) * zoom < 9 - 0.01 ? `font ${parseFloat(style.fontSize) * zoom}px` : "",
          box.left < bounds.left - 0.5 || box.right > bounds.right + 0.5 ? "outside its card" : "",
          getComputedStyle(icon).visibility !== "visible" ? "hidden icon" : "",
          icon.getBoundingClientRect().height < Math.min(chip ? 12 : 14, bounds.height - 0.5) - 0.5
            ? `icon ${icon.getBoundingClientRect().height}px`
            : "",
          line && line.width && line.top < box.bottom && box.top < line.bottom ? "covers its second line" : "",
        ].filter(Boolean);
        return failures.join(", ");
      }),
    )
    .toBe("");
  await expect(node.getByTestId("card-icon")).toBeVisible();
}
