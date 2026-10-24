import { TEXT_END, interactionJournalMark, interactionLog, waitForInteractionIdle } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { textFieldsFixture } from "../../src/lab/textFieldsFixture";
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  expectNoErrors,
  waitForStableViewport,
  fitDiagram,
  waitForStableBox,
  pauseClock,
  STORAGE_KEYS,
} from "./fixtures";
import { must, openAdvanced } from "./ai-helpers";

// Text fields behave as text fields do everywhere (docs/UX-PRINCIPLES.md, Editing text): a double-click selects a
// word, a triple-click the line (all of a one-line field), and the selection is visible, in both themes. A node,
// a connection and a boundary are renamed in the inspector (the owner's decision, 2026-10-13): a double-click, F2,
// Enter or a new node's quick-add opens its Label with all of it selected, so typing replaces it. A note's text is
// still edited in place. Selectors are data-testid only.

const SLUG = "kafka-order-pipeline";
const MOD = "ControlOrMeta";
// The keyboard tooltip also starts with node- and repeats the focused node's name.
const nodes = (page: Page) => page.getByTestId(/^node-(?!tooltip$|editor-)/);

const SEED = textFieldsFixture;

async function seed(page: Page) {
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("seeded", "1");
      }
    },
    [STORAGE_KEYS.autosavePrefix + SLUG, JSON.stringify(SEED)] as const,
  );
  await gotoCanvas(page, SLUG);
  await expect(page.getByTestId("node-c")).toBeVisible();
  await waitForStableViewport(page);
}

type Field = HTMLInputElement | HTMLTextAreaElement;
const selected = (field: Locator) =>
  field.evaluate((el: Field) => el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0));

/** A point on the field's first word: just inside its padding, half a line down. */
async function firstWord(field: Locator) {
  return field.evaluate((el: Field) => {
    const s = getComputedStyle(el);
    const line = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.3;
    const top = el instanceof HTMLTextAreaElement ? parseFloat(s.paddingTop) + line / 2 : el.clientHeight / 2;
    return { x: parseFloat(s.paddingLeft) + 8, y: top };
  });
}

/**
 * A double-click selects the first word, a triple-click the first line (`line`). Trimmed: Windows takes the space
 * after a word with it, and a textarea's line its line break, as they do everywhere on that platform.
 */
async function expectNativeSelection(field: Locator, word: string, line: string) {
  // Opening an in-canvas editor can refit the viewport after focus has already arrived.
  await waitForStableBox(field);
  const at = await firstWord(field);
  // Resolve the field afresh for each gesture: lazy capabilities can move the AI
  // request between the word assertion and the triple-click.
  await field.dblclick({ position: at });
  await expect(field).toBeFocused();
  await expect.poll(async () => (await selected(field)).trim()).toBe(word);
  await field.click({ position: at, clickCount: 3 });
  await expect.poll(async () => (await selected(field)).trim()).toBe(line);
  await expect(field).toBeFocused();
}

/**
 * The selection paints: the field's ::selection background stands apart from the field behind it, its text reads
 * on it (AA), and a screenshot with the text selected differs from one without.
 */
async function expectVisibleSelection(field: Locator) {
  await field.evaluate((el: Field) => el.select());
  const colours = await field.evaluate((el: Field) => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("No 2D canvas");
    const rgba = (c: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    let under: number[] = [255, 255, 255, 255];
    for (let e: Element | null = el; e; e = e.parentElement) {
      const c = rgba(getComputedStyle(e).backgroundColor);
      if (c[3] >= 200) {
        under = c;
        break;
      }
    }
    const sel = getComputedStyle(el, "::selection");
    return { highlight: rgba(sel.backgroundColor), ink: rgba(sel.color), under };
  });
  const lum = ([r, g, b]: number[]) => {
    const f = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a: number[], b: number[]) => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  expect(colours.highlight[3], "the highlight is opaque").toBe(255);
  expect(ratio(colours.highlight, colours.under), "highlight against the field").toBeGreaterThanOrEqual(1.5);
  expect(ratio(colours.ink, colours.highlight), "selected text on the highlight").toBeGreaterThanOrEqual(4.5);
  const withSelection = await field.screenshot();
  await field.evaluate((el: Field) => el.setSelectionRange(el.value.length, el.value.length));
  const without = await field.screenshot();
  // A transparent highlight changes nothing (0%); a visible one paints behind the text (3% of Ctrl+K's wide field
  // for a short query, more for a note).
  const painted = await changedShare(field.page(), withSelection, without);
  expect(painted, "share of the field the highlight paints").toBeGreaterThan(0.01);
}

