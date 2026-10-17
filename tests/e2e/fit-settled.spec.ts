import { test, expect, savedDiagram, pauseClock, gotoLab, waitForStableBox } from "./fixtures";
import { checksChrome, command, readCanvas, settledCanvas } from "../parity/browser/canvas";
import type { Drawn } from "../parity/browser/canvas";
import layout from "../parity/goldens/browser/layout/aws-fanout.json" with { type: "json" };
import example from "../../src/examples/aws-fanout.json" with { type: "json" };
import { measuredHierarchyFixture } from "../../src/lab/nestedBoundariesFixture";
import { boundaryAround } from "../../src/editor/arrange";
import { callTool, installFakeModelContext, toolNames } from "./ai-helpers";
import { holdResizeObservers } from "../parity/browser/holdReadiness";
import { readyFonts } from "../../src/canvas/fonts";

// Keep actual font downloads/metrics intact; hold only the readiness promise consumed
// by the refinement gate. The editor must already be usable before this is released.
function holdFitFonts() {
  const load = document.fonts.load.bind(document.fonts);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  document.fonts.load = async (...args) => {
    const fonts = await load(...args);
    await held;
    return fonts;
  };
  window.addEventListener("release-fit-fonts", release);
}

test("a viewport chosen before initial measurements cancels the bootstrap fit", async ({ page }) => {
  await page.addInitScript(holdResizeObservers, true);
  await page.goto("./?view=canvas&example=aws-fanout");
  await expect(page.getByTestId("diagram-title")).toBeVisible();
  await page.clock.install();
  await pauseClock(page);
  await page.keyboard.press("Shift+Digit0");
  await page.clock.runFor(400);
  const chosen = (await readCanvas(page)).viewport;
  expect(chosen).toContain("scale(1)");
  await page.evaluate(() => window.dispatchEvent(new Event("release-resize-observers")));
  await page.clock.runFor(1000);
  await page.clock.resume();
  expect((await settledCanvas(page)).viewport).toBe(chosen);
});

test("an empty diagram never leaves a bootstrap fit queued for its first node", async ({ page }) => {
  await installFakeModelContext(page);
  await page.addInitScript(holdResizeObservers, false);
  await gotoLab(page, "empty");
  await page.getByTestId("lab-open-editor").click();
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-fit-pending", "false");
  await expect.poll(() => toolNames(page)).toContain("edit_diagram");
  // An agent adds without pointer/key input, so cancellation cannot mask an incorrectly
  // queued bootstrap on the initially empty canvas. Agent edits never request a view fit.
  await page.evaluate(() => window.dispatchEvent(new Event("hold-resize-observers")));
  expect(
    (
      await callTool(page, "edit_diagram", {
        ops: [{ op: "add_node", kind: "Redis", label: "First node", key: "first" }],
        layout: "none",
      })
    ).isError,
  ).toBe(false);
  await expect(page.getByTestId(/^rf__node-/)).toHaveCount(1);
  const chosen = (await readCanvas(page)).viewport;
  expect(chosen).toContain("scale(1)");
  await page.evaluate(() => window.dispatchEvent(new Event("release-resize-observers")));
  expect((await settledCanvas(page)).viewport).toBe(chosen);
});

