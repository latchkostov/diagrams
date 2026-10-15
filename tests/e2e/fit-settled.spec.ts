import { test, expect, savedDiagram } from "./fixtures";
import { command, readCanvas, settledCanvas } from "../parity/browser/canvas";
import type { Drawn } from "../parity/browser/canvas";
import layout from "../parity/goldens/browser/layout/aws-fanout.json" with { type: "json" };
import example from "../../src/examples/aws-fanout.json" with { type: "json" };
import { measuredHierarchyFixture } from "../../src/lab/nestedBoundariesFixture";
import { boundaryAround } from "../../src/editor/arrange";

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

test("opening Checks refits after its delayed UI chunk mounts", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route(/\/assets\/ChecksCard-[\w-]+\.js$/, async (route) => {
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

test("the canvas mutation observer disconnects when idle and reconnects for nested fits", async ({ page }) => {
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
  const before = await stats();
  const client = page.getByTestId("rf__node-client");
  const position = await client.evaluate((el) => el.style.transform);
  const node = page.getByTestId("node-client");
  const box = await node.boundingBox();
  if (!box) throw new Error("Expected the client card to be visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 20 });
  await page.mouse.up();
  await expect.poll(() => client.evaluate((el) => el.style.transform)).not.toBe(position);
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

for (const [width, height] of [
  [0, 536],
  [2726, 0],
  [0, 0],
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
    expect((before.nodes["group:aws"] as { box: string }).box).toContain(`${width}×${height}`);
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