/** The share of pixels that differ clearly between two screenshots (decoded in a blank page, outside the app's CSP). */
async function changedShare(page: Page, a: Buffer, b: Buffer): Promise<number> {
  const blank = await page.context().newPage();
  try {
    return await blank.evaluate(
      async ([x, y]) => {
        const pixels = async (b64: string) => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          const g = c.getContext("2d");
          if (!g) throw new Error("No 2D canvas");
          g.drawImage(img, 0, 0);
          return g.getImageData(0, 0, c.width, c.height).data;
        };
        const [p, q] = await Promise.all([pixels(x), pixels(y)]);
        let changed = 0;
        for (let i = 0; i < p.length; i += 4)
          if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 60) changed++;
        return changed / (p.length / 4);
      },
      [a.toString("base64"), b.toString("base64")] as const,
    );
  } finally {
    await blank.close();
  }
}

const canvasFocused = (page: Page) =>
  page.getByTestId("canvas-wrap").evaluate((wrap) => {
    const focus = document.activeElement;
    return !!focus && wrap.contains(focus) && focus.getAttribute("role") === "group";
  });

test("an inspector focus request waits for its selected node's field", async ({ page, consoleErrors }) => {
  await page.goto("/?view=lab&preset=inspector-focus");
  await expect(page.getByTestId("inspector-focus-cache")).toBeVisible();
  await page.clock.install();
  await pauseClock(page);
  const label = page.getByTestId("inspector-field-label");
  for (const [id, name] of [
    ["cache", "Session store"],
    ["db", "Orders database"],
  ]) {
    await page.getByTestId(`inspector-focus-${id}`).click();
    // The frame delivering the new selection is still held. Never focus a previous node's name.
    await expect(page.getByTestId(`inspector-focus-${id}`)).toBeFocused();
    await page.clock.runFor(100);
    await expect(label).toBeFocused();
    await expect.poll(() => selected(label)).toBe(name);
  }
  expectNoErrors(consoleErrors);
});

