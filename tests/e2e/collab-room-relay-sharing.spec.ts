import { test, relayPreview } from "./collab-relay";
import { expect, pageLoadTimeout, openShareChooser } from "./fixtures";

test.use({ relayShareLinks: "0" });

test("relay: Private Share has no privacy escape when share links are enabled", async ({ relayBuild, page }) => {
  const fixture = await relayPreview(relayBuild);
  try {
    await page.goto(`${fixture.origin}/?view=canvas&example=kafka-order-pipeline`);
    await expect(page.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
    await openShareChooser(page);
    // Prove this fixture really includes share links before making the diagram private.
    await expect(page.getByTestId("share-option-password")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-privacy").click();
    await page.getByTestId("privacy-diagram").click();
    await openShareChooser(page);
    await expect(page.getByTestId("share-private-note")).toContainText("rooms");
    await expect(page.getByTestId("share-make-not-private")).toHaveCount(0);
    await expect(page.getByTestId("share-option-edit-together")).toHaveCount(0);
    expect(fixture.relay.wss.clients.size).toBe(0);
  } finally {
    await page.goto("about:blank");
    await fixture.close();
  }
});
