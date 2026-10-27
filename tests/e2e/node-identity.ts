import type { Page } from "@playwright/test";
import { expect, viewportTransform, waitForCameraIdle } from "./fixtures";

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

export async function expectFittedIdentity(page: Page, id: string, name: string) {
  const node = page.getByTestId(`node-${id}`);
  const title = node.getByTestId("card-title");
  await expect(title).toHaveAttribute("title", name);
  await expect(title).toBeVisible();
  await expect
    .poll(() =>
      title.evaluate((el) => {
        const style = getComputedStyle(el);
        const measure = document.createElement("canvas").getContext("2d");
        const wrap = el.closest<HTMLElement>('[data-testid="canvas-wrap"]');
        if (!measure || !wrap) throw new Error("Missing identity measurement surface");
        measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        measure.letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
        const zoom = Number(wrap.style.getPropertyValue("--rf-zoom-exact"));
        return (
          !!el.textContent?.trim() &&
          el.textContent !== "…" &&
          measure.measureText(el.textContent).width * zoom <= el.getBoundingClientRect().width + 0.5
        );
      }),
    )
    .toBe(true);
  await expect(node.getByTestId("card-icon")).toBeVisible();
}
