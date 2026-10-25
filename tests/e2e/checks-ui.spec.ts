import {
  waitForChecks,
  waitForHistoryIdle,
  waitForAutosave,
  TEXT_END,
  TEXT_START,
  test,
  performanceTest,
  expect,
  gotoCanvas,
  openMissingDlq,
  currentDiagram,
  expectNoErrors,
  waitForStableViewport,
  fitDiagram,
  STORAGE_KEYS,
  savedDiagram,
} from "./fixtures";
import { readFileSync } from "node:fs";
import type { DiagramFile } from "../../src/model/types";
import type { Locator, Page } from "@playwright/test";
import { checksTyping } from "./checks-typing";

// Architecture checks in the editor: the count under the title, the Checks card (from the count, the canvas
// right-click, Ctrl+K and the View menu), fixes, Ignore and Turn off (kept in the file), markers while the card
// is open, the inspector's finding, and typing that stays responsive while checks run. data-testid only.

const MOD = "ControlOrMeta";
/** One warning: the ledger worker fails in "Poison invoices" and ledger-posting has no dead-letter queue.
 *  openMissingDlq imports it (tests/fixtures/checks/service-bus-missing-dlq.diagram.json). */
const WARNING = "dead-letter:posting-sub";
/** No findings at all. */
const CLEAN = "aks-app-config-key-vault";

const card = (page: Page) => page.getByTestId("checks-card");
/** A visible element's box (fails the test when there is none). */
async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Expected a visible element");
  return box;
}
const row = (page: Page, id: string) => page.getByTestId(`check-row-${id}`);

async function openFromCount(page: Page) {
  await page.getByTestId("checks-count").click();
  await expect(card(page)).toBeVisible();
}

test.describe("the count under the title", () => {
  test("shows warnings only, for an example with one, and nothing for a clean one", async ({ page, consoleErrors }) => {
    await openMissingDlq(page);
    await expect(page.getByTestId("checks-count")).toHaveText("1 warning");
    await gotoCanvas(page, CLEAN);
    await expect(page.getByTestId("node-api")).toBeVisible();
    // Checks have run (after the first idle) and found nothing: no "0 issues", no card.
    await waitForChecks(page);
    await expect(page.getByTestId("checks-count")).toHaveCount(0);
    await expect(card(page)).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  // Its acyclic processor paths remain provably loop-free through saved forwarding edits.
  test("suggestions alone show nothing; live view and presenting show no count", async ({ page }) => {
    await gotoCanvas(page, "outbox-saga-checkout");
    await expect(page.getByTestId("node-payments-dlq")).toBeVisible();
    await waitForChecks(page);
    await expect(page.getByTestId("checks-count")).toHaveCount(0);

    await openMissingDlq(page);
    await expect(page.getByTestId("checks-count")).toBeVisible();
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await expect(page.getByTestId("checks-count")).toHaveCount(0);
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("checks-count")).toBeVisible();
  });
});

test("diagram diagnostics keep guidance and valid element ignores through reload", async ({ page, consoleErrors }) => {
  const diagnostic = "message-loop:incomplete";
  const suggestion = "no-reader:payments-dlq";
  const diagram = JSON.parse(
    readFileSync(new URL("../../src/examples/outbox-saga-checkout.json", import.meta.url), "utf8"),
  ) as DiagramFile;
  // An acyclic showcase is provably loop-free despite its timeline edits. Give this diagnostic fixture
  // a possible processor cycle; zero share avoids circulating traffic or adding a capacity warning.
  diagram.edges.push({
    id: "possible-loop",
    from: "payment-svc",
    to: "payment-svc",
    kind: "async",
    props: { share: 0 },
  });
  await page.addInitScript(
    ({ key, diagram }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(diagram));
    },
    { key: STORAGE_KEYS.autosavePrefix + "outbox-saga-checkout", diagram },
  );
  await gotoCanvas(page, "outbox-saga-checkout");
  await expect(page.getByTestId("checks-count")).toHaveText("1 warning");
  await openFromCount(page);
  await expect(row(page, diagnostic)).toContainText("Timeline forwarding edits cannot be analyzed completely.");
  await expect(page.getByTestId(`check-select-${diagnostic}`)).toHaveCount(0);
  await page.getByTestId(`check-why-toggle-${diagnostic}`).focus();
  await page.getByTestId(`check-why-toggle-${diagnostic}`).press("Enter");
  await expect(page.getByTestId(`check-why-${diagnostic}`)).toHaveAttribute("open", "");
  await expect(page.getByTestId(`check-why-text-${diagnostic}`)).toBeVisible();
  await expect(page.getByTestId(`check-why-text-${diagnostic}`)).toHaveText(
    "Review message paths before and after timeline forwarding edits manually.",
  );
  await page.getByTestId(`check-more-${diagnostic}`).click();
  await expect(page.getByTestId(`check-ignore-${diagnostic}`)).toHaveCount(0);
  await page.getByTestId(`check-about-${diagnostic}`).click();
  await expect(page.getByTestId(`check-about-text-${diagnostic}`)).toBeVisible();

  // A real element ignore still works, while the diagram warning stays visible.
  await page.getByTestId(`check-more-${suggestion}`).click();
  await page.getByTestId(`check-ignore-${suggestion}`).click();
  await page.getByTestId(`check-ignore-confirm-${suggestion}`).click();
  await expect(row(page, suggestion)).toHaveCount(0);
  await expect(row(page, diagnostic)).toBeVisible();
  await waitForAutosave(page);
  const checks = { ignore: [{ rule: "no-reader", target: "payments-dlq" }] };
  await expect.poll(async () => (await savedDiagram(page)).checks).toEqual(checks);
  await page.reload();
  await expect(page.getByTestId("checks-count")).toHaveText("1 warning");
  await openFromCount(page);
  await expect(row(page, diagnostic)).toBeVisible();
  await expect(page.getByTestId(`check-select-${diagnostic}`)).toHaveCount(0);
  await expect(page.getByTestId("checks-ignored-toggle")).toHaveText("1 ignored");
  expect((await savedDiagram(page)).checks).toEqual(checks);
  expectNoErrors(consoleErrors);
});

