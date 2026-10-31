import {
  test,
  expect,
  waitForCameraIdle,
  animationFrames,
  pageLoadTimeout,
  pauseClock,
  waitForLiveSession,
} from "./fixtures";
import {
  CompletedStep,
  command,
  node,
  edge,
  focus,
  activate,
  play,
  waitForScheduledNote,
  runKeyboardTutorial,
} from "./keyboard-tutorial-driver";
import { keyboardTutorialGroups } from "./keyboard-tutorial-groups";

for (const id of keyboardTutorialGroups[0]) {
  test(`${id}: keyboard solution plays through the real UI`, async ({ page, consoleErrors }) => {
    await runKeyboardTutorial(page, consoleErrors, id);
  });
}

test("native keyboard controls use their focus observation without extra animation frames", async ({ page }) => {
  await page.setContent(
    '<button data-testid="first">First</button><button data-testid="target">Target</button><button data-testid="last">Last</button>',
  );
  await page.keyboard.press("Tab");
  await page.evaluate(() => {
    const raf = window.requestAnimationFrame.bind(window);
    Object.assign(window, { __nativeFocusFrames: 0 });
    window.requestAnimationFrame = (callback) => {
      const state = window as unknown as { __nativeFocusFrames: number };
      state.__nativeFocusFrames++;
      return raf(callback);
    };
  });
  await focus(page, "target");
  await expect(page.getByTestId("target")).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { __nativeFocusFrames: number }).__nativeFocusFrames)).toBe(0);
});

test("trace-slowmo: keyboard Play after a speed choice activates transport instead of the select", async ({ page }) => {
  await page.setContent(
    '<button data-testid="live-play" data-state="slowmo" data-playing="0">Play</button><select data-testid="live-speed"><option value="8">8×</option></select>',
  );
  await page
    .getByTestId("live-play")
    .evaluate((button) => button.addEventListener("click", () => button.setAttribute("data-playing", "1")));
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("live-speed")).toBeFocused();
  await play(page, { playing: true });
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-playing", "1");
});

test("trace-slowmo: keyboard Escape stops when the lesson finishes, preserving Live", async ({ page }) => {
  await page.setContent(
    '<div data-testid="canvas-wrap" data-camera-state="idle"><button data-testid="live-toggle" aria-pressed="true">Live</button></div>',
  );
  await page.evaluate(() => {
    let escaped = 0;
    window.__tutorial = {
      snapshot: () => ({ state: { value: escaped ? "finished" : "active" } }),
    } as unknown as NonNullable<Window["__tutorial"]>;
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (++escaped > 1) document.querySelector('[data-testid="live-toggle"]')?.setAttribute("aria-pressed", "false");
    });
  });
  let completed = false;
  try {
    for (let level = 0; level < 3; level++) await play(page, { press: "Escape" });
  } catch (error) {
    if (!(error instanceof CompletedStep)) throw error;
    completed = true;
  }
  expect(completed).toBe(true);
  await expect(page.getByTestId("live-toggle")).toHaveAttribute("aria-pressed", "true");
});

test("keyboard scheduled-note navigation advances the simulation until its real pause", async ({ page }) => {
  await page.clock.install();
  await page.goto("./?tutorial=webhooks");
  await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(page.getByTestId("tutorial-start")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tutorial-intro")).toHaveCount(0);
  await command(page, "live:toggle", ">");
  await waitForLiveSession(page);
  await play(page, { choose: "live-sim-picker", value: "outage-replay" });
  await pauseClock(page);
  await waitForScheduledNote(page);
  await expect(page.getByTestId("live-note-continue")).toBeVisible();
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "waiting");
});

test("keyboard readout navigation leaves an earlier pinned card before selecting its next owner", async ({ page }) => {
  await page.goto("./?tutorial=shared-api-quotas");
  await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(page.getByTestId("tutorial-start")).toBeFocused({ timeout: pageLoadTimeout() });
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tutorial-intro")).toHaveCount(0);
  await command(page, "live:toggle", ">");
  await waitForLiveSession(page);
  await play(page, { read: "node-answer" });
  await expect(page.getByTestId("node-detail-answer")).toHaveAttribute("data-pinned", "true");
  await play(page, { read: "node-payments" });
  await expect(page.getByTestId("node-detail-payments")).toHaveAttribute("data-pinned", "true");
  await expect(page.getByTestId("node-detail-answer")).toHaveCount(0);
});