test("pressing a node stops an active fit transition", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => {
    const load = document.fonts.load.bind(document.fonts);
    let held = false;
    document.fonts.load = async (...args) => {
      const result = await load(...args);
      if (held)
        await new Promise<void>((resolve) =>
          window.addEventListener("release-press-fonts", () => resolve(), { once: true }),
        );
      return result;
    };
    window.addEventListener("hold-press-fonts", () => {
      held = true;
      document.fonts.dispatchEvent(new Event("loadingdone"));
    });
  });
  await page.clock.install();
  await page.goto("./?view=canvas&example=aws-fanout");
  await settledCanvas(page);
  await page.mouse.move(800, 500);
  await page.mouse.wheel(300, 200);
  await settledCanvas(page);
  await pauseClock(page);
  await page.evaluate(() => window.dispatchEvent(new Event("hold-press-fonts")));
  const initial = (await readCanvas(page)).viewport;
  await page.getByTestId("fit-view-button").click();
  await expect
    .poll(async () => {
      await page.clock.runFor(16);
      return (await readCanvas(page)).viewport;
    })
    .not.toBe(initial);
  const moving = (await readCanvas(page)).viewport;
  await page.clock.runFor(16);
  expect((await readCanvas(page)).viewport).not.toBe(moving);
  const node = page.getByTestId("node-client");
  const before = (await readCanvas(page)).viewport;
  const pressedBox = await node.boundingBox();
  // Deliver the press to its target without a pointermove/hover taking ownership first.
  await node.dispatchEvent("pointerdown", {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
    isPrimary: true,
  });
  await node.dispatchEvent("mousedown", { button: 0, buttons: 1 });
  await page.clock.runFor(1000);
  expect((await readCanvas(page)).viewport).toBe(before);
  expect(await node.boundingBox()).toEqual(pressedBox);
  await node.dispatchEvent("pointerup", { pointerId: 1, pointerType: "mouse", button: 0, buttons: 0, isPrimary: true });
  await node.dispatchEvent("mouseup", { button: 0, buttons: 0 });
  await node.dispatchEvent("click", { button: 0 });
  await expect(page.getByTestId("rf__node-client")).toHaveClass(/\bselected\b/);
  await page.evaluate(() => window.dispatchEvent(new Event("release-press-fonts")));
  await page.clock.resume();
});

test("the first visible frame is fitted while font readiness is pending", async ({ page }) => {
  await page.addInitScript(holdFitFonts);
  await page.addInitScript(() => {
    const sample = () => {
      const nodes = [...document.querySelectorAll<HTMLElement>('[data-testid^="rf__node-"]')];
      if (!nodes.length || nodes.some((n) => getComputedStyle(n).visibility !== "visible")) {
        requestAnimationFrame(sample);
        return;
      }
      const pane = document.querySelector('[data-testid="canvas-wrap"]')?.getBoundingClientRect();
      if (!pane) throw new Error("Expected the first visible canvas");
      Object.assign(window, {
        firstVisibleFit: {
          transform: nodes[0].parentElement?.parentElement?.style.transform,
          clear: nodes.every((node) => {
            const r = node.getBoundingClientRect();
            return r.left >= pane.left && r.right <= pane.right && r.top >= pane.top && r.bottom <= pane.bottom;
          }),
        },
      });
    };
    requestAnimationFrame(sample);
  });
  await page.goto("./?view=canvas&example=kafka-order-pipeline");
  await expect(page.getByTestId("node-shopper")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => !!(window as unknown as { firstVisibleFit?: unknown }).firstVisibleFit))
    .toBe(true);
  const first = await page.evaluate(
    () => (window as unknown as { firstVisibleFit: { transform: string; clear: boolean } }).firstVisibleFit,
  );
  expect(first.clear).toBe(true);
  expect(Number(/scale\(([^)]+)\)/.exec(first.transform)?.[1])).toBeLessThan(1);
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-fit-pending", "true");
  await page.evaluate(() => window.dispatchEvent(new Event("release-fit-fonts")));
  await settledCanvas(page);
});