test.describe("the Checks card", () => {
  test.beforeEach(async ({ page }) => {
    await openMissingDlq(page);
    await expect(page.getByTestId("checks-count")).toBeVisible();
  });

  test("opens from the count, the canvas right-click, Ctrl+K and the View menu", async ({ page, consoleErrors }) => {
    await openFromCount(page);
    await expect(page.getByTestId("checks-summary")).toHaveText("1 warning · 2 suggestions");
    await expect(page.getByTestId("checks-group-warnings").getByRole("listitem")).toHaveCount(1);
    await expect(row(page, WARNING)).toContainText("Failed messages are dropped");
    await page.getByTestId("checks-close").click();
    await expect(card(page)).toHaveCount(0);

    // The canvas right-click, next to Auto-layout.
    await waitForStableViewport(page);
    const wrap = page.getByTestId("canvas-wrap");
    const box = await boxOf(wrap);
    await wrap.click({ button: "right", position: { x: box.width / 2, y: 90 } });
    await page.getByTestId("context-menu-item-canvas.check-diagram").click();
    await expect(card(page)).toBeVisible();
    await page.getByTestId("checks-close").click();

    // Ctrl+K "Check diagram".
    await page.keyboard.press(`${MOD}+k`);
    await page.keyboard.type("Check diagram");
    await page.keyboard.press("Enter");
    await expect(card(page)).toBeVisible();

    // Esc closes it (nothing selected), one level.
    await page.getByTestId("checks-close").focus();
    await page.keyboard.press("Escape");
    await expect(card(page)).toHaveCount(0);

    // The top bar's View menu: Checks, a toggle.
    await page.getByTestId("view-button").click();
    await page.getByTestId("view-checks").click();
    await expect(card(page)).toBeVisible();
    await page.getByTestId("view-button").click();
    await expect(page.getByTestId("view-checks")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("view-checks").click();
    await expect(card(page)).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("a row selects what it involves; markers show only while the card is open", async ({ page }) => {
    await expect(page.getByTestId("check-markers")).toHaveCount(0);
    await openFromCount(page);
    await expect(page.getByTestId("check-marker-posting-sub")).toHaveAttribute("data-severity", "warning");
    await expect(page.getByTestId("check-marker-approval-sub")).toHaveAttribute("data-severity", "suggestion");
    await page.getByTestId(`check-select-${WARNING}`).click();
    // Both nodes it names are selected (the inspector says how many), and shown clear of the card.
    await expect(page.getByTestId("inspector-title")).toHaveText("2 selected");
    await page.getByTestId("check-element-worker").click();
    await expect(page.getByTestId("inspector-title")).toHaveText("Node");
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("Ledger worker");
    await page.getByTestId("checks-close").click();
    await expect(page.getByTestId("check-markers")).toHaveCount(0);
  });

  test("Fix applies in one undo step, and the finding goes", async ({ page, consoleErrors }) => {
    await openFromCount(page);
    const nodes = page.getByTestId(/^node-(?!tooltip$|editor-)/);
    const before = await nodes.count();
    await page.getByTestId(`check-fix-${WARNING}`).click();
    await expect(page.getByTestId("toast")).toContainText("Added ledger-posting DLQ");
    await expect.poll(() => nodes.count()).toBe(before + 1);
    await expect(row(page, WARNING)).toHaveCount(0);
    await expect(page.getByTestId("checks-count")).toHaveCount(0);
    // One step back: the queue and its route go, and the warning returns.
    await page.getByTestId("check-fix-undo").click();
    await expect.poll(() => nodes.count()).toBe(before);
    await expect(row(page, WARNING)).toBeVisible();
    await expect(page.getByTestId("checks-count")).toHaveText("1 warning");
    expectNoErrors(consoleErrors);
  });

  test("the inspector shows a selected node's finding, with its fix", async ({ page }) => {
    await page.getByTestId("node-posting-sub").click();
    const findings = page.getByTestId("inspector-findings");
    await expect(findings).toContainText("Failed messages are dropped");
    await expect(page.getByTestId(`inspector-check-fix-${WARNING}`)).toHaveText(/Add dead-letter queue/);
    await page.getByTestId("inspector-open-checks").click();
    await expect(card(page)).toBeVisible();
    // A node without findings has none.
    await fitDiagram(page);
    await page.getByTestId("node-ingest").click();
    await expect(page.getByTestId("inspector-findings")).toHaveCount(0);
  });

  test("turning a check off, then back on", async ({ page }) => {
    await openFromCount(page);
    await page.getByTestId(`check-more-${WARNING}`).click();
    await page.getByTestId(`check-turn-off-${WARNING}`).click();
    // dead-letter is off: its warning and its suggestion go; the DLQ suggestion (no-reader) stays.
    await expect(page.getByTestId("checks-summary")).toHaveText("1 suggestion");
    await expect(page.getByTestId("checks-count")).toHaveCount(0);
    await page.getByTestId("checks-off-toggle").click();
    await page.getByTestId("check-turn-on-dead-letter").click();
    await expect(page.getByTestId("checks-summary")).toHaveText("1 warning · 2 suggestions");
    await expect(page.getByTestId("checks-off-toggle")).toHaveCount(0);
  });
});

test("Ignore keeps its reason through reload, export and import, and Show again brings it back", async ({
  page,
  consoleErrors,
}, info) => {
  await openMissingDlq(page);
  const original = await currentDiagram(page);
  await openFromCount(page);
  await page.getByTestId(`check-more-${WARNING}`).click();
  await page.getByTestId(`check-ignore-${WARNING}`).click();
  await page.getByTestId(`check-ignore-reason-${WARNING}`).fill("The platform team owns its redrive");
  await page.getByTestId(`check-ignore-confirm-${WARNING}`).click();
  await expect(row(page, WARNING)).toHaveCount(0);
  await expect(page.getByTestId("checks-count")).toHaveCount(0);
  await expect(page.getByTestId("checks-ignored-toggle")).toHaveText("1 ignored");

  // Saved with the diagram: a reload keeps it.
  await page.reload();
  await expect(page.getByTestId("node-posting-sub")).toBeVisible();
  await waitForChecks(page);
  await expect(page.getByTestId("checks-count")).toHaveCount(0);

  // Exported in the file, and imported back.
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-json").click()]);
  const file = info.outputPath("checked.diagram.json");
  await download.saveAs(file);
  const saved = JSON.parse(readFileSync(file, "utf8"));
  expect(saved.checks).toEqual({
    ignore: [{ rule: "dead-letter", target: "posting-sub", reason: "The platform team owns its redrive" }],
  });
  await page.getByTestId("import-input").setInputFiles(file);
  await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
  await expect(page.getByTestId("example-picker")).not.toHaveAttribute("data-diagram-slug", original);
  await page.getByTestId("view-button").click();
  await page.getByTestId("view-checks").click();
  await page.getByTestId("checks-ignored-toggle").click();
  await expect(page.getByTestId("checks-ignored")).toContainText("The platform team owns its redrive");
  await page.getByTestId(`check-unignore-${WARNING}`).click();
  await expect(row(page, WARNING)).toBeVisible();
  await expect(page.getByTestId("checks-count")).toHaveText("1 warning");
  expectNoErrors(consoleErrors);
});

test("an empty diagram's check finishes: an empty state, not 'Checking…' forever", async ({ page }) => {
  await openMissingDlq(page);
  await page.getByTestId("import-input").setInputFiles({
    name: "empty.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "diagrams/v1", title: "Empty", nodes: [], edges: [] })),
  });
  await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
  await expect(page.getByTestId("diagram-title")).toHaveText("Empty");
  await page.getByTestId("view-button").click();
  await page.getByTestId("view-checks").click();
  await expect(page.getByTestId("checks-empty")).toContainText("Nothing to check yet");
  await expect(page.getByTestId("checks-running")).toHaveCount(0);
});

test("keyboard: Esc closes a finding's options first, then the card, and focus goes back", async ({ page }) => {
  await openMissingDlq(page);
  await expect(page.getByTestId("checks-count")).toBeVisible();
  await page.getByTestId("checks-count").focus();
  await page.keyboard.press("Enter");
  await expect(card(page)).toBeVisible();
  await page.getByTestId(`check-more-${WARNING}`).click();
  await page.getByTestId(`check-ignore-${WARNING}`).click();
  const reason = page.getByTestId(`check-ignore-reason-${WARNING}`);
  await reason.fill("abc");
  // Native line-boundary keys move the caret; they do not jump between findings.
  await reason.press(TEXT_START);
  await expect(reason).toBeFocused();
  await reason.press(TEXT_END);
  await expect(reason).toBeFocused();
  // Esc: the options close (focus back on ⋯), the card stays.
  await page.keyboard.press("Escape");
  await expect(reason).toHaveCount(0);
  await expect(page.getByTestId(`check-more-${WARNING}`)).toBeFocused();
  await expect(card(page)).toBeVisible();
  // Arrow keys between the findings' heads.
  await page.getByTestId(`check-select-${WARNING}`).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("check-select-dead-letter:approval-sub")).toBeFocused();
  // Esc again: the card closes and focus goes back to the count that opened it.
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByTestId("checks-count")).toBeFocused();
});

test("a fix clicked twice adds one dead-letter queue", async ({ page }) => {
  await openMissingDlq(page);
  await openFromCount(page);
  const nodes = page.getByTestId(/^node-(?!tooltip$|editor-)/);
  const before = await nodes.count();
  await page.getByTestId(`check-fix-${WARNING}`).dblclick();
  await expect.poll(() => nodes.count()).toBe(before + 1);
  await waitForChecks(page);
  await waitForHistoryIdle(page);
  await waitForAutosave(page);
  expect(await nodes.count()).toBe(before + 1);
});

test("at 1024 the open card overlaps no other chrome", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openMissingDlq(page);
  await openFromCount(page);
  await page.getByTestId(`check-more-${WARNING}`).click();
  const cardBox = await boxOf(card(page));
  const overlaps = (b: { x: number; y: number; width: number; height: number } | null) =>
    !!b &&
    b.x < cardBox.x + cardBox.width &&
    cardBox.x < b.x + b.width &&
    b.y < cardBox.y + cardBox.height &&
    cardBox.y < b.y + b.height;
  const chrome = [
    "diagram-card",
    "live-toggle",
    "inspector",
    "first-run-hint",
    // The canvas controls in the bottom-left corner.
    "fit-view-button",
    "undo-button",
    "redo-button",
    "shortcuts-button",
  ];
  for (const id of chrome) {
    const el = page.getByTestId(id);
    if (await el.count()) expect(overlaps(await el.first().boundingBox()), id).toBe(false);
  }
  // Inside the canvas, and nothing in the card is cut off sideways.
  const wrap = await boxOf(page.getByTestId("canvas-wrap"));
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(wrap.x + wrap.width);
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(wrap.y + wrap.height);
});

performanceTest(
  "typing a label does the same rendering work while checks run as with them held",
  async ({ page }, info) => {
    test.setTimeout(120_000);
    await checksTyping(page, info);
  },
);
