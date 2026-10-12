import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors, pageLoadTimeout } from "./fixtures";
import {
  callTool,
  installFakeLanguageModel,
  installFakeModelContext,
  MOD,
  openAdvanced,
  openAiPanel,
} from "./ai-helpers";

// Round 13 of the UX review (docs/DESIGN-REVIEW.md): quick-add names what it adds, an Undo toast goes when
// something else undoes, the AI panel's foot leaves the conversation room, Shift+box adds to the selection,
// Ctrl+K finds Present, and focus stays put (Esc on a node, presenting, a password link's Done).

const KAFKA = "kafka-order-pipeline";

type Box = { x: number; y: number; width: number; height: number };
async function box(page: Page, testId: string): Promise<Box> {
  const b = await page.getByTestId(testId).boundingBox();
  if (!b) throw new Error(`No box for ${testId}`);
  return b;
}

test("double-click quick-add opens the new node's name: typing names it, never reaching the canvas's keys", async ({
  page,
  consoleErrors,
}) => {
  await page.goto("./?view=canvas");
  await page.getByTestId("start-blank").click();
  await expect(page.getByTestId("canvas-empty")).toBeVisible({ timeout: pageLoadTimeout() });
  const wrap = await box(page, "canvas-wrap");
  await page.mouse.dblclick(wrap.x + wrap.width / 2, wrap.y + wrap.height / 2);
  await expect(page.getByTestId("quick-add-search")).toBeFocused();
  await page.keyboard.type("postgres");
  await page.keyboard.press("Enter");
  // The name is selected, ready to type over. "Ledger" has an L (Go live) and a T would add text: neither fires.
  await expect(page.getByTestId("node-editor-label")).toBeFocused();
  await page.keyboard.type("Ledger tables");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("node-postgres-1")).toContainText("Ledger tables");
  await expect(page.getByTestId("live-controls")).toHaveCount(0);
  await expect(page.getByTestId("node-editor")).toHaveCount(0);
  // The node and its name are one undo step.
  await page.keyboard.press(`${MOD}+z`);
  await expect(page.getByTestId("node-postgres-1")).toHaveCount(0);
  expectNoErrors(consoleErrors);
});

test("an Undo toast goes once Ctrl+Z undoes: its button would reverse a different change", async ({
  page,
  consoleErrors,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoCanvas(page, KAFKA);
  // Drag Payments service out of its boundary: the toast says so, with Undo.
  const p = await box(page, "node-payments");
  await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
  await page.mouse.down();
  await page.mouse.move(p.x + p.width / 2 + 40, p.y + p.height / 2 + 60, { steps: 6 });
  await page.mouse.move(p.x + p.width / 2 + 60, p.y + p.height / 2 + 170, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId("toast")).toContainText("left AKS");
  await expect(page.getByTestId("membership-undo")).toBeVisible();
  await page.keyboard.press(`${MOD}+z`);
  await expect(page.getByTestId("toast")).toHaveCount(0);
  expectNoErrors(consoleErrors);
});

test("with Advanced open under the on-device box, the AI panel's foot leaves the conversation its room", async ({
  page,
  consoleErrors,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await installFakeModelContext(page);
  await installFakeLanguageModel(page);
  await gotoCanvas(page, KAFKA);
  await openAiPanel(page);
  await expect(page.getByTestId("ai-foot")).toBeVisible();
  const res = await callTool(page, "edit_diagram", {
    summary: "Added a billing worker",
    ops: [
      { op: "add_node", kind: "Go service", label: "billing-worker", key: "w" },
      { op: "connect", from: "payments", to: "w" },
    ],
  });
  expect(res.isError).toBe(false);
  await expect(page.getByTestId("ai-turn-0-summary")).toBeVisible();
  await openAdvanced(page);
  const panel = await box(page, "ai-panel");
  const foot = await box(page, "ai-foot");
  // The foot (on-device box, status, Advanced) stops at 60% of the panel and scrolls inside past that.
  expect(foot.height).toBeLessThanOrEqual(panel.height * 0.6 + 1);
  const history = await box(page, "ai-history");
  const body = await page
    .getByTestId("ai-history")
    .evaluate((el) => el.parentElement?.getBoundingClientRect().height ?? 0);
  expect(body).toBeGreaterThan(panel.height * 0.3);
  expect(history.height).toBeGreaterThan(0);
  // Advanced's own controls are still reachable (the foot scrolls to them).
  await page.getByTestId("ai-request").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("ai-request")).toBeInViewport();
  expectNoErrors(consoleErrors);
});

test("Shift+drag on empty canvas adds the box's pick to the selection, as Shift+click does", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, KAFKA);
  await page.getByTestId("node-schemas").click();
  await expect(page.getByTestId("inspector-title")).toHaveText("Node");
  // Measured once the inspector has opened (the pane is narrower then).
  const n = await box(page, "node-shopper");
  await page.keyboard.down("Shift");
  await page.mouse.move(n.x - 14, n.y - 14);
  await page.mouse.down();
  await page.mouse.move(n.x + n.width / 2, n.y + n.height + 14, { steps: 6 });
  await page.mouse.move(n.x + n.width + 6, n.y + n.height + 14, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("inspector-title")).toHaveText("2 selected");
  // Without Shift, a box replaces the selection.
  const s = await box(page, "node-schemas");
  await page.mouse.move(s.x - 12, s.y - 12);
  await page.mouse.down();
  await page.mouse.move(s.x + s.width + 12, s.y + s.height + 12, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("inspector-title")).toHaveText("Node");
  expectNoErrors(consoleErrors);
});

