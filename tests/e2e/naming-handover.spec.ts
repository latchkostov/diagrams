import type { Page } from "@playwright/test";
import {
  test,
  expect,
  gotoCanvas,
  waitForStableViewport,
  savedDiagram,
  STORAGE_KEYS,
  expectNoErrors,
} from "./fixtures";

const SLUG = "kafka-order-pipeline";
const NAME = "Buffered Orders API";
const SEED = {
  format: "diagrams/v1",
  title: "Naming handover",
  nodes: [{ id: "origin", stencil: "service.go", label: "Origin", x: 0, y: 0 }],
  edges: [],
};

async function seed(page: Page) {
  await page.addInitScript(
    ([key, diagram]) => localStorage.setItem(key, diagram),
    [STORAGE_KEYS.autosavePrefix + SLUG, JSON.stringify(SEED)],
  );
  await gotoCanvas(page, SLUG);
  await waitForStableViewport(page);
  await page.getByTestId("node-origin").click();
  await page.getByTestId("rf__node-origin").focus();
}

/** Hold only new cards' measurement deliveries; keys, rendering and ordinary handlers still run. */
async function holdMeasurement(page: Page) {
  await page.addInitScript(() => {
    const Original = window.ResizeObserver;
    const frame = window.requestAnimationFrame.bind(window);
    const cancelFrame = window.cancelAnimationFrame.bind(window);
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    const deliveries: (() => void)[] = [];
    let held = false;
    window.requestAnimationFrame = (run) => {
      if (!held) return frame(run);
      const id = --nextFrame;
      frames.set(id, run);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      if (id < 0) frames.delete(id);
      else cancelFrame(id);
    };
    window.ResizeObserver = class extends Original {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          const delayed = entries.filter((entry) => {
            const id = entry.target.getAttribute("data-testid");
            return held && id?.startsWith("rf__node-") && id !== "rf__node-origin";
          });
          const ready = entries.filter((entry) => !delayed.includes(entry));
          if (ready.length) callback(ready, observer);
          if (delayed.length) deliveries.push(() => callback(delayed, observer));
        });
      }
    };
    (window as unknown as { releaseMeasurement(): void }).releaseMeasurement = () => {
      held = false;
      for (const run of deliveries.splice(0)) run();
      for (const run of frames.values()) frame(run);
      frames.clear();
    };
    (window as unknown as { holdMeasurement(): void }).holdMeasurement = () => {
      held = true;
    };
  });
}

const releaseMeasurement = (page: Page) =>
  page.evaluate(() => (window as unknown as { releaseMeasurement(): void }).releaseMeasurement());

async function pick(page: Page, kind: "clone" | "quick-add") {
  if (kind === "clone") await page.keyboard.press("Alt+Shift+ArrowRight");
  else {
    await page.keyboard.press("Alt+ArrowRight");
    await page.getByTestId("quick-add-search").fill("redis cache");
    await expect(page.getByTestId("context-menu-item-quick-add:redis.cache")).toHaveAttribute("data-active", "true");
    await page.keyboard.press("Enter");
  }
}

