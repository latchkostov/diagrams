import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors, fitDiagram } from "./fixtures";
import { MOD, SLUG, must, openAdvanced, openAiPanel } from "./ai-helpers";

// The AI panel on every diagram screen: the idle state that says how to use AI here, Copy for AI for a
// selection, and Advanced's copy-and-paste flow that adapts to the place (an empty diagram, the editor,
// live view, where a scenario becomes a saved simulation and Explain is copy-only). Uses the public
// Kafka example (ids from src/examples/kafka-order-pipeline.json).

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

async function goLive(page: Page) {
  await page.getByTestId("live-toggle").click();
  await expect(page.getByTestId("live-controls")).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

test("the button is on every diagram screen and the idle panel says how to use AI here", async ({
  page,
  consoleErrors,
}) => {
  // Start card.
  await page.goto("./");
  await expect(page.getByTestId("start-card")).toBeVisible();
  await expect(page.getByTestId("ai-rail")).toBeVisible();
  await openAiPanel(page);
  await expect(page.getByTestId("ai-empty")).toContainText("Ask an AI agent");
  await expect(page.getByTestId("ai-empty")).toContainText("undo or revert");
  // Advanced is closed by default; open, it describes a new diagram (no Explain on an empty one).
  await expect(page.getByTestId("ai-request")).toHaveCount(0);
  await openAdvanced(page);
  await expect(page.getByTestId("ai-intent-explain")).toHaveCount(0);

  // Editor: Advanced is remembered open; it changes the diagram, or explains it.
  await gotoCanvas(page, SLUG);
  await expect(page.getByTestId("ai-panel")).toBeVisible();
  await expect(page.getByTestId("ai-request")).toBeVisible();
  await expect(page.getByTestId("ai-intent-change")).toHaveText("Change");

  // Live view: simulate a scenario.
  await goLive(page);
  await expect(page.getByTestId("ai-panel")).toBeVisible();
  await expect(page.getByTestId("ai-intent-change")).toHaveText("Simulate");
  // Ctrl+I works in live view too: from inside the panel it folds it away.
  await page.getByTestId("ai-request").focus();
  await page.keyboard.press(`${MOD}+i`);
  await expect(page.getByTestId("ai-rail")).toBeVisible();
  await page.keyboard.press(`${MOD}+i`);
  await expect(page.getByTestId("ai-panel")).toBeFocused();

  // Presenting hides it with the rest of the chrome.
  await page.keyboard.press("Escape");
  await page.getByTestId("live-toggle").click();
  await page.getByTestId("present-toggle").click();
  await expect(page.getByTestId("ai-dock")).toHaveCount(0);
  await expect(page.getByTestId("ai-rail")).toHaveCount(0);
  expectNoErrors(consoleErrors);
});

test("embeds have no AI panel", async ({ page }) => {
  await page.goto(`./?embed=1&example=${SLUG}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("ai-dock")).toHaveCount(0);
  await expect(page.getByTestId("ai-rail")).toHaveCount(0);
});

test("Copy for AI puts the selection's ids and labels on the clipboard, for the person's agent", async ({ page }) => {
  await gotoCanvas(page, SLUG);
  await page.getByTestId("node-payments").click();
  // The inspector opened and narrowed the canvas, keeping Payments in view: its database can be past the edge.
  await fitDiagram(page);
  await page.getByTestId("node-payment-db").click({ modifiers: ["ControlOrMeta"] });
  await page.getByTestId("node-payment-db").click({ button: "right" });
  await page.getByTestId("context-menu-item-item.copy-for-ai").click();
  await expect(page.getByTestId("toast")).toContainText("Copied 2 elements for your AI");
  const text = await clipboard(page);
  expect(text).toContain("In my Live Diagrams diagram");
  expect(text).toMatch(/- node "payments" "[^"]+"/);
  expect(text).toMatch(/- node "payment-db" "[^"]+"/);

  // One node by right-click: its own name in the toast.
  await page.getByTestId("node-inventory").click({ button: "right" });
  await page.getByTestId("context-menu-item-item.copy-for-ai").click();
  await expect(page.getByTestId("toast")).toContainText(/Copied “Inventory/i);
  expect(await clipboard(page)).toMatch(/- node "inventory"/);
  // It never opens the panel: the request goes to the person's agent.
  await expect(page.getByTestId("ai-panel")).toHaveCount(0);
});

test("in live view a pasted scenario becomes a saved simulation that plays from the picker", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, SLUG);
  await goLive(page);
  await openAdvanced(page);
  await page.getByTestId("ai-request").fill("A storm of 40 orders, then payments goes down at 5 s");
  await page.getByTestId("ai-copy-prompt").click();
  const prompt = await clipboard(page);
  expect(prompt).toContain("Turn my scenario into one simulation");
  expect(prompt).toContain("A storm of 40 orders");

  const reply = {
    title: "AI storm",
    durationSec: 30,
    traffic: [{ from: "shopper", pattern: "burst", count: 40 }],
    events: [{ atSec: 5, node: "payments", do: "down", note: "Payments goes down" }],
  };
  await page.getByTestId("ai-reply").fill("```json\n" + JSON.stringify(reply, null, 2) + "\n```");
  await expect(page.getByTestId("ai-reply-status")).toContainText("Simulation “AI storm” ready");
  await page.getByTestId("ai-apply").click();
  await expect(page.getByTestId("ai-error")).toHaveCount(0);
  await expect(page.getByTestId("ai-turn-0-summary")).toHaveText("Added simulation “AI storm”");

  // It's saved, in the picker, and playing.
  const picker = page.getByTestId("live-sim-picker");
  await expect(picker).toContainText("AI storm");
  await expect
    .poll(() => picker.evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.textContent ?? ""))
    .toBe("AI storm");
  await expect(page.getByTestId("live-clock")).toBeVisible();

  // One undo step takes it back out.
  await page.getByTestId("ai-turn-0-undo").click();
  await expect(picker).not.toContainText("AI storm");
  expectNoErrors(consoleErrors);
});

test("Explain is copy-only, and in live view it carries the running numbers", async ({ page }) => {
  await gotoCanvas(page, SLUG);
  await openAdvanced(page);
  await page.getByTestId("ai-intent-explain").click();
  await expect(page.getByTestId("ai-reply")).toHaveCount(0);
  await expect(page.getByTestId("ai-apply")).toHaveCount(0);
  await expect(page.getByTestId("ai-explain-note")).toContainText("nothing to paste back");
  await page.getByTestId("ai-request").fill("Where could this fail?");
  await page.getByTestId("ai-copy-prompt").click();
  let prompt = await clipboard(page);
  expect(prompt).toContain("Explain this architecture diagram");
  expect(prompt).toContain('"payments"'); // describe_diagram output
  expect(prompt).toContain("Where could this fail?");
  expect(prompt).not.toContain("Live view");

  await goLive(page);
  await page.getByTestId("ai-intent-explain").click();
  await page.waitForTimeout(600);
  await page.getByTestId("ai-copy-prompt").click();
  prompt = await clipboard(page);
  expect(prompt).toMatch(/Live view, (playing|paused)/);
  expect(prompt).toContain("messages in flight");
});

test("no overlap in the top bar or between canvas, inspector and dock at 1024", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await gotoCanvas(page, SLUG);
    await page.getByTestId("node-payments").click();
    for (const open of [false, true]) {
      if (open) await openAdvanced(page);
      const items = await page.getByTestId("topbar").evaluate((bar) =>
        [...bar.querySelectorAll<HTMLElement>(":scope > *, [data-testid='topbar-actions'] > *")]
          .filter((el) => el.getAttribute("data-testid") !== "topbar-actions" && el.getBoundingClientRect().width > 0)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { id: el.getAttribute("data-testid") ?? el.className, left: r.left, right: r.right };
          }),
      );
      const bar = must(await page.getByTestId("topbar").boundingBox(), "top bar");
      for (const item of items) {
        expect(item.left, item.id).toBeGreaterThanOrEqual(bar.x);
        expect(item.right, item.id).toBeLessThanOrEqual(bar.x + bar.width);
      }
      const sorted = [...items].sort((a, b) => a.left - b.left);
      for (let i = 1; i < sorted.length; i++)
        expect(sorted[i].left, `${sorted[i - 1].id} | ${sorted[i].id}`).toBeGreaterThanOrEqual(sorted[i - 1].right);

      const canvas = must(await page.getByTestId("canvas-wrap").boundingBox(), "canvas");
      const inspector = must(await page.getByTestId("inspector").boundingBox(), "inspector");
      const side = must(await page.getByTestId(open ? "ai-dock" : "ai-rail").boundingBox(), "dock");
      expect(canvas.x + canvas.width).toBeLessThanOrEqual(inspector.x + 0.5);
      expect(inspector.x + inspector.width).toBeLessThanOrEqual(side.x + 0.5);
      expect(side.x + side.width).toBeLessThanOrEqual(1024.5);
      if (open) expect(canvas.width).toBeGreaterThan(500);
    }
    await page.getByTestId("ai-collapse").click();
  }
});
