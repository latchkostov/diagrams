import type { Page } from "@playwright/test";

/** Both lazy sections precede Simulation; scrolling it before they mount uses an obsolete dock layout. */
export async function tutorialInspectorReady(page: Pick<Page, "getByTestId">) {
  await Promise.all([
    page.getByTestId("inspector-field-node-description-editor").waitFor({ state: "visible" }),
    page.getByTestId("planning-explanation-c").waitFor({ state: "visible" }),
  ]);
}
