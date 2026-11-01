import type { Page } from "@playwright/test";
import { viewportTransform, waitForCameraIdle } from "./fixtures";

export async function precisionViewport(page: Page) {
  const transform = await viewportTransform(page);
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(transform);
  if (!match) throw new Error(`Unexpected transform: ${transform}`);
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
}

/** A temporarily stable transform can still precede the initial fit's final refinement. */
export async function precisionDragStart(page: Page, testId: string) {
  await waitForCameraIdle(page);
  const { zoom } = await precisionViewport(page);
  const bounds = await page.getByTestId(testId).boundingBox();
  if (!bounds) throw new Error("Expected a visible element");
  return { zoom, press: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } };
}
