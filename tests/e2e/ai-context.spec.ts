import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors } from "./fixtures";
import { MOD, SLUG, must, openAskAi } from "./ai-helpers";

// Ask AI adapts to where you are: an empty diagram (Build with AI), the editor, a selection (Change with
// AI…) and live view (a scenario becomes a saved simulation; Explain is copy-only). Uses the public Kafka
// example (ids from src/examples/kafka-order-pipeline.json).

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

async function goLive(page: Page) {
  await page.getByTestId("live-toggle").click();
  await expect(page.getByTestId("live-controls")).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

test("the button is on every diagram screen and the panel fits each one", async ({ page, consoleErrors }) => {
  // Start card: Build with AI.
  await page.goto("./");
  await expect(page.getByTestId("start-card")).toBeVisible();
  await expect(page.getByTestId("ask-ai-toggle")).toBeVisible();
  await openAskAi(page);
  await expect(page.getByTestId("ai-empty")).toHaveAttribute("data-place", "create");
  await expect(page.getByTestId("ai-empty")).toContainText("Build with AI");
  await expect(page.getByTestId("ai-suggestion-0")).toContainText("An order pipeline on Kafka");
  await expect(page.getByTestId("ai-intent-explain")).toHaveCount(0);

  // Editor: change it, or explain it.
  await gotoCanvas(page, SLUG);
  await expect(page.getByTestId("ai-panel")).toBeVisible();
  await expect(page.getByTestId("ai-empty")).toHaveAttribute("data-place", "edit");
  await expect(page.getByTestId("ai-empty")).toContainText("Change this diagram");
  await expect(page.getByTestId("ai-intent-change")).toHaveText("Change");
  await page.getByTestId("ai-suggestion-1").click();
  await expect(page.getByTestId("ai-request")).toHaveValue(/dead-letter queue/);

  // Live view: simulate a scenario.
  await goLive(page);
  await expect(page.getByTestId("ai-panel")).toBeVisible();
  await expect(page.getByTestId("ask-ai-toggle")).toBeVisible();
  await expect(page.getByTestId("ai-empty")).toHaveAttribute("data-place", "live");
  await expect(page.getByTestId("ai-empty")).toContainText("Simulate a scenario");
  await expect(page.getByTestId("ai-intent-change")).toHaveText("Simulate");
  // Ctrl+I works in live view too: from inside the panel it folds it away.
  await page.getByTestId("ai-request").focus();
  await page.keyboard.press(`${MOD}+i`);
  await expect(page.getByTestId("ai-rail")).toBeVisible();
  await page.keyboard.press(`${MOD}+i`);
  await expect(page.getByTestId("ai-request")).toBeFocused();

  // Presenting hides it with the rest of the chrome.
  await page.keyboard.press("Escape");
  await page.getByTestId("live-toggle").click();
  await page.getByTestId("present-toggle").click();
  await expect(page.getByTestId("ai-dock")).toHaveCount(0);
  await expect(page.getByTestId("ai-rail")).toHaveCount(0);
  expectNoErrors(consoleErrors);
});

test("embeds have no Ask AI", async ({ page }) => {
  await page.goto(`./?embed=1&example=${SLUG}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("ask-ai-toggle")).toHaveCount(0);
  await expect(page.getByTestId("ai-rail")).toHaveCount(0);
});

test("Change with AI… on a selection names it in the copied prompt", async ({ page }) => {
  await gotoCanvas(page, SLUG);
  await page.getByTestId("node-payments").click();
  await page.getByTestId("node-payment-db").click({ modifiers: [MOD === "Meta" ? "Meta" : "Control"] });
  await page.getByTestId("node-payment-db").click({ button: "right" });
  await page.getByTestId("context-menu-item-item.change-with-ai").click();
  await expect(page.getByTestId("ai-request")).toBeFocused();
  await expect(page.getByTestId("ai-scope")).toContainText("2 selected");
  await expect(page.getByTestId("ai-empty")).toContainText("Change the selection");

  await page.getByTestId("ai-request").fill("Run these with 3 replicas");
  await page.getByTestId("ai-copy-prompt").click();
  const prompt = await clipboard(page);
  expect(prompt).toContain("The request is about these selected elements");
  expect(prompt).toMatch(/node "payments" "[^"]+"/);
  expect(prompt).toMatch(/node "payment-db" "[^"]+"/);
  expect(prompt.indexOf('node "payments"')).toBeLessThan(prompt.indexOf("Run these with 3 replicas"));

  // The chip is removable, and the prompt then covers the whole diagram.
  await page.getByTestId("ai-scope-clear").click();
  await expect(page.getByTestId("ai-scope")).toHaveCount(0);
  await page.getByTestId("ai-copy-prompt").click();
  await expect.poll(() => clipboard(page)).not.toContain("selected elements");

  // A single node by right-click: its own name on the chip.
  await page.getByTestId("node-inventory").click({ button: "right" });
  await page.getByTestId("context-menu-item-item.change-with-ai").click();
  await expect(page.getByTestId("ai-scope")).toContainText(/Inventory/i);
  // The turn remembers what it was about.
  await page.getByTestId("ai-request").fill("Three replicas");
  await page
    .getByTestId("ai-reply")
    .fill(JSON.stringify([{ op: "update", target: "inventory", props: { replicas: 3 } }]));
  await page.getByTestId("ai-apply").click();
  await expect(page.getByTestId("ai-turn-0")).toContainText(/About Inventory/i);
});

test("in live view a pasted scenario becomes a saved simulation that plays from the picker", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, SLUG);
  await goLive(page);
  await openAskAi(page);
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
  await expect(page.getByTestId("toast")).toContainText("Added simulation “AI storm”");

  // It's saved, in the picker, and playing.
  const picker = page.getByTestId("live-sim-picker");
  await expect(picker).toContainText("AI storm");
  await expect
    .poll(() => picker.evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.textContent ?? ""))
    .toBe("AI storm");
  await expect(page.getByTestId("live-clock")).toBeVisible();

  // One undo step takes it back out.
  await page.getByTestId("ai-toast-undo").click();
  await expect(picker).not.toContainText("AI storm");
  expectNoErrors(consoleErrors);
});

test("Explain is copy-only, and in live view it carries the running numbers", async ({ page }) => {
  await gotoCanvas(page, SLUG);
  await openAskAi(page);
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
      if (open) await openAskAi(page);
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
      // Icon-only below 1100 px, still named.
      await expect(page.getByTestId("ask-ai-toggle")).toHaveAccessibleName("Ask AI");

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
