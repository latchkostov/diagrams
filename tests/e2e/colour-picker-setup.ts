import type { Page } from "@playwright/test";

/** The independently lazy description inserts a tall field above Colour. */
export async function openBackgroundPicker(page: Page) {
  await page.getByTestId("inspector-toggle").click();
  // A successful pointer action can land on the description if it arrives after hit-testing.
  await page.getByTestId("inspector-field-description").waitFor({ state: "visible" });
  await page.getByTestId("inspector-diagram-color-custom-btn").click();
}