test("pressing a node cancels a pending refinement without moving its screen box", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(holdFitFonts);
  await page.goto("./?view=canvas&example=aws-fanout");
  const canvas = page.getByTestId("canvas-wrap");
  const node = page.getByTestId("node-client");
  await expect(node).toBeVisible();
  await expect(canvas).toHaveAttribute("data-fit-pending", "true");
  await node.hover();
  // Hover already owns the opening view. Request another fit with the pointer
  // stationary on the card, so only the subsequent press can cancel this one.
  await page.keyboard.press("Shift+Digit1");
  await waitForStableBox(node);
  await expect(canvas).toHaveAttribute("data-fit-pending", "true");
  // Make the eventual chrome refinement observably different from the early fit.
  await page.getByTestId("diagram-card").evaluate((el) => {
    const row = document.createElement("div");
    row.dataset.testid = "held-fit-chrome";
    row.style.height = "160px";
    el.append(row);
  });
  const before = await node.boundingBox();
  if (!before) throw new Error("Expected the client card");
  const view = (await readCanvas(page)).viewport;
  await page.mouse.down();
  await expect(canvas).toHaveAttribute("data-fit-pending", "false");
  await page.evaluate(() => window.dispatchEvent(new Event("release-fit-fonts")));
  // Deliver the held signal with the pointer still down, then let queued frames run.
  await node.evaluate(async () => {
    for (let frame = 0; frame < 12; frame++) await new Promise(requestAnimationFrame);
  });
  expect((await readCanvas(page)).viewport).toBe(view);
  expect(await node.boundingBox()).toEqual(before);
  await page.mouse.up();
  await expect(page.getByTestId("rf__node-client")).toHaveClass(/\bselected\b/);
  expect((await settledCanvas(page)).viewport).toBe(view);
  expect(await node.boundingBox()).toEqual(before);
});

for (const interaction of ["hovering", "focusing"]) {
  test(`${interaction} a node cancels a pending refinement and keeps its tooltip`, async ({ page }) => {
    await page.addInitScript(holdFitFonts);
    await page.goto("./?view=canvas&example=kafka-order-pipeline");
    const canvas = page.getByTestId("canvas-wrap");
    await expect(canvas).toHaveAttribute("data-fit-pending", "true");
    if (interaction === "hovering") await page.getByTestId("node-shopper").hover();
    else await page.getByTestId("rf__node-shopper").focus();
    await expect(canvas).toHaveAttribute("data-fit-pending", "false");
    const before = (await readCanvas(page)).viewport;
    await page.evaluate(() => window.dispatchEvent(new Event("release-fit-fonts")));
    await expect(page.getByTestId("node-tooltip")).toBeVisible();
    expect((await settledCanvas(page)).viewport).toBe(before);
  });
}

test("opening a panel fits immediately while a refinement is pending", async ({ page }) => {
  await page.addInitScript(holdFitFonts);
  await page.goto("./?view=canvas&example=kafka-order-pipeline");
  const canvas = page.getByTestId("canvas-wrap");
  await expect(page.getByTestId("node-shopper")).toBeVisible();
  await expect(canvas).toHaveAttribute("data-fit-pending", "true");
  await page.getByTestId("inspector-toggle").click();
  await expect(page.getByTestId("inspector")).not.toHaveAttribute("data-collapsed", "1");
  await expect
    .poll(() =>
      canvas.evaluate((el) => {
        const pane = el.getBoundingClientRect();
        return [...el.querySelectorAll<HTMLElement>('[data-testid^="rf__node-"]')].every((node) => {
          const r = node.getBoundingClientRect();
          return r.left >= pane.left && r.right <= pane.right && r.top >= pane.top && r.bottom <= pane.bottom;
        });
      }),
    )
    .toBe(true);
  await expect(canvas).toHaveAttribute("data-fit-pending", "true");
  await page.evaluate(() => window.dispatchEvent(new Event("release-fit-fonts")));
  await settledCanvas(page);
});

test("a keyboard zoom during opening owns the view before the first refinement", async ({ page }) => {
  await page.addInitScript(holdFitFonts);
  await page.goto("./?view=canvas&example=kafka-order-pipeline");
  await expect(page.getByTestId("node-shopper")).toBeVisible();
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-fit-pending", "true");
  await page.keyboard.press("Shift+Digit0");
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-fit-pending", "false");
  await page.evaluate(() => window.dispatchEvent(new Event("release-fit-fonts")));
  const before = (await settledCanvas(page)).viewport;
  await page.getByTestId("inspector-toggle").click();
  expect((await settledCanvas(page)).viewport).toBe(before);
});

