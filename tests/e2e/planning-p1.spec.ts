import type { Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { planningFixture } from "../../src/lab/planningFixture";
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  pauseClock,
  waitForStableViewport,
  expectNoErrors,
  STORAGE_KEYS,
} from "./fixtures";

const SLUG = "kafka-order-pipeline";
const KEY = STORAGE_KEYS.autosavePrefix + SLUG;
const shots = "docs/screenshots/round36";

async function seed(page: Page, kind: "orders" | "connections" | "no-reader" = "orders", live = false) {
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("p1-seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("p1-seeded", "1");
      }
    },
    [KEY, JSON.stringify(planningFixture(kind))] as const,
  );
  if (live) await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1`);
  else await gotoCanvas(page, SLUG);
  await waitForStableViewport(page);
}

test("P1: Orders arithmetic and the 50% fix are keyboard accessible and undoable", async ({ page, consoleErrors }) => {
  await seed(page);
  await page.getByTestId("node-orders").click();
  const x = page.getByTestId("planning-explanation-orders");
  await expect(x.getByTestId("planning-arithmetic")).toContainText("~1 req/s (1 replica × 4 slots ÷ 4 s)");
  await expect(x.getByTestId("planning-contributors")).toContainText("Checkout: 3 req/s");
  await expect(x.getByTestId("planning-growth")).toContainText("2 req/s");
  await expect(x.getByTestId("planning-target")).toContainText("3 replicas at 100%; 6 replicas at the 50% target");
  await expect(page.getByTestId("planning-connections")).not.toContainText("Retry:");
  await page.keyboard.press("Shift+Digit1");
  await waitForStableViewport(page);
  await x.getByTestId("planning-apply").scrollIntoViewIfNeeded();
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/orders-inspector.png` });
  await x.getByTestId("planning-apply").focus();
  await page.keyboard.press("Enter");
  await expect(x.getByTestId("planning-arithmetic")).toContainText("6 replicas × 4 slots");
  await page.getByTestId("undo-button").click();
  await expect(x.getByTestId("planning-arithmetic")).toContainText("1 replica × 4 slots");
  expectNoErrors(consoleErrors);
});

