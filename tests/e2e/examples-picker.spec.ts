import AxeBuilder from "@axe-core/playwright";
import {
  test,
  expect,
  publicExamples,
  expectNoErrors,
  openExample,
  currentDiagram,
  pageLoadTimeout,
  pauseClock,
} from "./fixtures";

import type { Page } from "@playwright/test";

async function seedWork(page: Page, shared = false) {
  await page.addInitScript((shared) => {
    const entries = Array.from({ length: 9 }, (_, i) => {
      const slug = `my-${String(i).padStart(6, "0")}`;
      const title = `Saved work ${i}`;
      const diagram = {
        format: "diagrams/v1",
        title,
        nodes: [{ id: "worker", stencil: "generic.service", label: "Worker", x: 0, y: 0 }],
        edges: [],
      };
      localStorage.setItem(`diagrams.doc.v1:${slug.slice(3)}`, JSON.stringify(diagram));
      if (shared && i === 0)
        localStorage.setItem("diagrams.shared.v1", JSON.stringify({ ...diagram, title: "Shared work" }));
      return { slug, title, createdAt: i, updatedAt: i, nodes: 1 };
    });
    localStorage.setItem("diagrams.library.v1", JSON.stringify({ format: "diagrams/library/v1", entries }));
  }, shared);
}

test("opens older saved work through picker overflow", async ({ page }) => {
  await seedWork(page);
  await page.goto("./");
  await expect(page.getByTestId("diagram-title")).toHaveText("Saved work 8");
  await openExample(page, "my-000000");
  await expect(page.getByTestId("diagram-title")).toHaveText("Saved work 0");
  expect(await currentDiagram(page)).toBe("my-000000");
});

test("inactive shared work stays reachable with an overflowing library", async ({ page }) => {
  await seedWork(page, true);
  await page.goto("./");
  await expect(page.getByTestId("diagram-title")).toHaveText("Saved work 8");
  await openExample(page, "shared");
  await expect(page.getByTestId("diagram-title")).toHaveText("Shared work");
  expect(await currentDiagram(page)).toBe("shared");
});

test("ordinary autosaves serialize the diagram once and reuse that result", async ({ page }) => {
  await seedWork(page);
  await page.goto("./");
  await page.getByTestId("node-worker").click();
  await page.clock.install();
  await pauseClock(page);
  await page.getByTestId("inspector-field-label").fill("Edited worker");
  const serializations = await page.evaluate(() => {
    const stringify = JSON.stringify;
    let calls = 0;
    JSON.stringify = function (...args: Parameters<typeof stringify>) {
      const value = args[0] as { format?: string; title?: string } | null;
      if (value?.format === "diagrams/v1" && value.title === "Saved work 8") calls++;
      return stringify(...args);
    };
    try {
      window.dispatchEvent(new PageTransitionEvent("pagehide"));
      return calls;
    } finally {
      JSON.stringify = stringify;
    }
  });
  expect(serializations).toBe(1);
});

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

test("Run it starts and restarts the currently open example", async ({ page }) => {
  await page.goto(`./?example=${SLUG}`);
  await expect(page.getByTestId("example-badge")).toBeVisible();
  await page.clock.install();
  await pauseClock(page);
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByTestId("example-picker").click();
    await page.getByTestId("picker-browse-examples").click();
    await page.getByTestId(`example-run-${SLUG}`).click();
    await expect(page.getByTestId("live-controls")).toBeVisible({ timeout: pageLoadTimeout() });
    await expect(page.getByTestId("live-sim-picker")).toHaveValue("black-friday");
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
    await expect(page.getByTestId("live-clock")).toHaveAttribute("data-ms", "0");
    await page.clock.runFor(1000);
    await expect
      .poll(async () => Number(await page.getByTestId("live-clock").getAttribute("data-ms")))
      .toBeGreaterThan(0);
    await page.getByTestId("live-play").click();
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
  }
});

test("copy notice stays clear of expanded stencil controls", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`./?example=${SLUG}`);
  await page.getByTestId("node-shopper").click();
  await page.getByTestId("inspector-field-label").fill("My storefront");
  const notice = page.getByTestId("example-copy-notice");
  await expect(notice).toBeVisible();
  const search = page.getByTestId("palette-search");
  if (!(await search.isVisible())) await page.getByTestId("palette-toggle").click();
  await expect(search).toBeVisible();
  for (const control of [search, page.getByTestId("palette-toggle")]) {
    const a = await notice.boundingBox();
    const b = await control.boundingBox();
    if (!a || !b) throw new Error("Missing notification or stencil control");
    expect(a.x >= b.x + b.width || b.x >= a.x + a.width || a.y >= b.y + b.height || b.y >= a.y + a.height).toBe(true);
  }
});

