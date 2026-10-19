import type { Page } from "@playwright/test";
import { test, expect, pageLoadTimeout } from "./fixtures";
import { emulateTracker } from "./collab-tracker";

// A joiner gets the diagram even when the host's first presence frames (its signed binding) never arrive: real WebRTC
// between two browsers, the tracker emulated in the test runner, and the host's data channel made to lose them.

async function startRoom(page: Page): Promise<string> {
  await page.evaluate(() => window.dispatchEvent(new Event("diagrams:edit-together")));
  await expect(page.getByTestId("room-start-dialog")).toBeVisible({ timeout: pageLoadTimeout() });
  await page.getByTestId("room-start-confirm").click();
  await expect(page.getByTestId("room-started-dialog")).toBeVisible({ timeout: pageLoadTimeout() });
  const link = await page.getByTestId("room-link").inputValue();
  await page.getByTestId("room-started-done").click();
  return link;
}

test("a joiner gets the diagram though the host's presence frames are lost for a long while", async ({
  browser,
  context,
  page,
}) => {
  test.slow();
  const other = await browser.newContext();
  try {
    await emulateTracker([context, other]);
    // The host's data channel loses every presence frame for its first 35 seconds (longer than a joiner holds
    // anything it can't check yet): chunk header 8 bytes, then the envelope, its channel byte at offset 3 is 2 for
    // presence.
    await page.addInitScript(() => {
      let first: number | undefined;
      const send = RTCDataChannel.prototype.send;
      RTCDataChannel.prototype.send = function (this: RTCDataChannel, data: never) {
        const bytes =
          data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : undefined;
        first ??= Date.now();
        if (bytes && bytes.length > 12 && bytes[8 + 3] === 2 && Date.now() - first < 35_000) return;
        return send.call(this, data);
      } as typeof RTCDataChannel.prototype.send;
    });
    await page.goto("./?view=canvas&example=kafka-order-pipeline");
    await expect(page.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
    const link = await startRoom(page);
    const guest = await other.newPage();
    await guest.goto(link);
    await guest.getByTestId("room-join-accept").click();
    // Knock-to-join: at the door, asked; the host lets them in.
    await expect(guest.getByTestId("room-connecting")).toHaveAttribute("data-waiting", "admission", {
      timeout: pageLoadTimeout(),
    });
    await page.getByTestId("room-knock-admit").first().click({ timeout: pageLoadTimeout() });
    // Meanwhile the wait says why: connected, checking who's here (the host's presence isn't getting through).
    await expect(guest.getByTestId("room-connecting")).toHaveAttribute("data-waiting", "verifying", {
      timeout: pageLoadTimeout(),
    });
    await expect(guest.getByTestId("node-gateway")).toBeVisible({ timeout: 90_000 });
    // Nobody was held against anybody.
    const chip = guest.getByTestId("room-chip");
    await expect(chip).toHaveAttribute("data-waiting", "none");
    expect(JSON.parse((await chip.getAttribute("data-diagnostics")) ?? "{}").rejected?.quarantined).toBeUndefined();
  } finally {
    await other.close();
  }
});