test("live inspector naming preserves edits to the active saved simulation", async ({ page, consoleErrors }) => {
  // This uses the public saved run; do not load the naming fixture first.
  await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1&sim=black-friday&paused=1`);
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-edit-sims").click();
  await page.getByTestId("sim-panel-title").fill("Unsaved saved-run edit");
  await expect(page.getByTestId("sim-panel-dirty")).toBeVisible();
  await waitForStableViewport(page);
  await page.getByTestId("node-shopper").dblclick();
  await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-edit-sims").click();
  await expect(page.getByTestId("sim-panel-title")).toHaveValue("Unsaved saved-run edit");
  await expect(page.getByTestId("sim-panel-dirty")).toBeVisible();
  await expect(page.getByTestId("live-sim-picker")).toHaveValue("black-friday");
  expectNoErrors(consoleErrors);
});

test.describe("renaming in the inspector", () => {
  test.beforeEach(async ({ page }) => seed(page));

  test("a double-click on a node, a boundary or a connection opens its Label in the inspector, all selected", async ({
    page,
    consoleErrors,
  }) => {
    // Hidden by hand, with a node selected, the inspector opens for it.
    await page.getByTestId("node-a").click();
    await expect(page.getByTestId("inspector-title")).toHaveText("Node");
    await page.getByTestId("inspector-toggle").click();
    await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
    const label = page.getByTestId("inspector-field-label");
    const cases = [
      { open: "node-a", title: "Node", was: "Order service", shown: "node-a" },
      { open: "group-label-core", title: "Boundary", was: "Core platform", shown: "group-label-core" },
      { open: "edge-label-ab", title: "Edge", was: "writes", shown: "edge-label-ab" },
    ];
    for (const c of cases) {
      await page.getByTestId(c.open).dblclick();
      await expect(page.getByTestId("inspector-title")).toHaveText(c.title);
      await expect(label).toBeFocused();
      await expect.poll(() => selected(label)).toBe(c.was);
      await page.keyboard.type("Renamed here");
      await expect(page.getByTestId(c.shown)).toContainText("Renamed here");
      // Enter is done: focus goes back to the thing on the canvas, and one Undo takes the name back.
      await page.keyboard.press("Enter");
      await expect.poll(() => canvasFocused(page)).toBe(true);
      await page.keyboard.press(`${MOD}+z`);
      await expect(page.getByTestId(c.shown)).toContainText(c.was);
      await expect(page.getByTestId(c.shown)).not.toContainText("Renamed here");
    }
    // No editor ever opened on the canvas.
    await expect(page.getByTestId("node-editor")).toHaveCount(0);
    await expect(page.getByTestId("group-label-input")).toHaveCount(0);
    await expect(page.getByTestId("edge-label-input")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("folding and reopening the inspector does not replay its old rename focus", async ({ page }) => {
    await page.getByTestId("node-a").dblclick();
    const label = page.getByTestId("inspector-field-label");
    await expect(label).toBeFocused();
    await page.keyboard.press("Enter");
    await page.getByTestId("inspector-toggle").click();
    await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
    await page.getByTestId("inspector-toggle").click();
    await expect(label).toBeVisible();
    await waitForStableViewport(page);
    await expect(label).not.toBeFocused();
  });

  test("presentation does not replay a completed name's focus request", async ({ page }) => {
    await page.getByTestId("node-c").dblclick();
    const label = page.getByTestId("inspector-field-label");
    await expect(label).toBeFocused();
    await page.keyboard.press("Enter");
    await page.getByTestId("present-toggle").click();
    await expect(page.getByTestId("present-exit")).toBeVisible();
    await page.getByTestId("present-exit").click();
    await expect(label).toBeVisible();
    await waitForStableViewport(page);
    await expect(label).not.toBeFocused();
  });

  test("@dev StrictMode preserves a collapsed inspector's creation transaction", async ({ page }) => {
    await page.getByTestId("node-c").click();
    await page.getByTestId("inspector-toggle").click();
    await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
    await page.getByTestId("node-c").click();
    await page.keyboard.press("Alt+ArrowRight");
    await page.getByTestId("quick-add-search").fill("redis cache");
    await page.keyboard.press("Enter");
    const label = page.getByTestId("inspector-field-label");
    await expect(label).toBeFocused();
    await page.clock.install();
    await pauseClock(page);
    await page.clock.runFor(3000);
    await page.keyboard.type("Session store");
    await page.keyboard.press("Enter");
    await page.clock.runFor(400);
    await page.keyboard.press(`${MOD}+z`);
    await expect(nodes(page).filter({ hasText: "Session store" })).toHaveCount(0);
    await expect(nodes(page).filter({ hasText: "Redis Cache" })).toHaveCount(0);
  });

  test("double-clicking the boundary outline opens its name", async ({ page }) => {
    const boundary = page.getByTestId("group-outline-core");
    await boundary.dblclick({ position: { x: 3, y: 40 } });
    const label = page.getByTestId("inspector-field-label");
    await expect(label).toBeFocused();
    await expect.poll(() => selected(label)).toBe("Core platform");
  });

  test("F2 and Enter open the selection's Label the same way; Esc goes back to the canvas", async ({
    page,
    consoleErrors,
  }) => {
    const label = page.getByTestId("inspector-field-label");
    await page.getByTestId("node-c").click();
    await page.keyboard.press("F2");
    await expect(label).toBeFocused();
    await expect.poll(() => selected(label)).toBe("Worker");
    await page.keyboard.type("Queue worker");
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("inspector-field-sublabel")).toBeFocused();
    await page.keyboard.type("jobs.v1");
    const mark = await interactionJournalMark(page);
    await page.keyboard.press("Escape");
    await expect.poll(() => canvasFocused(page)).toBe(true);
    await waitForInteractionIdle(page);
    expect(await interactionLog(page, mark)).toContain("naming.done -> focus:item:c@now");
    expect(await interactionLog(page, mark)).toContain("focused: focus:item:c@now");
    await expect(page.getByTestId("node-c")).toContainText("Queue worker");
    await expect(page.getByTestId("node-c")).toContainText("jobs.v1");
    // Focus is on the node again: Enter renames it once more.
    await page.keyboard.press("Enter");
    await expect(label).toBeFocused();
    await expect.poll(() => selected(label)).toBe("Queue worker");
    await page.keyboard.press("Enter");
    await expect.poll(() => canvasFocused(page)).toBe(true);
    expectNoErrors(consoleErrors);
  });

  test("quick-add names the new node in the inspector, and the node and its name are one undo step", async ({
    page,
    consoleErrors,
  }) => {
    const pane = page.getByTestId("canvas-wrap");
    const r = must(await pane.boundingBox(), "the canvas");
    await page.mouse.dblclick(r.x + 120, r.y + r.height - 120);
    await expect(page.getByTestId("quick-add")).toBeVisible();
    await page.keyboard.type("redis cache");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("quick-add")).toHaveCount(0);
    const label = page.getByTestId("inspector-field-label");
    await expect(label).toBeFocused();
    await expect.poll(() => selected(label)).toBe("Redis Cache");
    await page.keyboard.type("Session store");
    await page.keyboard.press("Enter");
    await expect.poll(() => canvasFocused(page)).toBe(true);
    const made = nodes(page).filter({ hasText: "Session store" });
    await expect(made).toHaveCount(1);
    await page.keyboard.press(`${MOD}+z`);
    await expect(nodes(page).filter({ hasText: "Redis Cache" })).toHaveCount(0);
    await expect(made).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("keys typed straight after a quick-add pick name the node", async ({ page, consoleErrors }) => {
    const r = must(await page.getByTestId("canvas-wrap").boundingBox(), "the canvas");
    await page.mouse.dblclick(r.x + 120, r.y + r.height - 120);
    await expect(page.getByTestId("quick-add")).toBeVisible();
    await expect(page.getByTestId("quick-add-search")).toBeFocused();
    await page.keyboard.type("redis cache");
    await expect(page.getByTestId("quick-add-search")).toHaveValue("redis cache");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Hot keys", { delay: 0 });
    const label = page.getByTestId("inspector-field-label");
    await expect(label).toBeFocused();
    await expect(label).toHaveValue("Hot keys");
    await page.keyboard.press("Enter");
    await expect(nodes(page).filter({ hasText: "Hot keys" })).toHaveCount(1);
    expectNoErrors(consoleErrors);
  });

  test("an explicitly cleared type-ahead name stays empty when its field opens", async ({ page }) => {
    const r = must(await page.getByTestId("canvas-wrap").boundingBox(), "the canvas");
    await page.mouse.dblclick(r.x + 120, r.y + r.height - 120);
    await page.getByTestId("quick-add-search").fill("redis cache");
    await page.clock.install();
    await pauseClock(page);
    // Hold the frame that measures the new card: Backspace arrives in the type-ahead buffer,
    // before the inspector can focus its field. It explicitly replaces the selected default name.
    await page.keyboard.press("Enter");
    await page.keyboard.press("Backspace");
    const label = page.getByTestId("inspector-field-label");
    await expect(label).not.toBeFocused();
    await page.clock.runFor(1000);
    await expect(label).toBeFocused();
    await expect(label).toHaveValue("");
    expect(await label.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 0]);
    await page.keyboard.type("Session store");
    await expect(label).toHaveValue("Session store");
    await page.keyboard.press("Enter");
    await page.keyboard.press(`${MOD}+z`);
    await expect(nodes(page).filter({ hasText: "Session store" })).toHaveCount(0);
  });

  for (const connected of [false, true]) {
    test(`shape quick-add preserves typing before focus and names in its creation undo step (${connected ? "connected" : "canvas"})`, async ({
      page,
    }) => {
      if (connected) {
        await page.getByTestId("node-c").click();
        await page.keyboard.press("Alt+ArrowRight");
      } else {
        const r = must(await page.getByTestId("canvas-wrap").boundingBox(), "the canvas");
        await page.mouse.dblclick(r.x + 120, r.y + r.height - 120);
      }
      await page.getByTestId("quick-add-search").fill("triangle");
      await page.clock.install();
      await pauseClock(page);
      await page.keyboard.press("Enter");
      await page.keyboard.type("Invoice ", { delay: 0 });
      const field = page.getByTestId("annotation-editor");
      await expect(field).toHaveCount(0);
      await page.clock.runFor(1000);
      await expect(field).toBeFocused();
      await expect(field).toHaveValue("Invoice ");
      expect(await field.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([8, 8]);
      // The creation debounce has long elapsed; naming still belongs to that same undo step.
      await page.clock.runFor(3000);
      await page.keyboard.type("approved");
      await expect(field).toHaveValue("Invoice approved");
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("annotation-text-shape-1")).toHaveText("Invoice approved");
      await page.keyboard.press(`${MOD}+z`);
      await expect(page.getByTestId("annotation-shape-1")).toHaveCount(0);
      await page.keyboard.press(`${MOD}+Shift+z`);
      await expect(page.getByTestId("annotation-text-shape-1")).toHaveText("Invoice approved");
    });
  }

  test("click-away separates successive renames", async ({ page }) => {
    await page.getByTestId("node-c").dblclick();
    const label = page.getByTestId("inspector-field-label");
    await expect(label).toBeFocused();
    await page.keyboard.type("First name");
    // Focus a non-name field without editing it: no intervening document edit splits the undo step.
    await page.getByTestId("inspector-field-stencil").focus();
    await expect(label).not.toBeFocused();
    // Let blur's frame finish, using frames rather than a real-time delay.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await page.getByTestId("node-c").dblclick();
    await expect(label).toBeFocused();
    await expect.poll(() => selected(label)).toBe("First name");
    await page.keyboard.type("Second name");
    await page.keyboard.press("Enter");
    await page.keyboard.press(`${MOD}+z`);
    await expect(label).toHaveValue("First name");
    await page.keyboard.press(`${MOD}+z`);
    await expect(label).toHaveValue("Worker");
  });

  test("folding during naming closes its creation transaction", async ({ page }) => {
    await page.getByTestId("node-c").click();
    await page.keyboard.press("Alt+ArrowRight");
    await page.getByTestId("quick-add-search").fill("redis cache");
    await page.keyboard.press("Enter");
    const label = page.getByTestId("inspector-field-label");
    await expect(label).toBeFocused();
    await expect(page.getByTestId("inspector-field-connection")).toBeVisible();
    await page.keyboard.type("First name");
    // Activate the fold without moving focus to its button: isolate removal of the focused field,
    // rather than letting the button's pointer-focus blur close the transaction first.
    await page.getByTestId("inspector-toggle").evaluate((el: HTMLButtonElement) => el.click());
    await expect(label).toHaveCount(0);
    await page.getByTestId("inspector-toggle").click();
    await expect(label).toBeVisible();
    await expect(page.getByTestId("inspector-field-connection")).toHaveCount(0);
    await label.focus();
    await label.fill("Second name");
    await page.keyboard.press("Enter");
    await page.keyboard.press(`${MOD}+z`);
    await expect(label).toHaveValue("First name");
    await page.keyboard.press(`${MOD}+z`);
    await expect(nodes(page).filter({ hasText: "First name" })).toHaveCount(0);
    await expect(nodes(page).filter({ hasText: "Redis Cache" })).toHaveCount(0);
  });

  test("slow naming is one undo step; completing a rename separates the next one", async ({ page }) => {
    await page.getByTestId("node-c").dblclick();
    const label = page.getByTestId("inspector-field-label");
    await expect(label).toBeFocused();
    await page.clock.install();
    await pauseClock(page);
    await page.keyboard.type("Queue");
    await page.clock.runFor(3000);
    await page.keyboard.type(" worker");
    await page.keyboard.press("Enter");
    await page.clock.runFor(20);
    await page.keyboard.press("F2");
    await expect.poll(() => selected(label)).toBe("Queue worker");
    await page.keyboard.type("Next name");
    await page.keyboard.press("Enter");
    await page.clock.runFor(20);
    await page.keyboard.press(`${MOD}+z`);
    await expect(label).toHaveValue("Queue worker");
    await page.keyboard.press(`${MOD}+z`);
    await expect(label).toHaveValue("Worker");
  });

  test("Rename in the context menu and Ctrl+K selects the whole name", async ({ page }) => {
    const label = page.getByTestId("inspector-field-label");
    await page.getByTestId("node-c").click({ button: "right" });
    await page.getByTestId("context-menu-item-node.rename").click();
    await expect(label).toBeFocused();
    await expect.poll(() => selected(label)).toBe("Worker");
    await page.keyboard.press("Escape");
    await page.keyboard.press(`${MOD}+k`);
    await page.getByTestId("command-input").fill("rename");
    await page.getByTestId("command-item-action:node.rename").click();
    await expect(label).toBeFocused();
    await expect.poll(() => selected(label)).toBe("Worker");
  });

  test("Ctrl+K Rename selects all even when the name field already held focus", async ({ page }) => {
    await page.getByTestId("node-c").dblclick();
    const label = page.getByTestId("inspector-field-label");
    await expect(label).toBeFocused();
    await label.press(TEXT_END);
    await page.keyboard.press(`${MOD}+k`);
    await page.getByTestId("command-input").fill("rename");
    await page.getByTestId("command-item-action:node.rename").click();
    await expect(label).toBeFocused();
    await expect.poll(() => selected(label)).toBe("Worker");
    await page.keyboard.type("Replacement");
    await expect(label).toHaveValue("Replacement");
  });

  test("a note's text is still edited in place, all of it selected", async ({ page, consoleErrors }) => {
    await page.getByTestId("annotation-n1").dblclick();
    const editor = page.getByTestId("annotation-editor");
    await expect(editor).toBeFocused();
    await expect.poll(() => selected(editor)).toBe("Sticky reminder\nSecond line here");
    await expectNativeSelection(editor, "Sticky", "Sticky reminder");
    // The triple-click took the paragraph, its line break too (as a textarea does).
    await page.keyboard.type("First line");
    await expect(editor).toHaveValue(/^First line\n?Second line here$/);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("annotation-text-n1")).toContainText("First line");
    expectNoErrors(consoleErrors);
  });

  for (const c of [
    { id: "node-a", name: "Order service", action: "node.rename" },
    { id: "group-label-core", name: "Core platform", action: "group.rename" },
    { id: "edge-label-ab", name: "writes", action: "edge.edit-label" },
    { id: "group-outline-core", name: "Core platform", action: "group.rename", position: { x: 3, y: 40 } },
  ]) {
    test(`live double-click opens and renames ${c.id} from a collapsed inspector`, async ({ page, consoleErrors }) => {
      await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1`);
      await waitForStableViewport(page);
      await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
      await page.getByTestId(c.id).dblclick({ position: c.position });
      const label = page.getByTestId("inspector-field-label");
      await expect(page.getByTestId("inspector")).not.toHaveAttribute("data-collapsed", "1");
      await expect(label).toBeFocused();
      await expect.poll(() => selected(label)).toBe(c.name);
      await page.keyboard.type("Live name");
      await expect(label).toHaveValue("Live name");
      const shown = c.id === "group-outline-core" ? "group-label-core" : c.id;
      await expect(page.getByTestId(shown)).toContainText("Live name");
      await page.keyboard.press("Enter");
      await expect.poll(() => canvasFocused(page)).toBe(true);
      await expect(page.getByTestId("live-controls")).toBeVisible();
      await expect(page.getByTestId("smart-guides")).toHaveCount(0);
      await expect(page.getByTestId("quick-add")).toHaveCount(0);
      expectNoErrors(consoleErrors);
    });

    if (c.position) continue;
    test(`live keyboard and menu naming select all of ${c.id}`, async ({ page, consoleErrors }) => {
      await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1`);
      await waitForStableViewport(page);
      const label = page.getByTestId("inspector-field-label");
      // A single click on a live connection can trace a passing message. Establish the selection
      // through its property sheet, then finish naming before testing the canvas shortcuts.
      await page.getByTestId(c.id).dblclick();
      await expect(label).toBeFocused();
      await page.keyboard.press("Enter");
      await expect.poll(() => canvasFocused(page)).toBe(true);
      for (const key of ["F2", "Enter"]) {
        await page.keyboard.press(key);
        await expect(label).toBeFocused();
        await expect.poll(() => selected(label)).toBe(c.name);
        await page.keyboard.press("Escape");
        await expect.poll(() => canvasFocused(page)).toBe(true);
      }
      await waitForStableViewport(page);
      await page.getByTestId(c.id).click({ button: "right" });
      await page.getByTestId(`context-menu-item-${c.action}`).click();
      await expect(label).toBeFocused();
      await expect.poll(() => selected(label)).toBe(c.name);
      await page.keyboard.press("Escape");
      await page.keyboard.press(`${MOD}+k`);
      await page.getByTestId("command-input").fill(c.action === "edge.edit-label" ? "edit label" : "rename");
      await page.getByTestId(`command-item-action:${c.action}`).click();
      await expect(label).toBeFocused();
      await expect.poll(() => selected(label)).toBe(c.name);
      expectNoErrors(consoleErrors);
    });
  }

  test("Live keeps annotation editing inert and its existing canvas quick-add", async ({ page }) => {
    await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1`);
    await waitForStableViewport(page);
    await page.getByTestId("annotation-n1").dblclick();
    await page.keyboard.press("F2");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("annotation-editor")).toHaveCount(0);
    await expect(page.getByTestId("inspector-field-label")).toHaveCount(0);
    const r = must(await page.getByTestId("canvas-wrap").boundingBox(), "the canvas");
    await page.mouse.dblclick(r.x + 120, r.y + r.height - 120);
    await expect(page.getByTestId("quick-add")).toBeVisible();
    await expect(page.getByTestId("smart-guides")).toHaveCount(0);
  });

  for (const panel of ["capacity", "sims"] as const) {
    test(`live naming makes room for the inspector when ${panel} is open`, async ({ page, consoleErrors }) => {
      await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1`);
      if (panel === "capacity") await page.getByTestId("live-capacity").click();
      else {
        await page.getByTestId("live-more").click();
        await page.getByTestId("live-edit-sims").click();
      }
      const sidePanel = page.getByTestId(panel === "capacity" ? "capacity-panel" : "sim-panel");
      await expect(sidePanel).toBeVisible();
      await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
      await waitForStableViewport(page);
      await page.getByTestId("node-a").dblclick();
      const label = page.getByTestId("inspector-field-label");
      await expect(sidePanel).toHaveCount(0);
      await expect(label).toBeFocused();
      await expect.poll(() => selected(label)).toBe("Order service");
      await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
      expectNoErrors(consoleErrors);
    });
  }

  test("live inspector naming preserves an unsaved simulation draft", async ({ page, consoleErrors }) => {
    await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1`);
    await page.getByTestId("live-more").click();
    await page.getByTestId("live-edit-sims").click();
    await page.getByTestId("sim-panel-new").click();
    await page.getByTestId("sim-panel-title").fill("Unsaved run");
    await expect(page.getByTestId("sim-panel-dirty")).toBeVisible();
    await waitForStableViewport(page);
    await page.getByTestId("node-a").dblclick();
    await expect(page.getByTestId("inspector-field-label")).toBeFocused();
    await expect(page.getByTestId("sim-panel")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await page.getByTestId("live-more").click();
    await page.getByTestId("live-edit-sims").click();
    await expect(page.getByTestId("sim-panel-title")).toHaveValue("Unsaved run");
    await expect(page.getByTestId("sim-panel-dirty")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("live double-click on an edge label over a passing message renames it and traces nothing", async ({
    page,
    consoleErrors,
  }) => {
    // The label pill sits above the particle layer: its clicks are the label's, never a particle's behind it (the
    // trace card that opened intercepted the next right-click).
    await page.clock.install();
    await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1`);
    await waitForStableViewport(page);
    const pill = page.getByTestId("edge-label-ab");
    // Hold the frame still with a message's dot behind the pill.
    let at: { x: number; y: number } | null = null;
    for (let step = 0; step < 300 && !at; step++) {
      await pauseClock(page);
      const box = await pill.boundingBox();
      if (!box) throw new Error("edge-label-ab has no box");
      at = await page.evaluate(async (rect) => {
        const probe = window.__liveProbe;
        if (!probe) return null;
        // A dot behind a pill is drawn dimmed on the overlay, above it: its brightest pixel is its centre.
        const px = await probe("over", rect);
        let best = -1;
        let alpha = 0;
        for (let i = 3; i < px.data.length; i += 4)
          if (px.data[i] > alpha) {
            alpha = px.data[i];
            best = (i - 3) / 4;
          }
        if (best < 0) return null;
        const x = px.x + (best % px.width) / px.scale;
        const y = px.y + Math.floor(best / px.width) / px.scale;
        return document.elementFromPoint(x, y)?.closest('[data-testid="edge-label-ab"]') ? { x, y } : null;
      }, box);
      if (!at) await page.clock.runFor(40);
    }
    if (!at) throw new Error("no message passed under the edge label");
    await page.mouse.dblclick(at.x, at.y);
    await expect(page.getByTestId("inspector-field-label")).toBeFocused();
    await expect(page.getByTestId("trace-card")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("presenting live and read-only embeds open no editor on a double-click", async ({ page }) => {
    test.slow(); // Seeded canvas, live session and a second cold embed navigation.
    await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1`);
    await page.getByTestId("present-toggle").click();
    await expect(page.getByTestId("present-exit")).toBeVisible();
    await page.getByTestId("node-a").dblclick();
    await page.getByTestId("group-label-core").dblclick();
    await page.getByTestId("edge-label-ab").dblclick();
    await page.getByTestId("annotation-n1").dblclick();
    await page.keyboard.press("F2");
    await expect(page.getByTestId("annotation-editor")).toHaveCount(0);
    await expect(page.getByTestId("inspector-field-label")).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement,
      ),
    ).toBe(false);

    await gotoLive(page, `./?embed=1&example=${SLUG}&live=1`);
    await waitForStableViewport(page);
    for (const id of ["node-payments", "group-label-aks"]) {
      await page.getByTestId(id).dblclick();
      await page.keyboard.press("F2");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("inspector-field-label")).toHaveCount(0);
      await expect(page.getByTestId("annotation-editor")).toHaveCount(0);
      await expect(page.getByTestId("node-editor")).toHaveCount(0);
    }
    await page
      .getByTestId(/^edge-label-/)
      .first()
      .dblclick();
    await expect(page.getByTestId("inspector-field-label")).toHaveCount(0);
  });
});