test("Auto-layout fits its committed positions before the next font refinement", async ({ page }) => {
  await page.addInitScript(() => {
    const load = document.fonts.load.bind(document.fonts);
    let armed = false;
    let original = "";
    const position = () => document.querySelector<HTMLElement>('[data-testid="rf__node-async-b"]')?.style.transform;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    document.fonts.load = async (...args) => {
      const fonts = await load(...args);
      if (armed && position() !== original) await held;
      return fonts;
    };
    window.addEventListener("hold-layout-refinement", () => {
      original = position() ?? "";
      armed = true;
      // A position-only edit reuses font readiness. Explicitly invalidate it for this
      // held-font ordering probe, while preserving actual font metrics and card sizes.
      document.fonts.dispatchEvent(new Event("loadingdone"));
    });
    window.addEventListener("release-layout-refinement", release);
  });
  await gotoLab(page, "edges-kinds");
  await page.getByTestId("lab-open-editor").click();
  await settledCanvas(page);
  const node = page.getByTestId("rf__node-async-b");
  const before = await node.evaluate((el) => el.style.transform);
  await page.evaluate(() => window.dispatchEvent(new Event("hold-layout-refinement")));
  await command(page, "Auto-layout", "canvas.auto-layout");
  await expect.poll(() => node.evaluate((el) => el.style.transform)).not.toBe(before);
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-fit-pending", "true");
  // No card resizes or changes identity to mask a missed React Flow store commit.
  await node.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const fitted = (await readCanvas(page)).viewport;
  await page.evaluate(() => window.dispatchEvent(new Event("release-layout-refinement")));
  expect((await settledCanvas(page)).viewport).toBe(fitted);
});

// Pin the mutation itself before comparing fits: two identical drawings could both be
// the original, unlaid-out document. Positions are platform-independent; card fonts aren't.
function expectLaidOut(drawn: Drawn) {
  for (const [id, node] of Object.entries(layout.autoLayout.nodes)) {
    const position = node.box.slice(0, node.box.indexOf(")") + 1);
    const actual = (drawn.nodes[id] as { box: string }).box;
    expect(actual.slice(0, actual.indexOf(")") + 1)).toBe(position);
  }
  expect((drawn.nodes["group:aws"] as { box: string }).box).toBe("translate(0px, -24px) 2726×536");
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

test("measurement transactions release all node observations while idle and register again on request", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.ResizeObserver;
    const targets = new Map<ResizeObserver, Set<Element>>();
    const gates = new Set<ResizeObserver>();
    let registrations = 0;
    window.ResizeObserver = class extends Native {
      observe(target: Element, options?: ResizeObserverOptions) {
        const own = targets.get(this) ?? new Set<Element>();
        own.add(target);
        targets.set(this, own);
        if (
          [...own].some((el) => el.getAttribute("data-testid") === "canvas-wrap") &&
          [...own].some((el) => el.getAttribute("data-testid")?.startsWith("rf__node-"))
        ) {
          gates.add(this);
          registrations++;
        }
        super.observe(target, options);
      }
      unobserve(target: Element) {
        targets.get(this)?.delete(target);
        super.unobserve(target);
      }
      disconnect() {
        targets.get(this)?.clear();
        super.disconnect();
      }
    };
    Object.assign(window, {
      nodeObservations: () => ({
        registrations,
        retained: [...gates].reduce((count, gate) => count + (targets.get(gate)?.size ?? 0), 0),
      }),
    });
  });
  const observations = () =>
    page.evaluate(() =>
      (window as unknown as { nodeObservations(): { registrations: number; retained: number } }).nodeObservations(),
    );
  await page.goto("./?view=canvas&example=aws-fanout");
  await settledCanvas(page);
  const opened = await observations();
  expect(opened.registrations).toBeGreaterThan(0);
  expect(opened.retained).toBe(0);
  await page.getByTestId("rf__node-client").click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("rf__node-client")).toHaveCount(0);
  await settledCanvas(page);
  expect((await observations()).retained).toBe(0);
  await page.getByTestId("fit-view-button").click();
  await settledCanvas(page);
  const fitted = await observations();
  expect(fitted.registrations).toBeGreaterThan(opened.registrations);
  expect(fitted.retained).toBe(0);
});

