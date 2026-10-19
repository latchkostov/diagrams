import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, pageLoadTimeout, waitForStableViewport } from "./fixtures";
import { emulateTracker } from "./collab-tracker";

// Knock-to-join and Remove with re-key (meeting hosts design §2, P5) between browsers in one room, with real WebRTC
// between them and the tracker emulated in the test runner. Selectors are data-testid only.

const chip = (page: Page) => page.getByTestId("room-chip");

async function hostRoom(page: Page): Promise<string> {
  await page.goto("./?view=canvas&example=kafka-order-pipeline");
  await expect(page.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
  await page.evaluate(() => window.dispatchEvent(new Event("diagrams:edit-together")));
  await expect(page.getByTestId("room-start-dialog")).toBeVisible({ timeout: pageLoadTimeout() });
  await page.getByTestId("room-start-confirm").click();
  await expect(page.getByTestId("room-started-dialog")).toBeVisible({ timeout: pageLoadTimeout() });
  const link = await page.getByTestId("room-link").inputValue();
  await page.getByTestId("room-started-done").click();
  return link;
}

/** Opens the link in a new page of `context`, as `alias`, and says Join: it knocks. */
async function knock(context: BrowserContext, link: string, alias: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(link);
  await page.getByTestId("room-join-alias").fill(alias);
  await page.getByTestId("room-join-accept").click();
  await expect(page.getByTestId("room-connecting")).toHaveAttribute("data-knocking", "true", {
    timeout: pageLoadTimeout(),
  });
  return page;
}

const card = (host: Page, alias: string) => host.getByTestId("room-knock-card").filter({ hasText: alias });

async function rename(page: Page, id: string, value: string) {
  await page.bringToFront();
  await page.getByTestId(`node-${id}`).click();
  await expect(page.getByTestId("inspector-field-label")).toBeVisible();
  await waitForStableViewport(page);
  await page.getByTestId(`node-${id}`).dblclick();
  const field = page.getByTestId("inspector-field-label");
  await expect(field).toBeFocused();
  await field.fill(value);
  await field.press("Enter");
}

test.describe("Knock-to-join and Remove", () => {
  test("knock then admit: the newcomer waits at the door with nothing of the room, then the host lets them in", async ({
    browser,
    context,
    page,
  }) => {
    test.slow();
    const other = await browser.newContext();
    try {
      await emulateTracker([context, other]);
      const link = await hostRoom(page);
      expect(link).toMatch(/#room=v3\./);
      const guest = await knock(other, link, "Wren");
      // The host is asked (a card under the chip, never taking the keyboard); the guest has no diagram meanwhile.
      await expect(card(page, "Wren")).toBeVisible({ timeout: pageLoadTimeout() });
      await expect(page.getByTestId("room-knock-admit")).not.toBeFocused();
      await expect(guest.getByTestId("node-gateway")).toHaveCount(0);
      // Each button says whose admission it is.
      await expect(card(page, "Wren").getByTestId("room-knock-admit")).toHaveAccessibleName("Admit Wren");
      await expect(card(page, "Wren").getByTestId("room-knock-deny")).toHaveAccessibleName("Deny Wren");
      // From the keyboard: the card goes with the answer, and focus goes to the room chip (never the page).
      await card(page, "Wren").getByTestId("room-knock-admit").focus();
      await page.keyboard.press("Enter");
      await expect(card(page, "Wren")).toHaveCount(0, { timeout: pageLoadTimeout() });
      await expect(chip(page)).toBeFocused();
      await expect(guest.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
      await expect(chip(guest)).toHaveAttribute("data-knocking", "false");
      await expect(card(page, "Wren")).toHaveCount(0);
      await expect(chip(page)).toHaveAttribute("data-peers", "1");
      await rename(guest, "gateway", "Renamed by Wren");
      await expect(page.getByTestId("node-gateway")).toContainText("Renamed by Wren", { timeout: pageLoadTimeout() });
    } finally {
      await other.close();
    }
  });

  test("knock then deny: the newcomer is told, and leaves with nothing of the room", async ({
    browser,
    context,
    page,
  }) => {
    test.slow();
    const other = await browser.newContext();
    try {
      await emulateTracker([context, other]);
      const link = await hostRoom(page);
      const guest = await knock(other, link, "Otter");
      // From the keyboard, the only card: answered, focus goes to the room chip.
      await card(page, "Otter").getByTestId("room-knock-deny").focus({ timeout: pageLoadTimeout() });
      await page.keyboard.press("Enter");
      await expect(guest.getByTestId("toast").filter({ hasText: "didn't let you in" })).toBeVisible({
        timeout: pageLoadTimeout(),
      });
      await expect(card(page, "Otter")).toHaveCount(0);
      await expect(chip(page)).toBeFocused();
      await expect(guest.getByTestId("room-connecting")).toHaveCount(0);
      await expect(chip(guest)).toHaveCount(0);
      await expect(guest.getByTestId("node-gateway")).toHaveCount(0);
      await expect(chip(page)).toHaveAttribute("data-peers", "0");
      // A card that goes while focus is elsewhere (its newcomer left) leaves focus where it is.
      const fox = await knock(other, link, "Fox");
      await expect(card(page, "Fox")).toBeVisible({ timeout: pageLoadTimeout() });
      await page.getByTestId("node-gateway").click();
      const field = page.getByTestId("inspector-field-label");
      await expect(field).toBeVisible();
      await field.focus();
      await fox.close();
      await expect(card(page, "Fox")).toHaveCount(0, { timeout: pageLoadTimeout() });
      await expect(field).toBeFocused();
    } finally {
      await other.close();
    }
  });

  test("presenting: answering the last card from the keyboard leaves focus on the canvas", async ({
    browser,
    context,
    page,
  }) => {
    test.slow();
    const other = await browser.newContext();
    try {
      await emulateTracker([context, other]);
      const link = await hostRoom(page);
      await page.getByTestId("present-toggle").click();
      await expect(page.getByTestId("present-exit")).toBeVisible();
      await expect(chip(page)).toHaveCount(0);
      await knock(other, link, "Wren");
      await expect(card(page, "Wren")).toBeVisible({ timeout: pageLoadTimeout() });
      await card(page, "Wren").getByTestId("room-knock-admit").focus();
      await page.keyboard.press("Enter");
      await expect(card(page, "Wren")).toHaveCount(0, { timeout: pageLoadTimeout() });
      await expect(page.getByTestId("canvas-wrap")).toBeFocused();
    } finally {
      await other.close();
    }
  });

  test("remove: the room moves to a new key; the one removed is out, and the one who stays carries on", async ({
    browser,
    context,
    page,
  }) => {
    test.slow();
    const [a, b] = [await browser.newContext(), await browser.newContext()];
    try {
      await emulateTracker([context, a, b]);
      const link = await hostRoom(page);
      const stays = await knock(a, link, "Ada");
      await card(page, "Ada").getByTestId("room-knock-admit").click({ timeout: pageLoadTimeout() });
      await expect(stays.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
      const goes = await knock(b, link, "Bea");
      await card(page, "Bea").getByTestId("room-knock-admit").click({ timeout: pageLoadTimeout() });
      await expect(goes.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
      await expect(chip(page)).toHaveAttribute("data-peers", "2");
      await expect(chip(stays)).toHaveAttribute("data-epoch", "0");
      // Ada becomes a co-host: she has "Ask before people join", kept as the host changes it while her menu is open,
      // and no Remove (the host's alone).
      await chip(page).click();
      await page.getByTestId("room-person-row").filter({ hasText: "Ada" }).click();
      await page.getByTestId("room-make-cohost").click();
      await expect(chip(stays)).toHaveAttribute("data-host", "cohost", { timeout: pageLoadTimeout() });
      await chip(stays).click();
      await expect(stays.getByTestId("room-ask-join")).toHaveAttribute("aria-checked", "true");
      await chip(page).click();
      await page.getByTestId("room-ask-join").click();
      await expect(stays.getByTestId("room-ask-join")).toHaveAttribute("aria-checked", "false", {
        timeout: pageLoadTimeout(),
      });
      await stays.getByTestId("room-person-row").filter({ hasText: "Bea" }).click();
      await expect(stays.getByTestId("room-person-menu")).toBeVisible();
      await expect(stays.getByTestId("room-remove")).toHaveCount(0);
      await stays.keyboard.press("Escape");
      await stays.keyboard.press("Escape");
      // The host removes Bea from the people menu.
      await chip(page).click();
      await page.getByTestId("room-person-row").filter({ hasText: "Bea" }).click();
      await page.getByTestId("room-remove").click();
      await expect(goes.getByTestId("toast").filter({ hasText: "removed from the room" })).toBeVisible({
        timeout: pageLoadTimeout(),
      });
      await expect(chip(goes)).toHaveCount(0);
      // Ada moves to the new epoch with the host, the diagram as it was, and edits still go both ways.
      await expect(chip(stays)).toHaveAttribute("data-epoch", "1", { timeout: pageLoadTimeout() });
      await expect(chip(page)).toHaveAttribute("data-epoch", "1");
      await expect(chip(page)).toHaveAttribute("data-peers", "1", { timeout: pageLoadTimeout() });
      await rename(stays, "gateway", "After the re-key");
      await expect(page.getByTestId("node-gateway")).toContainText("After the re-key", { timeout: pageLoadTimeout() });
      await rename(page, "orders", "Host after the re-key");
      await expect(stays.getByTestId("node-orders")).toContainText("Host after the re-key", {
        timeout: pageLoadTimeout(),
      });
      // Bea's copy stays hers, and hears nothing more.
      await expect(goes.getByTestId("node-gateway")).not.toContainText("After the re-key");
    } finally {
      await a.close();
      await b.close();
    }
  });
});