for (const kind of ["clone", "quick-add"] as const) {
  test(`buffered ${kind}: clicking another node saves before measurement and never reopens naming`, async ({
    page,
    consoleErrors,
  }) => {
    await holdMeasurement(page);
    await seed(page);
    await page.evaluate(() => (window as unknown as { holdMeasurement(): void }).holdMeasurement());
    await pick(page, kind);
    await page.keyboard.type(NAME);
    const added = (await savedDiagram(page)).nodes.find((node) => node.id !== "origin");
    if (!added) throw new Error("Expected the newly placed node");
    await expect(page.getByTestId(`rf__node-${added.id}`)).toBeHidden();
    await page.getByTestId("node-origin").click();
    await expect
      .poll(async () => (await savedDiagram(page)).nodes.find((node) => node.id === added.id)?.label)
      .toBe(NAME);
    await releaseMeasurement(page);
    await expect(page.getByTestId(`node-${added.id}`)).toBeVisible();
    await expect(page.getByTestId("rf__node-origin")).toBeFocused();
    await expect(page.getByTestId("inspector-field-label")).not.toBeFocused();
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("Origin");
    // Creation and the accepted name remain one history step even after the delayed reveal.
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => (await savedDiagram(page)).nodes.length).toBe(1);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect
      .poll(async () => (await savedDiagram(page)).nodes.find((node) => node.id === added.id)?.label)
      .toBe(NAME);
    expectNoErrors(consoleErrors);
  });
  for (const held of [false, true]) {
    test(`buffered ${kind}: Enter commits before immediate Alt+Right (measurement ${held ? "held" : "running"})`, async ({
      page,
      consoleErrors,
    }) => {
      if (held) await holdMeasurement(page);
      await seed(page);
      if (held) await page.evaluate(() => (window as unknown as { holdMeasurement(): void }).holdMeasurement());
      await pick(page, kind);
      await page.keyboard.type(NAME);
      await page.keyboard.press("Enter");
      // No render, focus or autosave wait between Enter and the next ordinary shortcut.
      await page.keyboard.press("Alt+ArrowRight");
      await expect(page.getByTestId("quick-add-search")).toBeFocused();
      await expect.poll(async () => (await savedDiagram(page)).nodes.some((node) => node.label === NAME)).toBe(true);
      const diagram = await savedDiagram(page);
      const named = diagram.nodes.find((node) => node.label === NAME);
      if (!named) throw new Error("Expected the complete committed name");
      expect(diagram.edges.some((edge) => edge.from === "origin" && edge.to === named?.id)).toBe(true);
      if (held) {
        await expect(page.getByTestId(`rf__node-${named.id}`)).toBeHidden();
        await releaseMeasurement(page);
        await expect(page.getByTestId(`node-${named.id}`)).toBeVisible();
        await expect(page.getByTestId("quick-add-search")).toBeFocused();
      }
      // The shortcut targets the committed selection, and grows the flow from that node.
      await page.getByTestId("quick-add-search").fill("postgres");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("inspector-field-label")).toBeFocused();
      await page.keyboard.press("Enter");
      await expect.poll(async () => (await savedDiagram(page)).nodes.length).toBe(3);
      const grown = await savedDiagram(page);
      expect(grown.nodes.find((node) => node.id === named?.id)?.label).toBe(NAME);
      expect(grown.edges.some((edge) => edge.from === named?.id)).toBe(true);
      expectNoErrors(consoleErrors);
    });
  }
}

test("buffered Enter releases keys while focus waits for measurement, then reaches the named node", async ({
  page,
  consoleErrors,
}) => {
  await holdMeasurement(page);
  await seed(page);
  await page.evaluate(() => (window as unknown as { holdMeasurement(): void }).holdMeasurement());
  await pick(page, "quick-add");
  await page.keyboard.type(NAME);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await savedDiagram(page)).nodes.some((node) => node.label === NAME)).toBe(true);
  const named = (await savedDiagram(page)).nodes.find((node) => node.label === NAME);
  if (!named) throw new Error("Expected the complete committed name");
  await expect(page.getByTestId(`rf__node-${named.id}`)).toBeHidden();
  await releaseMeasurement(page);
  await expect(page.getByTestId(`rf__node-${named.id}`)).toBeFocused();
  await expect(page.getByTestId("inspector-field-label")).not.toBeFocused();
  expectNoErrors(consoleErrors);
});

test("buffered Enter commits before Undo and a late measurement cannot rewrite Redo", async ({
  page,
  consoleErrors,
}) => {
  await holdMeasurement(page);
  await seed(page);
  await page.evaluate(() => (window as unknown as { holdMeasurement(): void }).holdMeasurement());
  await pick(page, "clone");
  await page.keyboard.type(NAME);
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedDiagram(page)).nodes.length).toBe(1);
  await releaseMeasurement(page);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => (await savedDiagram(page)).nodes.find((node) => node.label === NAME)?.label).toBe(NAME);
  expectNoErrors(consoleErrors);
});