test("a folded title card caches its expanded footprint across resize notifications", async ({ page }) => {
  await page.addInitScript(() => {
    const Native = window.ResizeObserver;
    const observers = new Map<ResizeObserver, { callback: ResizeObserverCallback; targets: Set<Element> }>();
    window.ResizeObserver = class extends Native {
      constructor(callback: ResizeObserverCallback) {
        super(callback);
        observers.set(this, { callback, targets: new Set() });
      }
      observe(target: Element, options?: ResizeObserverOptions) {
        observers.get(this)?.targets.add(target);
        super.observe(target, options);
      }
      disconnect() {
        observers.get(this)?.targets.clear();
        super.disconnect();
      }
    };
    let clones = 0;
    const cloneNode = HTMLElement.prototype.cloneNode;
    HTMLElement.prototype.cloneNode = function (deep) {
      if (this.dataset.testid === "diagram-card") clones++;
      return cloneNode.call(this, deep);
    };
    Object.assign(window, {
      titleClones: () => clones,
      resizeTitle: (count: number) => {
        for (let i = 0; i < count; i++)
          for (const [observer, { callback, targets }] of observers)
            if ([...targets].some((el) => el.getAttribute("data-testid") === "diagram-card")) callback([], observer);
        return clones;
      },
    });
  });
  await page.goto("./?view=canvas&example=aws-fanout");
  await settledCanvas(page);
  await checksChrome(page, "aws-fanout");
  const card = page.getByTestId("diagram-card");
  const box = await card.boundingBox();
  const node = await page.getByTestId("rf__node-client").boundingBox();
  if (!box || !node) throw new Error("Expected the title and client boxes");
  await page.mouse.move(800, 500);
  await page.mouse.wheel(node.x - box.x - 20, node.y - box.y - 20);
  await expect(card).toHaveAttribute("data-collapsed", "1");
  const clones = () => page.evaluate(() => (window as unknown as { titleClones(): number }).titleClones());
  const before = await page.evaluate(() =>
    (window as unknown as { resizeTitle(count: number): number }).resizeTitle(1),
  );
  // A transition can deliver any number of notifications. Count the expensive work directly.
  const repeated = await page.evaluate(() =>
    (window as unknown as { resizeTitle(count: number): number }).resizeTitle(12),
  );
  expect(repeated).toBe(before);
  const height = Number(await card.getAttribute("data-overlay-height"));
  await card.evaluate((el) => {
    const row = document.createElement("div");
    row.dataset.testid = "extra-title-row";
    row.style.height = "50px";
    row.textContent = "New content";
    el.append(row);
  });
  await expect.poll(clones).toBe(before + 1);
  await expect.poll(async () => Number(await card.getAttribute("data-overlay-height"))).toBeGreaterThan(height);
  const fontReady = await page.evaluate(() => {
    const probe = window as unknown as { titleClones(): number };
    const before = probe.titleClones();
    document.fonts.dispatchEvent(new Event("loadingdone"));
    return { before, after: probe.titleClones() };
  });
  expect(fontReady.after).toBe(fontReady.before + 1);
  const presenting = await card.evaluate((el) => {
    const probe = window as unknown as { resizeTitle(count: number): number; titleClones(): number };
    const before = probe.titleClones();
    el.classList.add("is-large");
    return { before, after: probe.resizeTitle(12) };
  });
  expect(presenting.after).toBe(presenting.before + 1);
  const resized = await page.getByTestId("canvas-wrap").evaluate((el) => {
    const probe = window as unknown as { resizeTitle(count: number): number; titleClones(): number };
    const before = probe.titleClones();
    el.style.flex = "0 0 300px";
    el.style.width = "300px";
    return { before, after: probe.resizeTitle(12) };
  });
  expect(resized.after).toBe(resized.before + 1);
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
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("command-input").fill("Auto-layout");
  await page.evaluate(() => window.dispatchEvent(new Event("hold-react-work")));
  await page.getByTestId("command-item-action:canvas.auto-layout").click();
  await page.clock.runFor(1000);
  await page.evaluate(() => window.dispatchEvent(new Event("release-react-work")));
  await page.clock.resume();
  const before = await settledCanvas(page);
  expectLaidOut(before);
  await page.getByTestId("fit-view-button").click();
  expect(await settledCanvas(page)).toEqual(before);
});

