import { openLiveNodeDetails } from "./fixtures";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Page } from "@playwright/test";
import { planningFixture } from "../../src/lab/planningFixture";
import {
  test as base,
  expect,
  gotoCanvas,
  gotoLive,
  pauseClock,
  waitForStableViewport,
  expectNoErrors,
  STORAGE_KEYS,
} from "./fixtures";

const test = base.extend<{ isolatedScreenshots: undefined }>({
  isolatedScreenshots: [
    async ({ page }, use, testInfo) => {
      const screenshot = page.screenshot.bind(page);
      page.screenshot = async (options = {}) => {
        if (options.path) {
          const path = relative(testInfo.outputDir, resolve(options.path));
          expect(isAbsolute(path)).toBe(false);
          expect(path.split(sep)[0]).not.toBe("..");
        }
        return screenshot(options);
      };
      await use(undefined);
    },
    { auto: true },
  ],
});

const SLUG = "kafka-order-pipeline";
const KEY = STORAGE_KEYS.autosavePrefix + SLUG;

async function seed(
  page: Page,
  kind: "orders" | "connections" | "no-reader" | "outage" | "many-groups" | "analysis-limit" = "orders",
  live = false,
) {
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("p1-seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("p1-seeded", "1");
      }
    },
    [KEY, JSON.stringify(planningFixture(kind))] as const,
  );
  if (live)
    await gotoLive(
      page,
      `./?view=canvas&example=${SLUG}&live=1${kind === "outage" ? "&sim=outage&paused=1" : kind === "analysis-limit" ? "&paused=1&traffic=0" : ""}`,
    );
  else await gotoCanvas(page, SLUG);
  await waitForStableViewport(page);
}

test("P1: Orders arithmetic and the 50% fix are keyboard accessible and undoable", async ({
  page,
  consoleErrors,
}, testInfo) => {
  await seed(page);
  await page.getByTestId("node-orders").click();
  const x = page.getByTestId("planning-explanation-orders");
  await expect(x.getByTestId("planning-arithmetic")).toContainText("~1 req/s");
  await expect(x.getByTestId("planning-capacity-formula")).toHaveText("(1 replica × 4 slots ÷ 4 s)");
  await expect(x.getByTestId("planning-contributors")).toContainText("Checkout: 3 req/s");
  await expect(x.getByTestId("planning-growth")).toContainText("2 req/s");
  await expect(x.getByTestId("planning-target")).toContainText("3 replicas at 100%; 6 replicas at the 50% target");
  await expect(page.getByTestId("planning-connections")).not.toContainText("Retry:");
  await expect(page.getByTestId("inspector-findings")).toBeVisible();
  expect(
    await x.evaluate((el) => {
      const findings = document.querySelector('[data-testid="inspector-findings"]');
      return !!findings && !!(el.compareDocumentPosition(findings) & Node.DOCUMENT_POSITION_PRECEDING);
    }),
  ).toBe(true);
  await page.keyboard.press("Shift+Digit1");
  await waitForStableViewport(page);
  await x.getByTestId("planning-apply").scrollIntoViewIfNeeded();
  await testInfo.attach("orders-inspector.png", {
    body: await page.screenshot({ path: testInfo.outputPath("orders-inspector.png") }),
    contentType: "image/png",
  });
  await x.getByTestId("planning-apply").focus();
  await page.keyboard.press("Enter");
  await expect(x.getByTestId("planning-arithmetic")).toContainText("6 replicas × 4 slots");
  await expect(x).toBeFocused();
  await page.getByTestId("undo-button").click();
  await expect(x.getByTestId("planning-arithmetic")).toContainText("1 replica × 4 slots");
  expectNoErrors(consoleErrors);
});

