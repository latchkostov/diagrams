import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors } from "./fixtures";

// The batch 3 checks in the Checks card (docs/research/architecture-checks.md, "Batch 3"): a service using
// another's database (a warning, fixed by asking the owner) and a client going around the gateway (a suggestion,
// with other gateways as chips). The fixture is tests/fixtures/checks/checkout-shortcuts.diagram.json.
// data-testid only.

const FIXTURE = readFileSync(new URL("../fixtures/checks/checkout-shortcuts.diagram.json", import.meta.url));
const SHARED = "shared-database:billing-db";
const BYPASS = "entry-gateway:orders";

const card = (page: Page) => page.getByTestId("checks-card");
const row = (page: Page, id: string) => page.getByTestId(`check-row-${id}`);

async function openFixture(page: Page) {
  await gotoCanvas(page, "aks-app-config-key-vault");
  await page.getByTestId("import-input").setInputFiles({
    name: "checkout-shortcuts.diagram.json",
    mimeType: "application/json",
    buffer: FIXTURE,
  });
  await expect(page.getByTestId("diagram-title")).toHaveText("Checkout shortcuts");
  await expect(page.getByTestId("checks-count")).toHaveText("1 warning");
  await page.getByTestId("checks-count").click();
  await expect(card(page)).toBeVisible();
}

test("a service using another's database: Ask the owner instead, in one undo step", async ({ page, consoleErrors }) => {
  await openFixture(page);
  await expect(page.getByTestId("checks-summary")).toHaveText("1 warning · 1 suggestion");
  await expect(row(page, SHARED)).toHaveAttribute("data-severity", "warning");
  await expect(row(page, SHARED)).toContainText("Billing uses Order service's database");
  await expect(page.getByTestId(`check-marker-billing`)).toHaveAttribute("data-severity", "warning");

  await page.getByTestId(`check-fix-${SHARED}`).click();
  await expect(page.getByTestId("toast")).toContainText("Ask Order service instead: done");
  await expect(row(page, SHARED)).toHaveCount(0);
  await expect(page.getByTestId("checks-count")).toHaveCount(0);
  // Billing now asks the order service; its flow into the database is gone.
  await expect(page.getByTestId("edge-billing-db")).toHaveCount(0);

  await page.getByTestId("check-fix-undo").click();
  await expect(row(page, SHARED)).toBeVisible();
  await expect(page.getByTestId("checks-count")).toHaveText("1 warning");
  expectNoErrors(consoleErrors);
});

test("a client going around the gateway: the fix goes through it, a chip adds another kind", async ({
  page,
  consoleErrors,
}) => {
  await openFixture(page);
  const bypass = row(page, BYPASS);
  await expect(bypass).toHaveAttribute("data-severity", "suggestion");
  await expect(bypass).toContainText("Mobile app calls Order service directly");
  await expect(page.getByTestId(`check-fix-${BYPASS}`)).toHaveText(/Go through Commerce gateway/);
  await expect(page.getByTestId(`check-fix-option-0-${BYPASS}`)).toHaveText("Firewall / WAF");
  await expect(page.getByTestId(`check-fix-option-1-${BYPASS}`)).toHaveText("Kong Gateway");

  // Hovering the row makes its markers stand out where they are: at the node's top-right corner.
  await bypass.hover();
  const marker = page.getByTestId("check-marker-app");
  await expect(marker).toHaveClass(/is-hot/);
  const near = async () => {
    const m = await marker.boundingBox();
    const n = await page.getByTestId("node-app").boundingBox();
    if (!m || !n) return Infinity;
    return Math.hypot(m.x + m.width / 2 - (n.x + n.width), m.y + m.height / 2 - n.y);
  };
  await expect.poll(near).toBeLessThan(16);

  // A chip, from the keyboard: one new node, inserted on the connection, and the suggestion goes. Focus moves on to
  // the finding that's left (its row's head), never to the page.
  const nodes = page.getByTestId(/^node-(?!tooltip$|editor-)/);
  const before = await nodes.count();
  await page.getByTestId(`check-fix-option-1-${BYPASS}`).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("toast")).toContainText("Added Kong Gateway");
  await expect.poll(() => nodes.count()).toBe(before + 1);
  await expect(bypass).toHaveCount(0);
  await expect(page.getByTestId(`check-select-${SHARED}`)).toBeFocused();

  // Undo, then the button: through the gateway that's already there, no new node.
  await page.getByTestId("check-fix-undo").click();
  await expect.poll(() => nodes.count()).toBe(before);
  await expect(bypass).toBeVisible();
  await page.getByTestId(`check-fix-${BYPASS}`).click();
  await expect(page.getByTestId("toast")).toContainText("Go through Commerce gateway: done");
  await expect(bypass).toHaveCount(0);
  await expect(page.getByTestId("edge-app-orders")).toHaveCount(0);
  expect(await nodes.count()).toBe(before);
  expectNoErrors(consoleErrors);
});
