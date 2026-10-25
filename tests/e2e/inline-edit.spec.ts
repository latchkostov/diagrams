import {
  test,
  expect,
  expectNoErrors,
  gotoCanvas,
  gotoLive,
  waitForStableViewport,
  pauseClock,
  savedDiagram,
  STORAGE_KEYS,
  interactionJournal,
} from "./fixtures";
import rateLimitExample from "../../src/examples/inline-rate-limit.json" with { type: "json" };
import type { DiagramFile } from "../../src/model/types";

// Live uses the same property sheet as editing, without inline name editors.
const KAFKA = "kafka-order-pipeline";

declare global {
  interface Window {
    __namingMeasurements: { hold(): void; release(): void };
  }
}

for (const held of [false, true]) {
  test(`rapid naming saves every key before the next quick-add shortcut (held measurement: ${held})`, async ({
    page,
    consoleErrors,
  }) => {
    await page.addInitScript(() => {
      let held = false;
      const pending: (() => void)[] = [];
      const NativeObserver = window.ResizeObserver;
      window.ResizeObserver = class extends NativeObserver {
        constructor(callback: ResizeObserverCallback) {
          super((entries, observer) => {
            const deliver = () => callback(entries, observer);
            if (held) pending.push(deliver);
            else deliver();
          });
        }
      };
      window.__namingMeasurements = {
        hold: () => void (held = true),
        release: () => {
          held = false;
          for (const deliver of pending.splice(0)) deliver();
        },
      };
    });
    await page.clock.install();
    await gotoCanvas(page, KAFKA);
    await waitForStableViewport(page);
    await page.getByTestId("node-order-events").click();
    await page.keyboard.press("Alt+ArrowRight");
    const search = page.getByTestId("quick-add-search");
    await search.fill("Load Balancer");
    if (held) {
      await page.evaluate(() => window.__namingMeasurements.hold());
      await pauseClock(page);
    }
    await page.keyboard.press("Enter");
    await page.keyboard.type("Orders ingress API");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Alt+ArrowRight");
    // Both assertions precede frame/measurement delivery: neither completion nor the next shortcut may wait.
    await expect(search).toBeVisible();
    await expect(page.getByTestId("node-load-balancer-1")).toContainText("Orders ingress API");
    await page.evaluate(() => window.__namingMeasurements.release());
    if (held) await page.clock.runFor(500);
    await expect
      .poll(async () => (await savedDiagram(page)).nodes.find((node) => node.id === "load-balancer-1")?.label)
      .toBe("Orders ingress API");
    await expect(search).toBeFocused();
    expectNoErrors(consoleErrors);
  });
}

test("pending inspector naming saves every key before the next quick-add shortcut", async ({ page, consoleErrors }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/assets\/NodeIdentity-[^/]+\.js$/, async (route) => {
    await held;
    await route.continue();
  });
  try {
    await page.clock.install();
    await gotoCanvas(page, KAFKA);
    await waitForStableViewport(page);
    await page.getByTestId("node-order-events").click();
    await page.keyboard.press("Alt+ArrowRight");
    const search = page.getByTestId("quick-add-search");
    await search.fill("Load Balancer");
    await pauseClock(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Orders ");
    await page.clock.runFor(100); // Hand the prefix from placement to the still-pending Inspector.
    await expect
      .poll(async () => (await interactionJournal(page)).some((entry) => entry.event === "rename.hold"))
      .toBe(true);
    await page.keyboard.type("ingress API");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Alt+ArrowRight");
    await expect(search).toBeVisible();
    await expect(page.getByTestId("node-load-balancer-1")).toContainText("Orders ingress API");
    await page.clock.runFor(500); // Deliver autosave while the Inspector's code is still held.
    await expect
      .poll(async () => (await savedDiagram(page)).nodes.find((node) => node.id === "load-balancer-1")?.label)
      .toBe("Orders ingress API");
    release();
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("Orders ingress API");
    await expect(search).toBeFocused();
    expectNoErrors(consoleErrors);
  } finally {
    release();
  }
});

test("buffered Enter then Undo before reveal preserves the full name on Redo", async ({ page, consoleErrors }) => {
  await page.clock.install();
  await gotoCanvas(page, KAFKA);
  await waitForStableViewport(page);
  await page.getByTestId("node-order-events").click();
  await page.keyboard.press("Alt+ArrowRight");
  await page.getByTestId("quick-add-search").fill("Load Balancer");
  await pauseClock(page);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Orders ingress API");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("node-load-balancer-1")).toHaveCount(0);
  await page.clock.runFor(100); // Deliver the obsolete reveal after Undo.
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await page.clock.runFor(500); // Deliver Redo's frame and the autosave debounce.
  await expect(page.getByTestId("node-load-balancer-1")).toContainText("Orders ingress API");
  expect((await savedDiagram(page)).nodes.find((node) => node.id === "load-balancer-1")?.label).toBe(
    "Orders ingress API",
  );
  expectNoErrors(consoleErrors);
});

test("Enter before a new node is measured releases the next quick-add shortcut", async ({ page, consoleErrors }) => {
  await page.clock.install();
  await gotoCanvas(page, KAFKA);
  await waitForStableViewport(page);
  await page.getByTestId("node-order-events").click();
  await page.keyboard.press("Alt+ArrowRight");
  const search = page.getByTestId("quick-add-search");
  await search.fill("Load Balancer");
  // Hold the measurement/reveal frames so Enter finishes the buffered name before its field mounts,
  // exactly the ordering that lost Alt+Right in the cells study's CI trace.
  await pauseClock(page);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Alt+ArrowRight");
  await page.clock.runFor(100);
  await expect(search).toBeVisible();
  await search.fill("Go Service");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.clock.runFor(100);
  await expect(page.getByTestId("node-go-1")).toHaveCount(1);
  expectNoErrors(consoleErrors);
});

