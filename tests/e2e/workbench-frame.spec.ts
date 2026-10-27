import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  pauseClock,
  waitForCameraIdle,
  waitForStableBox,
  waitForStableViewport,
} from "./fixtures";

test("subtitle growth is measured by the resize observer without a second forced measurement", async ({ page }) => {
  await page.addInitScript(() => {
    const counts = { observed: 0, forced: 0 };
    (window as unknown as { cardMeasurements: typeof counts }).cardMeasurements = counts;
    let observing = false;
    const Observer = window.ResizeObserver;
    window.ResizeObserver = class extends Observer {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          const previous = observing;
          observing = true;
          try {
            callback(entries, observer);
          } finally {
            observing = previous;
          }
        });
      }
    };
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    if (!height?.get) throw new Error("HTMLElement.offsetHeight must expose its getter");
    const readHeight = height.get;
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      ...height,
      get(this: HTMLElement) {
        if (this.dataset.testid === "rf__node-payments") counts[observing ? "observed" : "forced"]++;
        return readHeight.call(this);
      },
    });
  });
  await gotoCanvas(page, "retry-storm");
  await page.getByTestId("node-payments").click();
  const subtitle = page.getByTestId("inspector-field-sublabel");
  await subtitle.fill("Worker");
  await subtitle.press("Tab");
  await waitForCameraIdle(page);
  const node = page.getByTestId("rf__node-payments");
  await waitForStableBox(node);
  await page.evaluate(() => {
    const counts = (window as unknown as { cardMeasurements: { observed: number; forced: number } }).cardMeasurements;
    counts.observed = counts.forced = 0;
  });
  await subtitle.fill("Twelve workers handle every request with a bounded queue and a shared connection pool");
  await subtitle.press("Tab");
  await expect(node).toHaveAttribute("data-detail-wrapped", "");
  const counts = () =>
    page.evaluate(
      () => (window as unknown as { cardMeasurements: { observed: number; forced: number } }).cardMeasurements,
    );
  await expect.poll(async () => (await counts()).observed).toBeGreaterThan(0);
  await waitForStableBox(node);
  expect((await counts()).forced).toBe(0);
});

test("card width measurement avoids repeated layout invalidations within one frame", async ({ page }) => {
  await page.addInitScript(() => {
    const stats = { frames: 0, resets: 0, reads: 0, interleaved: 0 };
    (window as unknown as { frameWidthWork: typeof stats }).frameWidthWork = stats;
    let frame: { resets: number; reads: number; interleaved: number } | undefined;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      raf((time) => {
        const previous = frame;
        const current = { resets: 0, reads: 0, interleaved: 0 };
        frame = current;
        try {
          callback(time);
        } finally {
          if (current.resets > 1) {
            stats.frames++;
            stats.resets += current.resets;
            stats.reads += current.reads;
            stats.interleaved += current.interleaved;
          }
          frame = previous;
        }
      });
    const owners = new WeakMap<CSSStyleDeclaration, HTMLElement>();
    const style = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "style");
    if (!style?.get) throw new Error("HTMLElement.style must expose its getter");
    const readStyle = style.get;
    Object.defineProperty(HTMLElement.prototype, "style", {
      ...style,
      get(this: HTMLElement) {
        const value = readStyle.call(this) as CSSStyleDeclaration;
        owners.set(value, this);
        return value;
      },
    });
    const card = (el: HTMLElement | undefined) =>
      !!el &&
      el.parentElement?.getAttribute("data-testid")?.startsWith("node-") &&
      el.parentElement.firstElementChild === el;
    const remove = CSSStyleDeclaration.prototype.removeProperty;
    CSSStyleDeclaration.prototype.removeProperty = function (property) {
      if (frame && property === "width" && card(owners.get(this))) {
        if (frame.reads) frame.interleaved++;
        frame.resets++;
      }
      return remove.call(this, property);
    };
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    if (!width?.get) throw new Error("HTMLElement.offsetWidth must expose its getter");
    const readWidth = width.get;
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      ...width,
      get(this: HTMLElement) {
        if (frame && card(this)) frame.reads++;
        return readWidth.call(this);
      },
    });
  });
  await page.goto("./?view=canvas&example=kafka-order-pipeline");
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-detail-view", "overview");
  const stats = await page.evaluate(
    () =>
      (
        window as unknown as {
          frameWidthWork: { frames: number; resets: number; reads: number; interleaved: number };
        }
      ).frameWidthWork,
  );
  expect(stats.frames).toBeGreaterThan(0);
  expect(stats.resets).toBeGreaterThan(1);
  expect(stats.reads).toBeGreaterThan(1);
  expect(stats.interleaved).toBe(0);
});

test("traffic intensity does not remeasure a settled frame, while spotlight changes do", async ({ page }) => {
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=kafka-order-pipeline&live=1&paused=1&traffic=0");
  await pauseClock(page);
  await waitForStableViewport(page);
  await waitForCameraIdle(page);
  const canvas = page.getByTestId("canvas-wrap");
  await expect(canvas).toHaveAttribute("data-detail-view", "overview");
  await page.clock.runFor(32);
  await canvas.evaluate((el) => {
    const rect = el.getBoundingClientRect.bind(el);
    el.setAttribute("data-frame-reads", "0");
    el.getBoundingClientRect = () => {
      el.setAttribute("data-frame-reads", String(Number(el.getAttribute("data-frame-reads")) + 1));
      return rect();
    };
  });
  const edge = page.getByTestId("edge-order-events-to-payments");
  await edge.evaluate((el) => {
    if (!el.parentElement) throw new Error("An edge must have its React Flow wrapper");
    el.parentElement.toggleAttribute("data-live-main");
  });
  await page.clock.runFor(32);
  await expect(canvas).toHaveAttribute("data-frame-reads", "0");
  // The positive control proves that geometry-relevant decoration still refreshes the frame.
  await edge.evaluate((el) => {
    if (!el.parentElement) throw new Error("An edge must have its React Flow wrapper");
    el.parentElement.toggleAttribute("data-live-dim");
  });
  await page.clock.runFor(32);
  expect(Number(await canvas.getAttribute("data-frame-reads"))).toBeGreaterThan(0);
});
