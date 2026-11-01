import {
  test,
  expect,
  waitForCameraIdle,
  animationFrames,
  pageLoadTimeout,
  pauseClock,
  waitForLiveSession,
  gotoLive,
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

test("keyboard text recipes append a setting at the native document end", async ({ page }) => {
  await page.setContent(
    '<div data-testid="canvas-wrap" data-camera-state="idle"><textarea data-testid="settings">Orders:PageSize\nFeatures:*</textarea></div>',
  );
  const settings = page.getByTestId("settings");
  await settings.focus();
  await settings.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
  await play(page, { press: "ControlOrMeta+End" });
  await play(page, { press: "Enter" });
  await play(page, { type: "Notifications:Token", into: "settings" });
  await expect(settings).toHaveValue("Orders:PageSize\nFeatures:*\nNotifications:Token");
});

for (const id of keyboardTutorialGroups[0]) {
  test(`${id}: keyboard solution plays through the real UI`, async ({ page, consoleErrors }) => {
    await runKeyboardTutorial(page, consoleErrors, id);
  });
}

test("keyboard menu navigation waits for the placed menu's actual focus", async ({ page }) => {
  await gotoLive(page, "./?view=canvas&example=kafka-order-pipeline&live=1&paused=1");
  await node(page, "orders");
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
      if (this.getAttribute("role") === "menu") {
        hold.pending = true;
        pending.push(() => original.call(this, options));
      } else original.call(this, options);
    };
  });
  await page.keyboard.press("Shift+F10");
  await expect.poll(() => page.evaluate(() => window.__keyboardFocusHold?.pending)).toBe(true);
  let arrows = 0;
  const press = page.keyboard.press.bind(page.keyboard);
  page.keyboard.press = async (...args) => {
    if (args[0] === "ArrowDown") arrows++;
    return press(...args);
  };
  const navigating = focus(page, "context-menu-item-sim.fault");
  try {
    await animationFrames(page);
    expect(arrows, "visible rows do not own the keyboard before menu focus").toBe(0);
    await page.evaluate(() => window.__keyboardFocusHold?.release());
    await navigating;
    await expect(page.getByTestId("context-menu-item-sim.fault")).toHaveAttribute("data-active", "true");
  } finally {
    await page.evaluate(() => window.__keyboardFocusHold?.release());
    page.keyboard.press = press;
    await navigating;
  }
});

test("keyboard row navigation waits for the previous arrow's published destination", async ({ page }) => {
  await gotoLive(page, "./?view=canvas&example=kafka-order-pipeline&live=1&paused=1");
  await node(page, "orders");
  await page.keyboard.press("Shift+F10");
  await focus(page, "context-menu-item-sim.slowmo-from");
  const publication = await page.evaluateHandle(() => {
    const set = Element.prototype.setAttribute;
    const pending: (() => void)[] = [];
    let requested!: () => void;
    const started = new Promise<void>((resolve) => (requested = resolve));
    Element.prototype.setAttribute = function (name, value) {
      if (name === "data-active" && this.getAttribute("data-testid")?.startsWith("context-menu-item-")) {
        pending.push(() => set.call(this, name, value));
        requested();
      } else set.call(this, name, value);
    };
    return {
      started,
      release() {
        Element.prototype.setAttribute = set;
        for (const publish of pending.splice(0)) publish();
      },
    };
  });
  let returned = false;
  const navigating = focus(page, "context-menu-item-sim.fault").finally(() => (returned = true));
  // Observe errors in the held operation without turning a rejected driver into an unhandled promise.
  const outcome = navigating.catch((error: unknown) => error);
  try {
    await publication.evaluate(({ started }) => started);
    await animationFrames(page);
    expect(returned, "an acknowledged key does not establish the committed active row").toBe(false);
    await publication.evaluate(({ release }) => release());
    await navigating;
    await expect(page.getByTestId("context-menu-item-sim.fault")).toHaveAttribute("data-active", "true");
  } finally {
    await publication.evaluate(({ release }) => release());
    await outcome;
    await publication.dispose();
  }
});