test("Ctrl+K finds Present; presenting puts focus on the canvas, and Esc leaves", async ({ page, consoleErrors }) => {
  await gotoCanvas(page, KAFKA);
  await page.keyboard.press(`${MOD}+k`);
  await expect(page.getByTestId("command-input")).toBeFocused();
  await page.keyboard.type("present");
  await expect(page.getByTestId("command-item-view:present")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("present-exit")).toBeVisible();
  await expect(page.getByTestId("canvas-wrap")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("present-exit")).toHaveCount(0);
  await expect(page.getByTestId("present-toggle")).toBeVisible();
  expectNoErrors(consoleErrors);
});

test("Esc clears a node's selection and leaves focus on it; a second Esc never selects it again", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, KAFKA);
  await page.getByTestId("node-payments").click();
  await expect(page.getByTestId("inspector-title")).toHaveText("Node");
  const card = page.getByTestId("rf__node-payments");
  await expect(card).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("inspector-title")).toHaveCount(0);
  await expect(card).toBeFocused();
  await page.keyboard.press("Escape");
  // Give React Flow's own Esc (which selects a focused, unselected node) its chance.
  await page.waitForTimeout(150);
  await expect(page.getByTestId("inspector-title")).toHaveCount(0);
  await expect(card).toBeFocused();
  // Tab goes on to the next node in reading order, from where focus was.
  await page.keyboard.press("Tab");
  await expect(card).not.toBeFocused();
  await expect(page.getByTestId("canvas-wrap").locator(":focus")).toHaveCount(1);
  expectNoErrors(consoleErrors);
});

test("a password link's Done takes focus once the link is made", async ({ page, context, consoleErrors }) => {
  test.slow(); // PBKDF2 at 600,000 iterations
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await gotoCanvas(page, KAFKA);
  await page.getByTestId("file-button").click();
  await page.getByTestId("export-share-link-password").click();
  await page.getByTestId("password-link-input").fill("plum orbit lantern 42");
  await page.getByTestId("password-link-copy").click();
  await expect(page.getByTestId("password-link-done")).toBeFocused({ timeout: 20_000 });
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("password-link-dialog")).toHaveCount(0);
  expectNoErrors(consoleErrors);
});

test("the Live toggle is named Live, with L as its key; the sheet lists the File and slow-motion keys", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, KAFKA);
  const toggle = page.getByTestId("live-toggle");
  await expect(toggle).toHaveAccessibleName("Live");
  await expect(toggle).toHaveAttribute("aria-keyshortcuts", "L");
  await expect(page.getByTestId("palette")).toHaveAccessibleName("Stencils");
  await page.getByTestId("shortcuts-button").click();
  const sheet = page.getByTestId("shortcuts-dialog");
  await expect(sheet).toContainText("Open a file from this device");
  await expect(sheet).toContainText("Save to this device as a new file");
  await expect(sheet).toContainText("Slow motion: step back or on, hop by hop");
  expectNoErrors(consoleErrors);
});
