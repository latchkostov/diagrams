import { test, expect, gotoCanvas } from "./fixtures";
import { zoomIdentity } from "./node-identity";

test("keyboard focus and selection retain Config settings at 55%", async ({ page }) => {
  await gotoCanvas(page, "aks-app-config-key-vault");
  await zoomIdentity(page, 0.55);
  const edge = page.getByTestId("edge-api-to-appcfg");
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-low-zoom", "mid");
  await expect(edge).toHaveAttribute("data-relation", "config");
  // React Flow's wrapper is the connection's keyboard stop.
  await page.keyboard.press("Shift");
  await edge.evaluate((el) => (el.parentElement as unknown as SVGElement).focus());
  await zoomIdentity(page, 0.55);
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-low-zoom", "mid");
  const card = page.getByTestId("edge-settings-api-to-appcfg");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Orders:PageSize");
  await expect(page.getByTestId("edge-setting-api-to-appcfg-2")).toHaveAttribute("data-secret", "1");
  await expect(page.getByTestId("edge-messages-api-to-appcfg")).not.toBeVisible();
  await edge.dispatchEvent("click");
  await page.getByTestId("canvas-wrap").focus();
  await expect(card).toBeVisible();
});

test("changing language preserves fitted chip widths and merged paths", async ({ page }) => {
  await gotoCanvas(page, "black-friday-commerce");
  await zoomIdentity(page, 0.4);
  const root = page.getByTestId("canvas-wrap");
  await expect(root).toHaveAttribute("data-low-zoom", "mid");
  const geometry = () =>
    root.evaluate((root) => ({
      widths: [...root.querySelectorAll<HTMLElement>('[data-testid="card-title"]')].map((el) => {
        if (!el.parentElement) throw new Error("Missing chip body");
        return el.parentElement.style.width;
      }),
      paths: [...root.querySelectorAll('[data-testid^="connection-stroke-"]')].map((el) => el.getAttribute("d")),
    }));
  const before = await geometry();
  expect(before.widths.every(Boolean)).toBe(true);
  expect(before.paths.some((path) => path?.includes(" M"))).toBe(true);
  await page.getByTestId("view-button").click();
  await page.getByTestId("view-language").click();
  await page.getByTestId("language-option-de").click();
  await expect(page.getByTestId("language-option-de")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("language-done").click();
  await expect.poll(geometry).toEqual(before);
});