test("keyboard row navigation recognises a searchable menu's focused search field", async ({ page }) => {
  await gotoLive(page, "./?view=canvas&example=kafka-order-pipeline&live=1&paused=1");
  await page.getByTestId("live-toggle").click();
  await node(page, "orders");
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("quick-add-search")).toBeFocused();
  await page.keyboard.insertText("PostgreSQL");
  await focus(page, "context-menu-item-quick-add:postgres");
  await expect(page.getByTestId("context-menu-item-quick-add:postgres")).toHaveAttribute("data-active", "true");
});

test("keyboard connection hands off when creation completes the step before optional port edits", async ({ page }) => {
  await page.goto("./?tutorial=request-vs-message");
  await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(page.getByTestId("tutorial-start")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-step", "connect");
  await expect(
    play(page, { connect: "node-api", to: "node-topic", fromSide: "right", side: "left" }),
  ).rejects.toBeInstanceOf(CompletedStep);
  await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-step", "live");
  expect(
    await page.evaluate(
      () => window.__tutorial?.diagram().edges.filter((edge) => edge.from === "api" && edge.to === "topic").length,
    ),
  ).toBe(1);
});

test("keyboard Live command waits for the requested session before its next input", async ({ page }) => {
  let requested = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/(?:assets\/LiveSession-[\w-]+\.js|src\/live\/LiveSession\.tsx)(?:\?.*)?$/, async (route) => {
    requested = true;
    await held;
    await route.continue();
  });
  await page.goto("./?tutorial=timeouts-pools");
  await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(page.getByTestId("tutorial-start")).toBeFocused();
  await page.keyboard.press("Enter");
  let settled = false;
  const entering = command(page, "live:toggle", ">").then(() => (settled = true));
  try {
    await expect.poll(() => requested).toBe(true);
    await expect(page.getByTestId("live-toggle")).toHaveAttribute("aria-busy", "true");
    await animationFrames(page);
    expect(settled).toBe(false);
    release();
    await entering;
    await expect(page.getByTestId("live-toggle")).toHaveAttribute("aria-busy", "false");
    await expect(page.getByTestId("live-sim-picker")).toBeVisible();
  } finally {
    release();
    await entering;
  }
});

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

test("keyboard menu confirmation releases the camera work deferred by that menu", async ({ page }) => {
  await page.setContent(
    '<div data-testid="canvas-wrap" data-camera-state="deferred" data-interaction-state="menu-open"><input data-testid="quick-add-search"></div>',
  );
  await page.getByTestId("quick-add-search").evaluate((input) => {
    input.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key !== "Enter") return;
      const canvas = input.parentElement;
      if (!canvas) throw new Error("Missing menu's camera owner");
      input.remove();
      canvas.setAttribute("data-interaction-state", "idle");
      canvas.setAttribute("data-camera-state", "idle");
      canvas.setAttribute("data-confirmations", "1");
    });
  });
  await page.getByTestId("quick-add-search").focus();
  await play(page, { press: "Enter" });
  await expect(page.getByTestId("quick-add-search")).toHaveCount(0);
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-confirmations", "1");
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

test("keyboard speed selection hands off when completion restores normal speed", async ({ page }) => {
  await page.setContent(
    '<select data-testid="live-speed"><option value="1">1×</option><option value="8">8×</option></select>',
  );
  await page.getByTestId("live-speed").evaluate((el) => {
    const select = el as HTMLSelectElement;
    let finished = false;
    Object.assign(window, { __tutorial: { snapshot: () => ({ state: { value: finished ? "finished" : "active" } }) } });
    select.addEventListener("change", () => {
      if (select.value !== "8") return;
      finished = true;
      select.value = "1";
    });
  });
  await page.keyboard.press("Tab");
  await expect(play(page, { choose: "live-speed", value: "8" })).rejects.toBeInstanceOf(CompletedStep);
  await expect(page.getByTestId("live-speed")).toHaveValue("1");
});

