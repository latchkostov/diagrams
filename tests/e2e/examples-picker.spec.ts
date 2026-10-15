import AxeBuilder from "@axe-core/playwright";
import { test, expect, publicExamples, expectNoErrors, openExample, currentDiagram, pageLoadTimeout } from "./fixtures";

/** Every public example's intended theme, in display order (src/examples/themes.ts and index.ts). */
const BY_THEME: Record<string, string[]> = {
  streaming: [
    "kafka-order-pipeline",
    "cqrs-event-sourcing",
    "cdc-analytics",
    "iot-telemetry",
    "partitions-vs-subscriptions",
    "shared-worker-pool",
  ],
  data: [
    "event-driven-data-platform",
    "nightly-batch-elt",
    "gcp-streaming-analytics",
    "rag-assistant",
    "shared-api-quotas",
  ],
  cloud: ["aws-serverless-orders", "aws-fanout", "aks-app-config-key-vault", "serverless-burst-buffer"],
  integration: ["webhook-ingestion", "notification-fanout", "azure-service-bus-integration"],
  reliability: [
    "outbox-saga-checkout",
    "multi-region-active-active",
    "branch-to-datacentre",
    "measured-order-capacity",
    "contoso-dmz",
  ],
};

const SLUG = "kafka-order-pipeline";

test("picker contains your work and a separate gallery entry; gallery filters and opens examples", async ({
  page,
  consoleErrors,
}) => {
  const diagrams: string[] = [];
  page.on("request", (request) => {
    if (/assets\/kafka-order-pipeline-/.test(request.url())) diagrams.push(request.url());
  });
  await page.goto("./");
  await page.getByTestId("example-picker").click();
  const menu = page.getByTestId("diagram-menu");
  await expect(menu).toHaveAttribute("role", "menu");
  await expect(menu.getByTestId(/^picker-option-.*(?<!-title)$/)).toHaveCount(1);
  await expect(page.getByTestId(`picker-option-${SLUG}`)).toHaveCount(0);
  await expect(page.getByTestId("picker-new")).toBeVisible();
  await page.getByTestId("picker-browse-examples").click();
  await expect(page.getByTestId("examples-search")).toBeFocused();
  expect(diagrams).toEqual([]);
  for (const [theme, slugs] of Object.entries(BY_THEME)) {
    const cards = page.getByTestId(`examples-theme-${theme}`).getByTestId(/^example-card-/);
    expect(
      await cards.evaluateAll((elements) =>
        elements.map((el) => el.getAttribute("data-testid")?.slice("example-card-".length)),
      ),
    ).toEqual(slugs);
  }
  await expect(page.getByTestId(/^example-card-/)).toHaveCount(publicExamples.length);
  await page.getByTestId("examples-search").fill("no such system");
  await expect(page.getByTestId("examples-empty")).toBeVisible();
  await page.getByTestId("examples-search").fill("kafka order");
  await expect(page.getByTestId(`example-card-${SLUG}`)).toBeVisible();
  await page.getByTestId(`example-open-${SLUG}`).click();
  await expect(page.getByTestId("examples-dialog")).toHaveCount(0);
  await expect(page.getByTestId("diagram-title")).toHaveText("Kafka order pipeline");
  await expect(page.getByTestId("example-badge")).toHaveText("Example");
  expectNoErrors(consoleErrors);
});

