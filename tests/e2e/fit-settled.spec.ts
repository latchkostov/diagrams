import { test, expect } from "./fixtures";
import { command, readCanvas, settledCanvas } from "../parity/browser/canvas";

// Hold real ResizeObserver deliveries until the test releases them. Unlike a slow CPU,
// this guarantees that timers can run before React Flow and the floating chrome measure.
function holdResizeObservers(initiallyHeld: boolean) {
  const Native = window.ResizeObserver;
  const pending = new Map<ResizeObserver, Map<Element, ResizeObserverEntry>>();
  const callbacks = new Map<ResizeObserver, ResizeObserverCallback>();
  let held = initiallyHeld;
  window.ResizeObserver = class extends Native {
    constructor(callback: ResizeObserverCallback) {
      super((entries, observer) => {
        const deliver = () => callback(entries, observer);
        if (held) {
          const batch = pending.get(observer) ?? new Map<Element, ResizeObserverEntry>();
          for (const entry of entries) batch.set(entry.target, entry);
          pending.set(observer, batch);
          callbacks.set(observer, callback);
        } else deliver();
      });
    }
  };
  window.addEventListener("release-resize-observers", () => {
    held = false;
    for (const [observer, entries] of pending) callbacks.get(observer)?.([...entries.values()], observer);
    pending.clear();
  });
  window.addEventListener("hold-resize-observers", () => {
    held = true;
  });
  window.addEventListener("release-node-measurements", () => {
    for (const [observer, batch] of pending) {
      const entries = [...batch.values()].filter((entry) =>
        (entry.target as HTMLElement).dataset.testid?.startsWith("rf__node-"),
      );
      if (entries.length) callbacks.get(observer)?.(entries, observer);
      for (const entry of entries) batch.delete(entry.target);
    }
  });
}

test("a failed font download settles using measured fallback fonts", async ({ page }) => {
  await page.route(/\.woff2?(\?.*)?$/, (route) => route.abort());
  await page.goto("./?view=canvas&example=aws-fanout");
  const canvas = page.getByTestId("canvas-wrap");
  await expect(canvas).toHaveAttribute("data-fit-pending", "false");
  const before = await readCanvas(page);
  await page.getByTestId("fit-view-button").click();
  await expect(canvas).toHaveAttribute("data-fit-pending", "false");
  expect(await readCanvas(page)).toEqual(before);
});

test("a decorative node animation does not block fitting the chrome", async ({ page }) => {
  await page.goto("./?view=canvas&example=aws-fanout");
  const canvas = page.getByTestId("canvas-wrap");
  await expect(canvas).toHaveAttribute("data-fit-pending", "false");
  await page.getByTestId("rf__node-client").evaluate((node) => {
    const animation = node.animate([{ opacity: 1 }, { opacity: 0.9 }], { duration: 1 });
    animation.pause();
  });
  await page.getByTestId("fit-view-button").click();
  await expect(canvas).toHaveAttribute("data-fit-pending", "false");
});

test("Auto-layout commits before fitting even when React's deferred work is held", async ({ page }) => {
  await page.addInitScript(() => {
    const Native = window.MessageChannel;
    let held = false;
    const pending: (() => void)[] = [];
    window.MessageChannel = class extends Native {
      constructor() {
        super();
        this.port1.addEventListener("message", (event) => {
          if (!held || event.data !== null) return;
          event.stopImmediatePropagation();
          pending.push(() => this.port1.dispatchEvent(new MessageEvent("message")));
        });
      }
    };
    window.addEventListener("hold-react-work", () => {
      held = true;
    });
    window.addEventListener("release-react-work", () => {
      held = false;
      pending.splice(0).forEach((run) => run());
    });
  });
  await page.goto("./?view=canvas&example=aws-fanout");
  await settledCanvas(page);
  await page.clock.install();
  await page.keyboard.press("Control+k");
  await page.getByTestId("command-input").fill("Auto-layout");
  await page.evaluate(() => window.dispatchEvent(new Event("hold-react-work")));
  await page.getByTestId("command-item-action:canvas.auto-layout").click();
  await page.clock.runFor(1000);
  await page.evaluate(() => window.dispatchEvent(new Event("release-react-work")));
  await page.clock.resume();
  const before = await settledCanvas(page);
  await page.getByTestId("fit-view-button").click();
  expect(await settledCanvas(page)).toEqual(before);
});

for (const scenario of ["opening", "early Auto-layout", "Auto-layout chrome"]) {
  test(`fit waits for measurements: ${scenario}`, async ({ page }) => {
    const autoLayout = scenario !== "opening";
    await page.addInitScript(holdResizeObservers, scenario !== "Auto-layout chrome");
    await page.goto("./?view=canvas&example=aws-fanout");
    await expect(page.getByTestId("diagram-title")).toBeVisible();
    if (scenario === "Auto-layout chrome") {
      await settledCanvas(page);
      await page.evaluate(() => window.dispatchEvent(new Event("hold-resize-observers")));
    }
    if (!autoLayout)
      await page.getByTestId("first-run-hint").evaluate((el) => {
        for (const animation of el.getAnimations()) {
          animation.pause();
          animation.currentTime = 0;
        }
      });
    await page.clock.install();
    if (autoLayout) await command(page, "Auto-layout", "canvas.auto-layout");
    // Advance a fake clock past the old fit/autosave timers while measurements are held.
    await page.clock.runFor(1000);
    if (!autoLayout) {
      await page.evaluate(() => window.dispatchEvent(new Event("release-node-measurements")));
      await page.clock.runFor(1000);
      await page.getByTestId("first-run-hint").evaluate((el) => {
        for (const animation of el.getAnimations()) animation.finish();
      });
    }
    await page.evaluate(() => window.dispatchEvent(new Event("release-resize-observers")));
    await page.clock.resume();
    const before = await settledCanvas(page);
    if (autoLayout) expect((before.nodes["group:aws"] as { box: string }).box).toContain("2726×");
    await page.getByTestId("fit-view-button").click();
    const after = await settledCanvas(page);
    expect(after).toEqual(before);
  });
}
