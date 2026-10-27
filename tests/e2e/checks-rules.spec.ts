import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors, openCheckFinding } from "./fixtures";

// The batch 3 and 4 checks in the Checks card (docs/research/architecture-checks.md, "Batch 3"): a service using
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
  await expect(page.getByTestId("checks-count").getByTestId("checks-warning-text")).toHaveText("1 warning");
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
  await expect(page.getByTestId("checks-warning-badge")).toHaveCount(0);
  // Billing now asks the order service; its flow into the database is gone.
  await expect(page.getByTestId("edge-billing-db")).toHaveCount(0);

  await page.getByTestId("check-fix-undo").click();
  await expect(row(page, SHARED)).toBeVisible();
  await expect(page.getByTestId("checks-count").getByTestId("checks-warning-text")).toHaveText("1 warning");
  expectNoErrors(consoleErrors);
});

test("a client going around the gateway: the fix goes through it, a chip adds another kind", async ({
  page,
  consoleErrors,
}) => {
  await openFixture(page);
  const bypass = row(page, BYPASS);
  await openCheckFinding(page, BYPASS);
  await expect(bypass).toHaveAttribute("data-severity", "suggestion");
  await expect(bypass).toContainText("Mobile app calls Order service directly");
  await expect(page.getByTestId(`check-fix-${BYPASS}`)).toHaveText(/Go through Commerce gateway/);
  await expect(page.getByTestId(`check-fix-option-0-${BYPASS}`)).toHaveText("Firewall / WAF");
  await expect(page.getByTestId(`check-fix-option-1-${BYPASS}`)).toHaveText("Kong Gateway");

  // Hovering the row lights its tag inside the node's upper-right corner.
  await bypass.hover();
  const marker = page.getByTestId("check-marker-app");
  await expect(marker).toHaveClass(/is-hot/);
  const near = async () => {
    const m = await marker.boundingBox();
    const n = await page.getByTestId("node-app").boundingBox();
    if (!m || !n) return Infinity;
    return Math.hypot(m.x + m.width - (n.x + n.width), m.y - n.y);
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
  await openCheckFinding(page, BYPASS);
  await page.getByTestId(`check-fix-${BYPASS}`).click();
  await expect(page.getByTestId("toast")).toContainText("Go through Commerce gateway: done");
  await expect(bypass).toHaveCount(0);
  await expect(page.getByTestId("edge-app-orders")).toHaveCount(0);
  expect(await nodes.count()).toBe(before);
  expectNoErrors(consoleErrors);
});

// Batch 4 (docs/research/architecture-checks.md, "Batch 4"): Avro on Kafka with no schema registry (a warning) and
// services reading Key Vault without an identity (a suggestion: one identity per service, one shared as a chip). The
// fixture is tests/fixtures/checks/payments-ledger.diagram.json.
const LEDGER = readFileSync(new URL("../fixtures/checks/payments-ledger.diagram.json", import.meta.url));
const REGISTRY = "schema-registry:payments";
const IDENTITY = "secret-identity:kv";

async function openLedger(page: Page) {
  await gotoCanvas(page, "aks-app-config-key-vault");
  await page.getByTestId("import-input").setInputFiles({
    name: "payments-ledger.diagram.json",
    mimeType: "application/json",
    buffer: LEDGER,
  });
  await expect(page.getByTestId("diagram-title")).toHaveText("Payments ledger");
  await expect(page.getByTestId("checks-count").getByTestId("checks-warning-text")).toHaveText("1 warning");
  await page.getByTestId("checks-count").click();
  await expect(card(page)).toBeVisible();
  await expect(page.getByTestId("checks-summary")).toHaveText("1 warning · 1 suggestion");
}

test("Avro without a schema registry: Add Schema Registry, in one undo step", async ({ page, consoleErrors }) => {
  await openLedger(page);
  const warning = row(page, REGISTRY);
  await expect(warning).toHaveAttribute("data-severity", "warning");
  await expect(warning).toContainText("Avro on payments.v1, but no schema registry");
  await expect(warning).toContainText("Payments API writes it and Ledger writer reads it");
  await expect(page.getByTestId("check-marker-payments")).toHaveAttribute("data-severity", "warning");

  const nodes = page.getByTestId(/^node-(?!tooltip$|editor-)/);
  const before = await nodes.count();
  await page.getByTestId(`check-fix-${REGISTRY}`).click();
  await expect(page.getByTestId("toast")).toContainText("Added Schema Registry");
  await expect.poll(() => nodes.count()).toBe(before + 1);
  await expect(warning).toHaveCount(0);
  await expect(page.getByTestId("checks-warning-badge")).toHaveCount(0);
  // The flow is as it was: the topic still feeds the ledger writer.
  await expect(page.getByTestId("edge-payments-ledger")).toHaveCount(1);

  await page.getByTestId("check-fix-undo").click();
  await expect.poll(() => nodes.count()).toBe(before);
  await expect(warning).toBeVisible();
  await expect(page.getByTestId("checks-count").getByTestId("checks-warning-text")).toHaveText("1 warning");
  expectNoErrors(consoleErrors);
});

test("services reading secrets without an identity: the fix gives each its own; a chip shares one", async ({
  page,
  consoleErrors,
}) => {
  await openLedger(page);
  const suggestion = row(page, IDENTITY);
  await openCheckFinding(page, IDENTITY);
  await expect(suggestion).toHaveAttribute("data-severity", "suggestion");
  await expect(suggestion).toContainText("2 services read secrets without an identity");
  await expect(page.getByTestId(`check-fix-${IDENTITY}`)).toHaveText(/Add managed identities$/);
  await expect(page.getByTestId(`check-fix-option-0-${IDENTITY}`)).toHaveText("One shared identity");

  // The button, from the keyboard: an identity for each service (least privilege).
  const nodes = page.getByTestId(/^node-(?!tooltip$|editor-)/);
  const before = await nodes.count();
  await page.getByTestId(`check-fix-${IDENTITY}`).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("toast")).toContainText("Added Payments API identity, Ledger writer identity");
  await expect.poll(() => nodes.count()).toBe(before + 2);
  await expect(suggestion).toHaveCount(0);
  // Focus moves on to the finding that's left, never to the page.
  await expect(page.getByTestId(`check-select-${REGISTRY}`)).toBeFocused();

  // Undo, then the chip: one shared identity.
  await page.getByTestId("check-fix-undo").click();
  await expect.poll(() => nodes.count()).toBe(before);
  await openCheckFinding(page, IDENTITY);
  await page.getByTestId(`check-fix-option-0-${IDENTITY}`).click();
  await expect(page.getByTestId("toast")).toContainText("Added Managed Identity");
  await expect.poll(() => nodes.count()).toBe(before + 1);
  await expect(suggestion).toHaveCount(0);
  expectNoErrors(consoleErrors);
});