test("P1: two policies share one pool; removing and reconnecting edges refresh the inspector", async ({
  page,
  consoleErrors,
}) => {
  await seed(page, "connections");
  await page.getByTestId("node-orders").click();
  await expect(page.getByTestId("planning-pool")).toHaveCount(1);
  await expect(page.getByTestId("planning-connection-consume")).toContainText("Group: billing");
  await expect(page.getByTestId("planning-connection-consume2")).toContainText("Group: returns");
  await expect(page.getByTestId("planning-connection-audit")).toContainText("OrderHandled");
  await expect(page.getByTestId("planning-connection-call")).toHaveText("Calls Payments");
  // Policy separators and secondary ink must use the app's theme tokens.
  const colors = await page.getByTestId("planning-connection-consume").evaluate((el) => {
    const policy = el.querySelector('[data-testid="planning-group"]');
    if (!policy) throw new Error("Missing consumer group policy");
    const reference = document.createElement("span");
    reference.style.color = "var(--text-3)";
    reference.style.borderBlockStart = "1px solid var(--line)";
    el.append(reference);
    const expected = getComputedStyle(reference);
    const actual = getComputedStyle(el);
    const result = {
      border: actual.borderBlockStartColor,
      width: actual.borderBlockStartWidth,
      expectedBorder: expected.borderBlockStartColor,
      ink: getComputedStyle(policy).color,
      expectedInk: expected.color,
    };
    reference.remove();
    return result;
  });
  expect(colors.width).toBe("1px");
  expect(colors.border).toBe(colors.expectedBorder);
  expect(colors.ink).toBe(colors.expectedInk);
  await page.keyboard.press("Shift+Digit1");
  await waitForStableViewport(page);
  await page.getByTestId("planning-connection-call").scrollIntoViewIfNeeded();
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/connections.png` });
  // Reconnect through the existing keyboard action, then reselect the worker.
  await page.getByTestId("edge-consume").click();
  await page.keyboard.press("Control+k");
  await page.keyboard.type("reconnect to payments");
  await expect(page.getByTestId("command-item-action:reconnect-target:payments")).toBeVisible();
  await page.keyboard.press("Enter");
  await page.getByTestId("node-orders").click();
  await expect(page.getByTestId("planning-connection-consume")).toHaveCount(0);
  await expect(page.getByTestId("planning-connection-consume2")).toBeVisible();
  await page.getByTestId("edge-consume2").click();
  await page.keyboard.press("Delete");
  await page.getByTestId("node-orders").click();
  await expect(page.getByTestId("planning-connections")).not.toContainText("Consumes");
  await expect(page.getByTestId("planning-pool")).toHaveCount(1);
  expectNoErrors(consoleErrors);
});

test("P1: live hover and keyboard focus show the same configured explanation and observed units", async ({
  page,
  consoleErrors,
}) => {
  await seed(page, "orders", true);
  await page.getByTestId("node-orders").hover();
  const card = page.getByTestId("node-detail-orders");
  await expect(card.getByTestId("planning-arithmetic")).toContainText("~1 req/s");
  await expect(card.getByTestId("planning-contributors")).toContainText("Checkout: 3 req/s");
  await expect(card.getByTestId("planning-observed")).toContainText("Observed now");
  await expect.poll(() => card.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  const bounds = await card.boundingBox(),
    canvas = await page.getByTestId("canvas-wrap").boundingBox();
  expect(
    bounds &&
      canvas &&
      bounds.x >= canvas.x &&
      bounds.x + bounds.width <= canvas.x + canvas.width &&
      bounds.y >= canvas.y &&
      bounds.y + bounds.height <= canvas.y + canvas.height,
  ).toBe(true);
  await pauseClock(page);
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/orders-hover.png` });
  // Canvas roving focus: click selects/focuses the node; moving off it keeps the focused explanation.
  await page.getByTestId("node-orders").click();
  await page.getByTestId("diagram-title").hover();
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("role", "tooltip");
  expectNoErrors(consoleErrors);
});

test("P1: no-reader explains the producer and offers exactly one consumer action", async ({ page, consoleErrors }) => {
  await seed(page, "no-reader");
  await page.getByTestId("node-topic").click();
  const x = page.getByTestId("planning-explanation-topic");
  await expect(x).toHaveAttribute("data-fix-id", "no-reader:topic");
  await expect(x.getByTestId("planning-arithmetic")).toContainText("nobody reads it");
  await expect(x.getByTestId("planning-contributors")).toContainText("Checkout: 3 msg/s");
  await expect(x.getByTestId("planning-apply")).toHaveText("Add a consumer");
  await x.getByTestId("planning-apply").click();
  await page.getByTestId("node-topic").click();
  await expect(x).toHaveCount(0);
  await page.getByTestId("undo-button").click();
  await page.getByTestId("node-topic").click();
  await expect(x).toHaveAttribute("data-reason", "no-reader");
  expectNoErrors(consoleErrors);
});

test("P1: model upgrade previews unchanged capacity, is undoable and exposes a legacy loss report", async ({
  page,
  consoleErrors,
}) => {
  await seed(page);
  await page.keyboard.press("Control+k");
  await page.keyboard.type("diagram properties");
  await page.keyboard.press("Enter");
  await page.getByTestId("planning-preview").click();
  await expect(page.getByTestId("planning-upgrade-preview")).toContainText("Orders: 1 msg/s → 1 msg/s");
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/upgrade-preview.png` });
  await page.getByTestId("planning-upgrade").click();
  await expect(page.getByTestId("planning-model")).toContainText("Planning revision p1");
  await page.getByTestId("planning-preview").click();
  await expect(page.getByTestId("planning-legacy-preview")).toContainText("planning.revision");
  const pending = page.waitForEvent("download");
  await page.getByTestId("planning-legacy-download").click();
  expect((await pending).suggestedFilename()).toBe("legacy.diagram.json");
  await page.getByTestId("undo-button").click();
  await page.keyboard.press("Control+k");
  await page.keyboard.type("diagram properties");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("planning-model")).toContainText("Legacy playback");
  expectNoErrors(consoleErrors);
});