test("P1: two policies share one pool; removing and reconnecting edges refresh the inspector", async ({
  page,
  consoleErrors,
}, testInfo) => {
  await seed(page, "connections");
  await page.getByTestId("node-orders").click();
  await expect(page.getByTestId("planning-pool")).toHaveCount(1);
  await expect(page.getByTestId("planning-connection-consume")).toContainText("Group: billing");
  await expect(page.getByTestId("planning-connection-consume2")).toContainText("Group: returns");
  await expect(page.getByTestId("planning-connection-audit")).toContainText("OrderHandled");
  await expect(page.getByTestId("planning-connection-call")).toHaveText("Calls Payments");
  // Option H connection separators use 70% of the line token; secondary ink keeps its theme token.
  const colors = await page.getByTestId("planning-connection-consume").evaluate((el) => {
    const policy = el.querySelector('[data-testid="planning-group"]');
    if (!policy) throw new Error("Missing consumer group policy");
    const reference = document.createElement("span");
    reference.style.color = "var(--text-3)";
    reference.style.borderBlockStart = "1px solid color-mix(in oklab, var(--line) 70%, transparent)";
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
  await testInfo.attach("connections.png", {
    body: await page.screenshot({ path: testInfo.outputPath("connections.png") }),
    contentType: "image/png",
  });
  // Reconnect through the existing keyboard action, then reselect the worker.
  await page.getByTestId("edge-consume").click();
  await page.keyboard.press("ControlOrMeta+k");
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
}, testInfo) => {
  await seed(page, "orders", true);
  await page.getByTestId("node-orders").hover();
  const card = page.getByTestId("node-detail-orders");
  await openLiveNodeDetails(page, "orders", "planning");
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
  await testInfo.attach("orders-hover.png", {
    body: await page.screenshot({ path: testInfo.outputPath("orders-hover.png") }),
    contentType: "image/png",
  });
  // Canvas roving focus: click selects/focuses the node; moving off it keeps the focused explanation.
  await page.getByTestId("node-orders").click();
  await page.getByTestId("diagram-title").hover();
  await expect(card).toBeVisible();
  await openLiveNodeDetails(page, "orders", "planning");
  await expect(card).toHaveAttribute("role", "region");
  await expect(page.getByTestId("node-live-focus-orders")).toHaveAccessibleDescription(
    /Orders handles ~1 req\/s.*receives 3 req\/s.*Observed now/,
  );
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
  await x.getByTestId("planning-apply").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  await expect(page.getByTestId("inspector-field-label")).toHaveValue("Order events consumer");
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
}, testInfo) => {
  await seed(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("diagram properties");
  await page.keyboard.press("Enter");
  await page.getByTestId("planning-preview").click();
  await expect(page.getByTestId("planning-upgrade-preview")).toContainText("Orders: 1 msg/s → 1 msg/s");
  await testInfo.attach("upgrade-preview.png", {
    body: await page.screenshot({ path: testInfo.outputPath("upgrade-preview.png") }),
    contentType: "image/png",
  });
  await page.getByTestId("planning-upgrade").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("planning-preview")).toBeFocused();
  await expect(page.getByTestId("planning-model")).toContainText("p3");
  await page.getByTestId("planning-preview").click();
  await expect(page.getByTestId("planning-legacy-preview")).toContainText("planning.revision");
  const pending = page.waitForEvent("download");
  await page.getByTestId("planning-legacy-download").click();
  expect((await pending).suggestedFilename()).toBe("legacy.diagram.json");
  await page.getByTestId("undo-button").click();
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("diagram properties");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("planning-model")).toContainText("Legacy playback");
  expectNoErrors(consoleErrors);
});

test("P1: Apply keeps a saved timeline outage in its latest sizing analysis", async ({ page }) => {
  await seed(page, "outage", true);
  await page.getByTestId("node-orders").dblclick();
  const x = page.getByTestId("inspector").getByTestId("planning-explanation-orders");
  await expect(x.getByTestId("planning-target")).toContainText("12 replicas at the 50% target");
  await pauseClock(page);
  await x.getByTestId("planning-apply").click();
  await expect(x.getByTestId("planning-arithmetic")).toContainText("12 replicas × 4 slots");
  await expect(page.getByTestId("node-badge-other")).toHaveAttribute("data-status", "down");
});

test("P1: tall hover cards stay within a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 460 });
  await seed(page, "orders", true);
  await page.getByTestId("node-orders").hover();
  const card = page.getByTestId("node-detail-orders");
  await openLiveNodeDetails(page, "orders", "planning");
  await expect(card.getByTestId("planning-arithmetic")).toBeVisible();
  await expect
    .poll(async () => {
      const bounds = await card.boundingBox(),
        pane = await page.getByTestId("canvas-wrap").boundingBox();
      return !!bounds && !!pane && bounds.y >= pane.y && bounds.y + bounds.height <= pane.y + pane.height;
    })
    .toBe(true);
});

test("P1: naming saves each key without reading or recomputing planning", async ({ page, consoleErrors }) => {
  await seed(page);
  await page.getByTestId("node-orders").click();
  await expect(page.getByTestId("planning-arithmetic")).toBeVisible();
  await waitForStableViewport(page);
  await page.keyboard.press("F2");
  const label = page.getByTestId("inspector-field-label");
  await expect(label).toBeFocused();
  await expect(page.getByTestId("planning-arithmetic")).toBeVisible();
  const stats = () =>
    page.evaluate(() => ({
      ...(window as unknown as { __planning: { reads: number; analyses: number; explanations: number } }).__planning,
    }));
  const before = await stats();
  for (const ch of "Updated worker") {
    await page.keyboard.type(ch);
    await expect(page.getByTestId("node-orders")).toContainText(await label.inputValue());
    expect(await stats()).toEqual(before);
  }
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("planning-arithmetic")).toContainText("Updated worker");
  expect((await stats()).reads).toBeGreaterThan(before.reads);
  // Source labels also supply the default message type. Their semantic change is picked up
  // once naming ends, and connected explanations must then use the new name.
  await page.keyboard.press("Shift+1");
  await waitForStableViewport(page);
  await page.getByTestId("node-checkout").click();
  await expect(page.getByTestId("planning-connections")).toBeVisible();
  await waitForStableViewport(page);
  await page.keyboard.press("F2");
  await expect(label).toBeFocused();
  await expect(page.getByTestId("planning-connections")).toBeVisible();
  const sourceBefore = await stats();
  await page.keyboard.type("New checkout");
  expect(await stats()).toEqual(sourceBefore);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+1");
  await waitForStableViewport(page);
  await page.getByTestId("node-orders").click();
  await expect(page.getByTestId("planning-contributors")).toContainText("New checkout");
  expectNoErrors(consoleErrors);
});

