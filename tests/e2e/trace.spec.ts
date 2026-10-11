import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect, expectNoErrors } from "./fixtures";

// Message trace: follow one message (and its fan-out copies) hop by hop, then turn its journey into
// a sequence diagram. Selectors are data-testid only.

const KAFKA = "kafka-order-pipeline";
const AZURE = "azure-service-bus-integration";
const menuItem = (page: Page, id: string) => page.getByTestId(`context-menu-item-${id}`);
const card = (page: Page) => page.getByTestId("trace-card");
const hops = (page: Page) => page.getByTestId(/^trace-hop-/);

async function openNodeMenu(page: Page, nodeId: string, actionId: string) {
  // A refit can dismiss a menu between opening it and choosing an action.
  await expect(async () => {
    await page.getByTestId(`node-${nodeId}`).click({ button: "right" });
    await menuItem(page, actionId).click({ timeout: 1000 });
  }).toPass({ timeout: 8000 });
}

async function openCanvasSubmenu(page: Page, parent: string, child: string) {
  await expect(async () => {
    const box = await page.getByTestId("canvas-wrap").boundingBox();
    if (!box) throw new Error("No canvas");
    await page.getByTestId("canvas-wrap").click({ button: "right", position: { x: box.width / 2, y: 90 } });
    await menuItem(page, parent).click({ timeout: 1000 });
    await menuItem(page, child).click({ timeout: 1000 });
  }).toPass({ timeout: 8000 });
}

/** Attribute values of every hop row, in order. */
const hopAttr = (page: Page, name: string) =>
  hops(page).evaluateAll((els, n) => els.map((e) => e.getAttribute(n)), name);

/** Traces the next message from the Kafka storefront and waits for its whole journey. */
async function traceKafkaOrder(page: Page) {
  await page.goto(`./?view=canvas&example=${KAFKA}&live=1&traffic=0&speed=4`);
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await openNodeMenu(page, "shopper", "sim.trace-next");
  await expect(card(page)).toHaveAttribute("data-state", "waiting");
  await expect(page.getByTestId("trace-waiting")).toContainText("Storefront");
  await page.getByTestId("trace-send-one").click();
  await expect(card(page)).toHaveAttribute("data-state", "done", { timeout: 20_000 });
}