for (const scenario of ["opening", "early Auto-layout", "Auto-layout chrome", "Auto-layout then Fit view"]) {
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
    if (scenario === "Auto-layout then Fit view") await page.getByTestId("fit-view-button").click();
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
    if (autoLayout) expectLaidOut(before);
    await page.getByTestId("fit-view-button").click();
    const after = await settledCanvas(page);
    expect(after).toEqual(before);
  });
}

test("Undo cancels Auto-layout while measurements are held and preserves history", async ({ page }) => {
  await page.addInitScript(holdResizeObservers, true);
  await page.goto("./?view=canvas&example=aws-fanout");
  await expect(page.getByTestId("diagram-title")).toBeVisible();
  // Hold observer delivery, not font loading: both snapshots need the same real metrics.
  await page.getByTestId("canvas-wrap").evaluate(readyFonts);
  const boxes = async () =>
    Object.fromEntries(
      Object.entries((await readCanvas(page)).nodes).map(([id, node]) => [id, (node as { box: string }).box]),
    );
  const original = await boxes();
  await command(page, "Auto-layout", "canvas.auto-layout");
  await expect(page.getByTestId("undo-button")).toBeEnabled();
  await page.getByTestId("canvas-wrap").focus();
  await page.keyboard.press("ControlOrMeta+z");
  await page.evaluate(() => window.dispatchEvent(new Event("release-resize-observers")));
  await settledCanvas(page);
  expect(await boxes()).toEqual(original);
  await expect(page.getByTestId("undo-button")).toBeDisabled();
  await expect(page.getByTestId("redo-button")).toBeDisabled();
  // The cancelled command creates no phantom step; a later completed layout still undoes/redoes normally.
  await command(page, "Auto-layout", "canvas.auto-layout");
  const laidOut = await settledCanvas(page);
  expectLaidOut(laidOut);
  await page.getByTestId("undo-button").click();
  await settledCanvas(page);
  expect(await boxes()).toEqual(original);
  await page.getByTestId("redo-button").click();
  expectLaidOut(await settledCanvas(page));
});

test("opening Checks refits after its delayed UI chunk mounts", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route(/\/(?:assets\/ChecksCard-[\w-]+\.js|src\/checks\/ui\/ChecksCard\.tsx)(?:\?.*)?$/, async (route) => {
    requested = true;
    await held;
    await route.continue();
  });
  await page.goto("./?view=canvas&example=aws-fanout");
  await settledCanvas(page);
  await command(page, "Check diagram", "canvas.check-diagram");
  await expect.poll(() => requested).toBe(true);
  await expect(page.getByTestId("checks-card")).toHaveCount(0);
  // Let the original open-triggered fit finish while the chunk is still held.
  await settledCanvas(page);
  release();
  const card = page.getByTestId("checks-card");
  await expect(card).toBeVisible();
  await settledCanvas(page);
  const covered = await card.evaluate((el) => {
    const c = el.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>('[data-testid^="node-"]')]
      .filter((node) => {
        const n = node.getBoundingClientRect();
        return n.left < c.right && n.right > c.left && n.top < c.bottom && n.bottom > c.top;
      })
      .map((node) => node.dataset.testid);
  });
  expect(covered).toEqual([]);
});