test("P1: a live callout moves clear of a node panned into its footprint", async ({ page, consoleErrors }) => {
  await page.setViewportSize({ width: 1000, height: 460 });
  await seed(page, "many-groups", true);
  const callout = page.getByTestId("trouble-callout");
  await expect(callout).toBeVisible();
  await waitForStableViewport(page);
  const box = await callout.boundingBox(),
    topic = await page.getByTestId("node-topic").boundingBox(),
    pane = await page.getByTestId("canvas-wrap").boundingBox();
  if (!box || !topic || !pane) throw new Error("Missing callout, topic or canvas");
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height - 100);
  await page.mouse.wheel(
    topic.x + topic.width / 2 - (box.x + box.width / 2),
    topic.y + topic.height / 2 - (box.y + box.height / 2),
  );
  await waitForStableViewport(page);
  await expect
    .poll(async () => {
      const c = await callout.boundingBox(),
        n = await page.getByTestId("node-topic").boundingBox();
      return (
        !!c && !!n && (c.x + c.width <= n.x || n.x + n.width <= c.x || c.y + c.height <= n.y || n.y + n.height <= c.y)
      );
    })
    .toBe(true);
  await page.getByTestId("node-topic").click();
  await page.keyboard.press("F2");
  await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  expectNoErrors(consoleErrors);
});

test("P1: live group details stay reachable in a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 460 });
  await seed(page, "many-groups", true);
  await page.getByTestId("node-topic").click();
  await page.getByTestId("diagram-title").hover();
  const card = page.getByTestId("node-detail-topic");
  await openLiveNodeDetails(page, "topic", "outcomes");
  await expect(card).toContainText("Throughput");
  await expect(card).toContainText("Lag by consumer group");
  await expect(card.getByTestId("live-lag-group-23")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("F2");
  const readers = page.getByTestId("inspector-live-section-readers");
  await readers.focus();
  if ((await readers.getAttribute("aria-expanded")) !== "true") await page.keyboard.press("Enter");
  await expect(page.getByTestId("planning-live-lag-group-23")).toBeVisible();
  await page.getByTestId("inspector-live-section-outcomes").click();
  await expect(page.getByTestId("inspector-live-outcomes")).toBeVisible();
});

test("P1: a keyboard-focused hover card follows pan, zoom and pane resizing", async ({ page }) => {
  await seed(page, "orders", true);
  await page.getByTestId("node-orders").click();
  await page.getByTestId("diagram-title").hover();
  const card = page.getByTestId("node-detail-orders");
  await expect(card).toBeVisible();
  const check = async () => {
    await expect
      .poll(async () => {
        const box = await card.boundingBox(),
          pane = await page.getByTestId("canvas-wrap").boundingBox();
        return (
          !!box &&
          !!pane &&
          box.x >= pane.x &&
          box.y >= pane.y &&
          box.x + box.width <= pane.x + pane.width &&
          box.y + box.height <= pane.y + pane.height
        );
      })
      .toBe(true);
  };
  await check();
  const canvas = await page.getByTestId("canvas-wrap").boundingBox();
  if (!canvas) throw new Error("No canvas");
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.wheel(420, -250);
  await waitForStableViewport(page);
  await page.getByTestId("diagram-title").hover();
  await check();
  await page.setViewportSize({ width: 1000, height: 460 });
  await check();
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  // Literal Control: a trackpad pinch emits ctrl+wheel on every OS.
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 240);
  await page.keyboard.up("Control");
  await waitForStableViewport(page);
  await check();
});

test("P1: bounded planning retains keyboard-accessible current counters", async ({ page }) => {
  await seed(page, "analysis-limit", true);
  await page.getByTestId("node-orders").click();
  await page.getByTestId("diagram-title").hover();
  const card = page.getByTestId("node-detail-orders");
  await openLiveNodeDetails(page, "orders", "planning");
  await expect(card.getByTestId("planning-unavailable")).toBeVisible();
  await expect(card.getByTestId("planning-observed")).toContainText("Processed 0");
  await expect(card.getByTestId("planning-observed")).toContainText("In flight 0");
  await expect(page.getByTestId("node-live-focus-orders")).toHaveAccessibleDescription(/Processed 0.*In flight 0/);
});