test("keyboard speed selection yields when completion takes focus before native input", async ({ page }) => {
  await page.setContent(
    '<select data-testid="live-speed"><option value="1">1×</option><option value="8">8×</option></select><button data-testid="handoff">Next lesson</button>',
  );
  await page.evaluate(() => {
    Object.assign(window, {
      __tutorial: { snapshot: () => ({ state: { value: document.body.dataset.finished ? "finished" : "active" } }) },
    });
  });
  await page.keyboard.press("Tab");
  const locate = page.getByTestId.bind(page);
  const press = page.keyboard.press.bind(page.keyboard);
  let lookups = 0;
  let keys = 0;
  let handoff: Promise<void> | undefined;
  page.getByTestId = (...args) => {
    // focus() has already sampled this select when the native driver obtains its locator.
    if (args[0] === "live-speed" && ++lookups === 2)
      handoff = page.evaluate(() => {
        document.body.dataset.finished = "true";
        document.querySelector<HTMLElement>('[data-testid="handoff"]')?.focus();
      });
    return locate(...args);
  };
  page.keyboard.press = async (...args) => {
    keys++;
    return press(...args);
  };
  try {
    const outcome = await play(page, { choose: "live-speed", value: "8" }).then(
      () => undefined,
      (error: unknown) => error,
    );
    if (!handoff) throw new Error("The native selection did not start");
    await handoff;
    expect(outcome).toBeInstanceOf(CompletedStep);
    expect(keys).toBe(0);
    await expect(locate("handoff")).toBeFocused();
    await expect(locate("live-speed")).toHaveValue("1");
  } finally {
    page.getByTestId = locate;
    page.keyboard.press = press;
  }
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
  await page.goto("./?tutorial=lab-tutorial-next");
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

test("keyboard control traversal waits for a pending canvas focus transaction before Tab", async ({ page }) => {
  await page.setContent(
    '<div data-testid="canvas-wrap" data-interaction-state="focus-pending" data-camera-state="idle"><button data-testid="rf__node-fixture">Canvas node</button></div><button data-testid="last">Transport</button>',
  );
  await page.getByTestId("rf__node-fixture").focus();
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>('[data-testid="canvas-wrap"]');
    if (!canvas) throw new Error("Missing focus fixture");
    document.addEventListener("keydown", (event) => {
      if (event.key === "Tab" && canvas.dataset.interactionState !== "idle") event.preventDefault();
    });
  });
  const byTestId = page.getByTestId.bind(page);
  const press = page.keyboard.press.bind(page.keyboard);
  let observed = false;
  let keys = 0;
  let settled = false;
  page.getByTestId = (id) => {
    if (id === "canvas-wrap") observed = true;
    return byTestId(id);
  };
  page.keyboard.press = (...args) => {
    keys++;
    return press(...args);
  };
  const focusing = focus(page, "last").then(() => (settled = true));
  try {
    await expect.poll(() => observed).toBe(true);
    await animationFrames(page);
    expect(settled).toBe(false);
    expect(keys).toBe(0);
    await expect(byTestId("rf__node-fixture")).toBeFocused();
    // Only this explicit commit releases focus, independently of any driver lookup.
    await byTestId("canvas-wrap").evaluate((canvas) => {
      canvas.dataset.interactionState = "idle";
    });
    await focusing;
    expect(keys).toBe(1);
    await expect(byTestId("last")).toBeFocused();
  } finally {
    page.getByTestId = byTestId;
    page.keyboard.press = press;
    await byTestId("canvas-wrap").evaluate((canvas) => {
      canvas.dataset.interactionState = "idle";
    });
    await focusing.catch(() => undefined);
  }
});