for (const interrupted of [false, true]) {
  test(`the canvas mutation observer disconnects ${interrupted ? "after an interrupted animated fit" : "when idle and reconnects for nested fits"}`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const stats = { callbacks: 0, records: 0, observes: 0, active: 0 };
      Object.assign(window, { canvasMutations: stats });
      const watched = new WeakSet<MutationObserver>();
      const connected = new WeakSet<MutationObserver>();
      const Native = window.MutationObserver;
      window.MutationObserver = class extends Native {
        constructor(callback: MutationCallback) {
          super((records, observer) => {
            if (watched.has(observer)) {
              stats.callbacks++;
              stats.records += records.length;
            }
            callback(records, observer);
          });
        }
        observe(target: Node, options?: MutationObserverInit) {
          if (
            target instanceof HTMLElement &&
            target.dataset.testid === "canvas-wrap" &&
            options?.subtree &&
            options.attributes &&
            options.childList
          ) {
            watched.add(this);
            stats.observes++;
            if (!connected.has(this)) stats.active++;
            connected.add(this);
          }
          super.observe(target, options);
        }
        disconnect() {
          if (connected.delete(this)) stats.active--;
          super.disconnect();
        }
      };
    });
    const stats = () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              canvasMutations: { callbacks: number; records: number; observes: number; active: number };
            }
          ).canvasMutations,
      );
    await page.goto("./?view=canvas&example=aws-fanout");
    await settledCanvas(page);
    const opened = await stats();
    expect(opened.observes).toBeGreaterThan(0);
    await command(page, "Auto-layout", "canvas.auto-layout");
    expectLaidOut(await settledCanvas(page));
    await page.getByTestId("fit-view-button").click();
    await settledCanvas(page);
    if (interrupted) {
      await page.clock.install();
      await page.mouse.move(800, 500);
      await page.mouse.wheel(300, 200);
      await settledCanvas(page);
      await pauseClock(page);
      await page.getByTestId("fit-view-button").click();
      // Advance by frames until the animated viewport actually moves, then interrupt it.
      const start = (await readCanvas(page)).viewport;
      for (let frame = 0; (await readCanvas(page)).viewport === start; frame++) {
        expect(frame).toBeLessThan(100);
        await page.clock.runFor(16);
      }
      await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-fit-pending", "true");
      await page.mouse.move(800, 500);
      await page.mouse.wheel(80, 40);
      await page.clock.runFor(32);
      await page.clock.resume();
      await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-fit-pending", "false");
      await expect.poll(async () => (await stats()).active).toBe(0);
      // Request no later fit: count mutation callbacks through subsequent canvas changes.
    }
    const before = await stats();
    const client = page.getByTestId("rf__node-client");
    const node = page.getByTestId("node-client");
    if (!interrupted) {
      const position = await client.evaluate((el) => el.style.transform);
      const box = await node.boundingBox();
      if (!box) throw new Error("Expected the client card to be visible");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 20 });
      await page.mouse.up();
      await expect.poll(() => client.evaluate((el) => el.style.transform)).not.toBe(position);
    }
    // Count frames, not elapsed time; exercise attributes and child lists like live decorations.
    await node.evaluate(async (el) => {
      for (let i = 0; i < 20; i++) {
        el.dataset.liveFrame = String(i);
        const decoration = document.createElement("span");
        el.append(decoration);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        decoration.remove();
      }
    });
    const after = await stats();
    expect(after.callbacks).toBe(before.callbacks);
    expect(after.records).toBe(before.records);
    expect(after.active).toBe(0);
    expect(after.observes).toBeGreaterThan(opened.observes);
  });
}

