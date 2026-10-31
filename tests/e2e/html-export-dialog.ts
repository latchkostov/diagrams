import type { Page } from "@playwright/test";
import { expect, waitForHtmlTemplate } from "./fixtures";

export async function openHtmlExport(page: Page, visible?: () => void) {
  const template = waitForHtmlTemplate(page);
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  await expect(page.getByTestId("file-more-formats-menu")).toBeVisible();
  await page.getByTestId("export-html").click();
  await expect(page.getByTestId("html-export-dialog")).toBeVisible();
  visible?.();
  await template;
}