test.describe("message trace", () => {
  test("a trace from a node's menu lists every hop, its copies and the total; Esc ends it", async ({
    page,
    consoleErrors,
  }) => {
    await traceKafkaOrder(page);
    const total = Number(await page.getByTestId("trace-total").getAttribute("data-ms"));
    expect(total).toBeGreaterThan(1500);
    expect(Number(await page.getByTestId("trace-hops").getAttribute("data-count"))).toBeGreaterThanOrEqual(12);
    // The order fans out: a copy reaches every consumer group, each with its own hops.
    expect(Number(await page.getByTestId("trace-copies").getAttribute("data-count"))).toBeGreaterThanOrEqual(4);
    const reached = await hopAttr(page, "data-node");
    for (const node of [
      "gateway",
      "orders",
      "order-events",
      "inventory",
      "payments",
      "notifications",
      "payment-events",
    ])
      expect(reached).toContain(node);
    expect((await hopAttr(page, "data-kind"))[0]).toBe("origin");
    await expect(page.getByTestId("trace-status")).toHaveAttribute("data-status", "done");

    // Esc backs out one level at a time: the right-clicked node's selection, then the trace.
    await page.keyboard.press("Escape");
    await expect(card(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card(page)).toHaveCount(0);
    // Esc backed out of the trace only: live view is still on.
    await expect(page.getByTestId("live-controls")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("the sequence dialog draws participants and arrows; copy as Mermaid; download SVG and PNG", async ({
    page,
    context,
    consoleErrors,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await traceKafkaOrder(page);
    await page.getByTestId("trace-sequence").click();
    const dialog = page.getByTestId("sequence-dialog");
    await expect(dialog).toBeVisible();
    const view = page.getByTestId("sequence-view");
    const participants = Number(await view.getAttribute("data-participants"));
    expect(participants).toBeGreaterThanOrEqual(10);
    await expect(dialog.getByTestId(/^seq-participant-/)).toHaveCount(participants);
    await expect(dialog.getByTestId("seq-participant-shopper")).toBeVisible();
    const arrows = Number(await view.getAttribute("data-arrows"));
    expect(arrows).toBeGreaterThan(15);
    await expect(dialog.getByTestId(/^seq-arrow-/)).toHaveCount(arrows);
    const styles = await dialog
      .getByTestId(/^seq-arrow-/)
      .evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("data-style")))].sort());
    expect(styles).toEqual(["async", "reply", "sync"]);

    await page.getByTestId("sequence-copy-mermaid").click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("sequenceDiagram");
    const mermaid = await page.evaluate(() => navigator.clipboard.readText());
    expect(mermaid).toContain("participant shopper as Storefront");
    expect(mermaid).toMatch(/shopper->>gateway: OrderRequest/);
    expect(mermaid).toMatch(/orders-\)order_events: OrderPlaced/);

    const [svg] = await Promise.all([page.waitForEvent("download"), page.getByTestId("sequence-download-svg").click()]);
    expect(svg.suggestedFilename()).toMatch(/sequence\.svg$/);
    const text = readFileSync(await svg.path(), "utf8");
    expect(text.startsWith("<svg")).toBe(true);
    expect(text).toContain('data-testid="seq-participant-payments"');

    const [png] = await Promise.all([page.waitForEvent("download"), page.getByTestId("sequence-download-png").click()]);
    expect(png.suggestedFilename()).toMatch(/sequence\.png$/);
    expect(
      readFileSync(await png.path())
        .subarray(1, 4)
        .toString(),
    ).toBe("PNG");

    // Esc closes the dialog first, then the trace.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(card(page)).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("the live bar's ⋯ and the command palette start a trace", async ({ page, consoleErrors }) => {
    await page.goto(`./?view=canvas&example=${KAFKA}&live=1&speed=2`);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await page.getByTestId("live-more").click();
    await page.getByTestId("live-trace-message").click();
    await expect(card(page)).toHaveAttribute("data-state", /flight|done/, { timeout: 10_000 });
    await page.getByTestId("trace-card-close").click();
    await expect(card(page)).toHaveCount(0);

    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    await page.getByTestId("command-input").fill("slowest");
    await page.getByTestId("command-item-action:sim.trace-message:slowest").click();
    await expect(card(page)).toHaveAttribute("data-state", "done", { timeout: 10_000 });
    expectNoErrors(consoleErrors);
  });

  test("a dead-lettered trace on Poison invoices shows the retries and the DLQ hop", async ({
    page,
    consoleErrors,
  }) => {
    await page.goto(`./?view=canvas&example=${AZURE}&live=1&sim=poison&speed=8`);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await openCanvasSubmenu(page, "sim.trace-message", "sim.trace-message:dead-letter");
    await expect(card(page)).toBeVisible();
    // The story pauses on a note at 10 s; continue until the trace has its dead letter.
    await expect
      .poll(
        async () => {
          const play = page.getByTestId("live-play");
          if ((await play.getAttribute("data-state")) === "waiting") await play.click();
          return card(page).getAttribute("data-state");
        },
        { timeout: 30_000 },
      )
      .toBe("dlq");
    await expect(page.getByTestId("trace-dlq")).toBeVisible();
    expect(Number(await page.getByTestId("trace-retries").getAttribute("data-count"))).toBeGreaterThan(0);
    const kinds = await hopAttr(page, "data-kind");
    expect(kinds).toContain("fail");
    expect(kinds).toContain("deadletter");
    expect(kinds.at(-1)).toBe("dlq");
    expect((await hopAttr(page, "data-node")).at(-1)).toBe("dlq");

    await page.getByTestId("trace-sequence").click();
    await expect(
      page
        .getByTestId("sequence-dialog")
        .getByTestId(/^seq-arrow-/)
        .last(),
    ).toHaveAttribute("data-style", "dlq");
    expectNoErrors(consoleErrors);
  });
});