for (const locale of ["en", "ar"])
  test(`Run it includes its visible action in the accessible name: ${locale}`, async ({ page }) => {
    await page.addInitScript((locale) => localStorage.setItem("diagrams.locale", locale), locale);
    await page.goto("./");
    await page.getByTestId("start-all-examples").click();
    const run = page.getByTestId(`example-run-${SLUG}`);
    await expect(run).toBeVisible();
    await expect(run).toHaveAccessibleName(`${await run.innerText()} Kafka order pipeline`);
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

test("promotion preserves another tab's mounted session, pending edits and undo", async ({ page, context }) => {
  await page.goto(`./?example=${SLUG}`);
  await expect(page.getByTestId("node-shopper")).toBeVisible();
  const other = await context.newPage();
  await other.goto(`./?example=${SLUG}`);
  await other.getByTestId("node-shopper").click();
  await other.clock.install();
  await pauseClock(other);
  await other.getByTestId("inspector-field-label").fill("Pending in other tab");
  await other.getByTestId("canvas-view").evaluate((el) => el.setAttribute("data-test-instance", "retained"));
  await page.getByTestId("node-shopper").click();
  await page.getByTestId("inspector-field-label").fill("Owned in first tab");
  // Playwright's clock is context-wide: flush this tab without advancing the other's pending timer.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
  const firstCopy = await currentDiagram(page);
  // Observe the real storage event before checking that it did not replace the mounted canvas.
  await expect
    .poll(() =>
      other.evaluate(
        () => Object.keys(localStorage).filter((key) => key.startsWith("diagrams.library-entry.v1:")).length,
      ),
    )
    .toBe(1);
  await other.getByTestId("file-button").click();
  await other.keyboard.press("Escape");
  await expect(other.getByTestId("canvas-view")).toHaveAttribute("data-test-instance", "retained");
  await expect(other.getByTestId("node-shopper")).toContainText("Pending in other tab");
  await other.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect(other.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
  const secondCopy = await currentDiagram(other);
  expect(secondCopy).not.toBe(firstCopy);
  await other.getByTestId("undo-button").click();
  await expect(other.getByTestId("node-shopper")).toContainText("Storefront");
  await other.getByTestId("redo-button").click();
  await expect(other.getByTestId("node-shopper")).toContainText("Pending in other tab");
  await expect(page.getByTestId("node-shopper")).toContainText("Owned in first tab");
  await other.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await other.clock.resume();
  await other.reload();
  await expect(other.getByTestId("node-shopper")).toContainText("Pending in other tab");
  await other.close();
});

test("a failed example copy debounces retries, warns once and recovers the latest edits", async ({ page }) => {
  await page.goto(`./?example=${SLUG}`);
  await page.getByTestId("node-shopper").click();
  await page.clock.install();
  await pauseClock(page);
  await page.evaluate(() => {
    const write = Storage.prototype.setItem;
    const probe = { attempts: 0, blocked: true };
    (window as unknown as { __copyProbe: typeof probe }).__copyProbe = probe;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("diagrams.doc.v1:")) {
        probe.attempts++;
        if (probe.blocked) throw new DOMException("full", "QuotaExceededError");
      }
      return write.call(this, key, value);
    };
  });
  await page.getByTestId("inspector-field-label").fill("First failed edit");
  await page.clock.runFor(1);
  const attempts = () =>
    page.evaluate(() => (window as unknown as { __copyProbe: { attempts: number } }).__copyProbe.attempts);
  await expect.poll(attempts).toBe(1);
  await page.getByTestId("toast").evaluate((el) => el.setAttribute("data-test-notification", "retained"));
  for (let edit = 0; edit < 8; edit++) {
    await page.getByTestId("inspector-field-label").fill(`Latest edit ${edit}`);
    await page.clock.runFor(1);
  }
  expect(await attempts()).toBe(1);
  await page.clock.runFor(300);
  expect(await attempts()).toBe(2);
  // Every failed attempt used to publish a new toast; observe notifications, not their expiry.
  await expect(page.getByTestId("toast")).toHaveAttribute("data-test-notification", "retained");
  await page.evaluate(() => ((window as unknown as { __copyProbe: { blocked: boolean } }).__copyProbe.blocked = false));
  await page.getByTestId("inspector-field-label").fill("Recovered latest edit");
  await page.clock.runFor(300);
  await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
  expect(await attempts()).toBe(3);
  await page.clock.resume();
  await page.reload();
  await expect(page.getByTestId("node-shopper")).toContainText("Recovered latest edit");
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