test("live: nodes, boundaries and connections open their property sheet", async ({ page, consoleErrors }) => {
  await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&speed=4`);
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
  for (const target of ["node-order-events", "group-label-aks"]) {
    await waitForStableViewport(page);
    await page.getByTestId(target).dblclick();
    const label = page.getByTestId("inspector-field-label");
    await expect(label).toBeVisible();
    if (target === "node-order-events") {
      await expect(label).not.toBeFocused();
      expect(await label.evaluate((el: HTMLInputElement) => (el.selectionEnd ?? 0) - (el.selectionStart ?? 0))).toBe(0);
      await expect(page.getByTestId("rf__node-order-events")).toBeFocused();
    } else {
      await expect(label).toBeFocused();
    }
    await page.keyboard.press("Escape");
    // Live node Properties leaves focus on the canvas, so Escape clears its selection.
    if (target === "node-order-events") await page.getByTestId(target).click();
    await page.keyboard.press("F2");
    await expect(page.getByTestId("inspector-field-label")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("node-editor")).toHaveCount(0);
  }
  await waitForStableViewport(page);
  await page
    .getByTestId(/^edge-label-/)
    .first()
    .dblclick();
  await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  await expect(page.getByTestId("edge-label-input")).toHaveCount(0);
  expectNoErrors(consoleErrors);
});

test("editing: double-click selects the name in the property sheet", async ({ page, consoleErrors }) => {
  await gotoCanvas(page, KAFKA);
  await waitForStableViewport(page);
  await page.getByTestId("node-order-events").dblclick();
  const label = page.getByTestId("inspector-field-label");
  await expect(label).toBeFocused();
  expect(await label.evaluate((el: HTMLInputElement) => (el.selectionEnd ?? 0) - (el.selectionStart ?? 0))).toBe(
    (await label.inputValue()).length,
  );
  expectNoErrors(consoleErrors);
});

test("P2 R-24e8f73492: Rate limit edits apply while Live traffic keeps running", async ({ page, consoleErrors }) => {
  await page.addInitScript(() => localStorage.setItem("diagrams.inspector.open.v1", "{}"));
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=inline-rate-limit&live=1");
  await waitForStableViewport(page);
  await page.getByTestId("node-limiter").dblclick();
  await page.getByTestId("inspector-section-node-simulation").click();
  const rate = page.getByTestId("inspector-field-rate-limit");
  await expect(rate).toHaveValue("10");
  await rate.focus();
  await expect(rate).toHaveAccessibleDescription("Requests per second. Clear to remove the local quota.");
  await pauseClock(page);
  const processed = async () => Number(await page.getByTestId("node-badge-api").getAttribute("data-processed"));
  const sample = async () => {
    const before = await processed();
    await page.clock.runFor(5000);
    return (await processed()) - before;
  };
  const baseline = await sample();
  expect(baseline).toBeGreaterThan(0);
  await rate.fill("2");
  await rate.press("Tab");
  await expect(rate).toHaveValue("2");
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
  const limited = await sample();
  expect(limited).toBeGreaterThan(0);
  expect(limited).toBeLessThan(baseline / 2);
  await rate.fill("-1");
  await expect(rate).toHaveAttribute("aria-invalid", "true");
  await rate.press("Tab");
  await expect(rate).toHaveValue("2");
  await page.getByTestId("undo-button").click();
  await expect(rate).toHaveValue("10");
  const restored = await sample();
  expect(restored).toBeGreaterThan(limited * 2);
  await rate.fill("");
  await rate.press("Tab");
  await page.clock.runFor(350); // Deliver the autosave debounce under the controlled clock.
  expect((await savedDiagram(page)).nodes.find((node) => node.id === "limiter")?.props?.api?.quotas).toEqual([]);
  const uncapped = await sample();
  expect(uncapped).toBeGreaterThan(restored * 1.5);
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
  expectNoErrors(consoleErrors);
});

test("Live Rate limit edits keep the same quota after each render", async ({ page, consoleErrors }) => {
  const diagram = structuredClone(rateLimitExample) as DiagramFile;
  const limiter = diagram.nodes.find((node) => node.id === "limiter");
  if (!limiter?.props) throw new Error("Expected the rate limiter fixture");
  const first = limiter.props.api as { quotas: Record<string, unknown>[] };
  const sibling = { ...first.quotas[0], id: "local-rate-2", amount: 100, burst: 100 };
  first.quotas.push(sibling);
  await page.addInitScript(
    ({ diagram, key }) => {
      localStorage.setItem(key, JSON.stringify(diagram));
      localStorage.setItem("diagrams.inspector.open.v1", "{}");
    },
    { diagram, key: STORAGE_KEYS.autosavePrefix + "inline-rate-limit" },
  );
  await gotoLive(page, "./?view=canvas&example=inline-rate-limit&live=1");
  await waitForStableViewport(page);
  await page.getByTestId("node-limiter").dblclick();
  await page.getByTestId("inspector-section-node-simulation").click();
  const rate = page.getByTestId("inspector-field-rate-limit");
  const processed = () => page.getByTestId("node-badge-api").getAttribute("data-processed").then(Number);
  const before = await processed();
  for (const amount of [2, 3]) {
    await rate.fill(String(amount));
    await rate.press("Tab");
    await expect(rate).toHaveValue(String(amount));
    await expect
      .poll(async () => (await savedDiagram(page)).nodes.find((node) => node.id === "limiter")?.props?.api)
      .toEqual({
        quotas: [{ ...first.quotas[0], amount, burst: amount }, sibling],
      });
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
  }
  await expect.poll(processed).toBeGreaterThan(before);
  expectNoErrors(consoleErrors);
});