for (const [width, height] of [
  [0, 536],
  [2726, 0],
  [0, 0],
  [0.1, 536],
  [2726, 0.4],
  [0.1, 0.4],
]) {
  test(`an imported ${width}×${height} boundary does not block opening, Fit view or Auto-layout`, async ({ page }) => {
    await page.goto("./?view=canvas&example=aws-fanout");
    await settledCanvas(page);
    const title = "Empty boundary import";
    await page.getByTestId("import-input").setInputFiles({
      name: "empty-boundary.diagram.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({ ...example, title, groups: example.groups.map((g) => ({ ...g, width, height })) }),
      ),
    });
    await expect(page.getByTestId("diagram-title")).toHaveText(title);
    const canvas = page.getByTestId("canvas-wrap");
    await expect(canvas).toHaveAttribute("data-fit-pending", "false");
    const before = await readCanvas(page);
    expect((before.nodes["group:aws"] as { box: string }).box).toContain(`${Math.round(width)}×${Math.round(height)}`);
    await page.getByTestId("fit-view-button").click();
    await expect(canvas).toHaveAttribute("data-fit-pending", "false");
    expect(await readCanvas(page)).toEqual(before);
    await command(page, "Auto-layout", "canvas.auto-layout");
    expectLaidOut(await settledCanvas(page));
  });
}

test("nested empty boundaries refit measured descendants before a later Fit view", async ({ page }) => {
  await page.addInitScript(holdResizeObservers, false);
  await page.goto("./?view=canvas&example=aws-fanout");
  await settledCanvas(page);
  await page.evaluate(() => window.dispatchEvent(new Event("hold-resize-observers")));
  await page.getByTestId("import-input").setInputFiles({
    name: "measured-hierarchy.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(measuredHierarchyFixture)),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText(measuredHierarchyFixture.title);
  await command(page, "Auto-layout", "canvas.auto-layout");
  await page.getByTestId("fit-view-button").click();
  await page.clock.install();
  await page.clock.runFor(1000);
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-fit-pending", "true");
  await page.evaluate(() => window.dispatchEvent(new Event("release-resize-observers")));
  await page.clock.resume();
  const laidOut = await settledCanvas(page);
  const saved = await savedDiagram(page);
  const savedGroups = saved.groups ?? [];
  const originalGroups = measuredHierarchyFixture.groups ?? [];
  expect(savedGroups).toHaveLength(originalGroups.length);
  expect(Object.fromEntries((saved.annotations ?? []).map((a) => [a.id, a.group]))).toEqual(
    Object.fromEntries((measuredHierarchyFixture.annotations ?? []).map((a) => [a.id, a.group])),
  );
  for (const group of savedGroups) {
    if (group.id === "empty") {
      expect(group.width).toBe(0);
      expect(group.height).toBe(0);
      continue;
    }
    const ids = [
      ...saved.nodes,
      ...savedGroups.map((g) => ({ ...g, id: `group:${g.id}` })),
      ...(saved.annotations ?? []),
    ]
      .filter((n) => n.group === group.id)
      .map((n) => n.id);
    const boxes = await page.getByTestId("canvas-wrap").evaluate(
      (scope, ids) =>
        ids.map((id) => {
          const el = scope.querySelector<HTMLElement>(`[data-testid="rf__node-${id}"]`);
          if (!el) throw new Error(`Missing measured member: ${id}`);
          const position = new DOMMatrix(el.style.transform);
          return { id, x: position.e, y: position.f, width: el.offsetWidth, height: el.offsetHeight };
        }),
      ids,
    );
    expect({ x: group.x, y: group.y, width: group.width, height: group.height }).toEqual(boundaryAround(boxes));
  }
  expect(savedGroups.map((g) => [g.id, g.group])).toEqual(originalGroups.map((g) => [g.id, g.group]));
  await page.getByTestId("fit-view-button").click();
  expect(await settledCanvas(page)).toEqual(laidOut);
});