test.describe("selecting text with the mouse", () => {
  test.beforeEach(async ({ page }) => seed(page));

  test("in the inspector: a word, then the whole field; typing replaces it", async ({ page, consoleErrors }) => {
    await page.getByTestId("node-a").dblclick();
    const label = page.getByTestId("inspector-field-label");
    await expectNativeSelection(label, "Order", "Order service");
    await page.keyboard.type("Billing");
    await expect(label).toHaveValue("Billing");
    await expect(page.getByTestId("node-a")).toContainText("Billing");

    // The diagram's description, a textarea: the triple-click takes its line.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    // Populated Markdown starts in Preview; click it to open the textarea for native selection.
    await page.getByTestId("inspector-field-description-rendered").click();
    const description = page.getByTestId("inspector-field-description");
    await expect(description).toBeVisible();
    await expectNativeSelection(description, "Platform", "Platform overview");
    expectNoErrors(consoleErrors);
  });

  test("in a dialog's rename field", async ({ page }) => {
    await page.getByTestId("import-input").setInputFiles({
      name: "fields.diagram.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(SEED)),
    });
    await expect(page.getByTestId("diagram-title")).toHaveText("Fields");
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-library").click();
    await expect(page.getByTestId("library-dialog")).toBeVisible();
    await page
      .getByTestId(/^library-rename-/)
      .first()
      .click();
    const field = page.getByTestId("library-rename-input");
    await field.fill("Platform overview");
    await expectNativeSelection(field, "Platform", "Platform overview");
    await expectVisibleSelection(field);
  });

  test("in search fields and the AI panel's request", async ({ page, consoleErrors }) => {
    // Quick-add's search, on the canvas.
    const r = must(await page.getByTestId("canvas-wrap").boundingBox(), "the canvas");
    await page.mouse.dblclick(r.x + 120, r.y + r.height - 120);
    const quick = page.getByTestId("quick-add-search");
    await expect(quick).toBeFocused();
    await page.keyboard.type("redis cache");
    await expectNativeSelection(quick, "redis", "redis cache");
    // Esc clears the search, then closes.
    await page.keyboard.press("Escape");
    await expect(quick).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("quick-add")).toHaveCount(0);

    // Ctrl+K.
    await page.keyboard.press(`${MOD}+k`);
    const command = page.getByTestId("command-input");
    await expect(command).toBeFocused();
    await page.keyboard.type("zoom to fit");
    await expectNativeSelection(command, "zoom", "zoom to fit");
    await page.keyboard.type("undo");
    await expect(command).toHaveValue("undo");
    await page.keyboard.press("Escape");

    // The stencil rail's search.
    const stencils = page.getByTestId("palette-search");
    if (!(await stencils.isVisible())) await page.getByTestId("palette-toggle").click();
    await expect(stencils).toBeVisible();
    await stencils.fill("service bus");
    await expectNativeSelection(stencils, "service", "service bus");

    // The AI panel's request (Advanced).
    await openAdvanced(page);
    const request = page.getByTestId("ai-request");
    await request.fill("Explain the payments flow");
    // Deterministically exercise the late panel layout change seen on a cold browser.
    await request.evaluate((el) => {
      el.addEventListener("dblclick", () => ((el as HTMLElement).style.marginTop = "48px"), { once: true });
    });
    await expectNativeSelection(request, "Explain", "Explain the payments flow");
    expectNoErrors(consoleErrors);
  });
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`selected text is visible (${colorScheme})`, () => {
    test.use({ colorScheme });
    test.beforeEach(async ({ page }) => seed(page));

    test("on the canvas, in the inspector and in Ctrl+K", async ({ page, consoleErrors }) => {
      // A note's editor on the canvas (where the drawing's own text never shows a selection).
      await page.getByTestId("annotation-n1").dblclick();
      await expectVisibleSelection(page.getByTestId("annotation-editor"));
      await page.keyboard.press("Escape");
      // The inspector's Label, opened by a double-click on a boundary (the owner's report).
      await fitDiagram(page);
      await page.getByTestId("group-label-core").dblclick();
      await expectVisibleSelection(page.getByTestId("inspector-field-label"));
      await page.keyboard.press("Escape");
      // Ctrl+K's search.
      await page.keyboard.press(`${MOD}+k`);
      const command = page.getByTestId("command-input");
      await page.keyboard.type("fit view");
      await expectVisibleSelection(command);
      expectNoErrors(consoleErrors);
    });
  });
}