test("keyboard canvas navigation exits when the lesson has already finished", async ({ page }) => {
  await page.goto("./?tutorial=property-sheet");
  await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(page.getByTestId("tutorial-start")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tutorial-intro")).toHaveCount(0);
  for (let skipped = 0; skipped < 5 && !(await page.getByTestId("tutorial-finished").isVisible()); skipped++) {
    const step = await page.getByTestId("tutorial-step").getAttribute("data-step");
    if (!step) throw new Error("Missing property-sheet step");
    await activate(page, "tutorial-skip");
    await expect(page.getByTestId("tutorial-step")).not.toHaveAttribute("data-step", step);
  }
  await expect(page.getByTestId("tutorial-finished")).toBeVisible();
  await expect(node(page, "api")).rejects.toBeInstanceOf(CompletedStep);
  await expect(command(page, "node:api", "@ api")).rejects.toBeInstanceOf(CompletedStep);
});

test("keyboard node navigation waits for the item's focus, not its containing canvas", async ({ page }) => {
  await page.goto("./?tutorial=property-sheet");
  await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(page.getByTestId("tutorial-start")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tutorial-intro")).toHaveCount(0);
  await page.getByTestId("canvas-wrap").focus();
  await page.evaluate(() => {
    const original = HTMLElement.prototype.focus;
    const pending: (() => void)[] = [];
    const hold = (window.__keyboardFocusHold = {
      pending: false,
      release() {
        HTMLElement.prototype.focus = original;
        for (const focus of pending.splice(0)) focus();
        delete window.__keyboardFocusHold;
      },
    });
    HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
      if (this.getAttribute("data-id") === "api") {
        hold.pending = true;
        pending.push(() => original.call(this, options));
      } else original.call(this, options);
    };
  });
  let settled = false;
  const choosing = node(page, "api").then(() => {
    settled = true;
  });
  try {
    await expect.poll(() => page.evaluate(() => window.__keyboardFocusHold?.pending)).toBe(true);
    await waitForCameraIdle(page);
    await animationFrames(page);
    expect(settled).toBe(false);
    await page.evaluate(() => window.__keyboardFocusHold?.release());
    await choosing;
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-id"))).toBe("api");
  } finally {
    await page.evaluate(() => window.__keyboardFocusHold?.release());
    await choosing;
  }
});

declare global {
  interface Window {
    __keyboardFocusHold?: { pending: boolean; release(): void };
  }
}

test("keyboard edge navigation yields when the lesson finishes during its keypress", async ({ page }) => {
  await page.goto("./?tutorial=circuit-breaker");
  await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(page.getByTestId("tutorial-start")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tutorial-intro")).toHaveCount(0);
  const first = await page.evaluate(() => window.__tutorial?.diagram().edges[0]?.id);
  if (!first) throw new Error("Missing fixture edge");
  const press = page.keyboard.press.bind(page.keyboard);
  page.keyboard.press = async (key, options) => {
    // eslint-disable-next-line no-restricted-syntax -- connection navigation uses literal Ctrl on every platform
    if (key === "Control+Alt+]") {
      const steps = await page.evaluate(() => window.__tutorial?.snapshot().state.stepIds.length ?? 0);
      for (let i = 0; i < steps && !(await page.getByTestId("tutorial-finished").isVisible()); i++) {
        const before = await page.getByTestId("tutorial-step").getAttribute("data-step");
        await page.getByTestId("tutorial-skip").click();
        await expect(page.getByTestId("tutorial-step")).not.toHaveAttribute("data-step", before ?? "");
      }
      await expect(page.getByTestId("tutorial-finished")).toBeVisible();
    }
    await press(key, options);
  };
  await expect(edge(page, first)).rejects.toBeInstanceOf(CompletedStep);
});

test("keyboard control traversal reads a bounded amount of browser state per key", async ({ page }) => {
  await page.setContent(
    '<button data-testid="first">First</button><button data-testid="middle">Middle</button><button data-testid="last">Last</button>',
  );
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("first")).toBeFocused();
  let reads = 0,
    keys = 0;
  page.evaluate = new Proxy(page.evaluate, {
    apply(target, thisArg, args) {
      reads++;
      return Reflect.apply(target, thisArg, args) as ReturnType<typeof page.evaluate>;
    },
  });
  page.getByTestId = new Proxy(page.getByTestId, {
    apply(target, thisArg, args) {
      const locator = Reflect.apply(target, thisArg, args) as ReturnType<typeof page.getByTestId>;
      locator.evaluate = new Proxy(locator.evaluate, {
        apply(evaluate, receiver, input) {
          reads++;
          return Reflect.apply(evaluate, receiver, input) as ReturnType<typeof locator.evaluate>;
        },
      });
      return locator;
    },
  });
  page.keyboard.press = new Proxy(page.keyboard.press, {
    apply(target, thisArg, args) {
      keys++;
      return Reflect.apply(target, thisArg, args) as ReturnType<typeof page.keyboard.press>;
    },
  });
  await focus(page, "last");
  expect(keys).toBeGreaterThan(0);
  expect(reads).toBeLessThanOrEqual(keys + 3);
  await expect(page.getByTestId("last")).toBeFocused();
});

test("keyboard control traversal uses Tab for a menu with native button stops", async ({ page }) => {
  await page.setContent(
    '<div role="menu"><button data-testid="first">Overview</button><button data-testid="middle">Focus</button><button data-testid="last">Following</button></div>',
  );
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("first")).toBeFocused();
  await focus(page, "middle");
  await expect(page.getByTestId("middle")).toBeFocused();
});