test("start card opens the gallery; feature filter and Run it start a saved simulation in live view", async ({
  page,
  consoleErrors,
}) => {
  await page.goto("./");
  await page.getByTestId("start-all-examples").click();
  await page.getByTestId("examples-feature").selectOption("rateLimits");
  await expect(page.getByTestId(/^example-card-/)).toHaveCount(1);
  await expect(page.getByTestId("example-card-notification-fanout")).toBeVisible();
  await page.getByTestId("example-run-notification-fanout").click();
  await expect(page.getByTestId("live-controls")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(page.getByTestId("live-sim-picker")).toHaveValue("shipping-wave");
  await expect(page).toHaveURL(/live=1/);
  expectNoErrors(consoleErrors);
});

test("first edit creates your named copy, preserves undo and leaves the deep-linked example pristine", async ({
  page,
  consoleErrors,
}) => {
  await page.goto(`./?example=${SLUG}`);
  await expect(page.getByTestId("example-badge")).toBeVisible();
  await page.getByTestId("canvas-view").evaluate((el) => el.setAttribute("data-test-instance", "kept"));
  await page.getByTestId("node-shopper").click();
  await page.getByTestId("inspector-field-label").fill("My storefront");
  await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
  const copy = await currentDiagram(page);
  await expect(page.getByTestId("canvas-view")).toHaveAttribute("data-test-instance", "kept");
  await expect(page.getByTestId("diagram-title")).toHaveText("Kafka order pipeline (copy)");
  await expect(page.getByTestId("example-badge")).toHaveCount(0);
  await expect(page.getByTestId("example-copy-notice")).toContainText("Your diagrams");
  await page.getByTestId("undo-button").click();
  await expect(page.getByTestId("node-shopper")).toContainText("Storefront");
  await page.getByTestId("redo-button").click();
  await expect(page.getByTestId("node-shopper")).toContainText("My storefront");
  await openExample(page, SLUG);
  await expect(page.getByTestId("diagram-title")).toHaveText("Kafka order pipeline");
  await expect(page.getByTestId("node-shopper")).toContainText("Storefront");
  await openExample(page, copy);
  await expect(page.getByTestId("node-shopper")).toContainText("My storefront");
  await page.reload();
  await expect(page.getByTestId("node-shopper")).toContainText("My storefront");
  await openExample(page, SLUG);
  await expect(page.getByTestId("node-shopper")).toContainText("Storefront");
  await expect(page.getByTestId("node-shopper")).not.toContainText("My storefront");
  await expect(page.getByTestId("diagram-title")).toHaveText("Kafka order pipeline");
  expectNoErrors(consoleErrors);
});

test("a title-first edit can be undone and stays undone after the owned copy reloads", async ({ page }) => {
  await page.goto(`./?example=${SLUG}`);
  await page.getByTestId("inspector-toggle").click();
  await page.getByTestId("inspector-field-title").fill("");
  await expect(page.getByTestId("inspector-field-title")).toHaveValue("");
  await page.getByTestId("inspector-field-title").pressSequentially("My renamed example");
  await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
  await expect(page.getByTestId("diagram-title")).toHaveText("My renamed example");
  await expect(page.getByTestId("toast")).toHaveCount(0);
  await page.getByTestId("undo-button").click();
  await expect(page.getByTestId("diagram-title")).toHaveText("Kafka order pipeline");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await page.reload();
  await expect(page.getByTestId("diagram-title")).toHaveText("Kafka order pipeline");
  await expect(page.getByTestId("example-badge")).toHaveCount(0);
});

test("a cleared title keeps an owned copy and later edits survive reload", async ({ page }) => {
  await page.goto(`./?example=${SLUG}`);
  await page.getByTestId("inspector-toggle").click();
  await page.getByTestId("inspector-field-title").fill("");
  await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
  await expect(page.getByTestId("inspector-field-title")).toHaveValue("");
  await page.getByTestId("node-shopper").click();
  await page.getByTestId("inspector-field-label").fill("Saved with no title");
  await expect(page.getByTestId("node-shopper")).toContainText("Saved with no title");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await page.reload();
  await expect(page.getByTestId("node-shopper")).toContainText("Saved with no title");
  await expect(page.getByTestId("diagram-title")).toHaveText("Untitled diagram");
});

test("keyboard menu navigation, dialog arrows, Escape and focus return", async ({ page }) => {
  await page.goto("./");
  const picker = page.getByTestId("example-picker");
  await picker.focus();
  await picker.press("Enter");
  await expect(page.getByTestId("picker-option-new")).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByTestId("picker-browse-examples")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("picker-new")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("examples-search")).toBeFocused();
  await page.getByTestId(`example-open-${SLUG}`).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId(`example-run-${SLUG}`)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("examples-dialog")).toHaveCount(0);
  await expect(picker).toBeFocused();
  await page.getByTestId("start-all-examples").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("start-all-examples")).toBeFocused();
});

for (const theme of ["light", "dark"] as const)
  for (const mobile of [false, true])
    test(`gallery fits and passes accessibility: ${theme} ${mobile ? "mobile" : "desktop"}`, async ({ page }) => {
      await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 });
      await page.goto("./");
      if (theme === "dark") await page.getByTestId("theme-toggle").click();
      await page.getByTestId("start-all-examples").click();
      const dialog = page.getByTestId("examples-dialog");
      await expect(dialog).toBeVisible();
      const rect = await dialog.boundingBox();
      expect(rect).toBeTruthy();
      if (!rect) throw new Error("No dialog");
      const viewport = page.viewportSize();
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(viewport?.width ?? 0);
      expect(rect.y + rect.height).toBeLessThanOrEqual(viewport?.height ?? 0);
      expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(axe.violations).toEqual([]);
      await page.getByTestId("examples-search").fill(SLUG);
      await page.getByTestId(`example-open-${SLUG}`).click();
      await expect(page.getByTestId("diagram-title")).toHaveText("Kafka order pipeline");
      const trigger = page.getByTestId("example-picker");
      const triggerBox = await trigger.boundingBox();
      expect(triggerBox?.width).toBeGreaterThan(100);
      expect(await page.getByTestId("topbar").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await trigger.click();
      await expect(page.getByTestId("picker-browse-examples")).toBeInViewport();
    });

test("gallery horizontal arrows follow the visual order in Arabic", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("diagrams.locale", "ar"));
  await page.goto("./");
  await page.getByTestId("start-all-examples").click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dir)).toBe("rtl");
  await page.getByTestId(`example-open-${SLUG}`).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId(`example-run-${SLUG}`)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId(`example-open-${SLUG}`)).toBeFocused();
  expect(await page.getByTestId("examples-dialog").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});
