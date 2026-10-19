import { currentDiagram } from "./fixtures";
import { waitForSelectionSettled } from "./fixtures";
import { openExample } from "./fixtures";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, publicExamples, expectNoErrors, pauseClock, STORAGE_KEYS } from "./fixtures";

// Your diagrams (the local library) and data safety: edits are never lost to navigation, every
// diagram you open or start gets its own entry, and the old single slot is upgraded in place.

const diagram = (title: string, nodes = 1) => ({
  format: "diagrams/v1",
  title,
  nodes: Array.from({ length: nodes }, (_, i) => ({
    id: `n${i}`,
    stencil: "generic.service",
    label: `Node ${i}`,
    x: 40 + i * 320,
    y: 160,
  })),
  edges: [],
});

async function importDiagram(page: Page, title: string, nodes = 1) {
  await page.getByTestId("import-input").setInputFiles({
    name: `${title}.diagram.json`,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(diagram(title, nodes))),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText(title);
  return currentDiagram(page);
}

async function openLibrary(page: Page) {
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-library").click();
  await expect(page.getByTestId("library-dialog")).toBeVisible();
}

test.describe("data safety", () => {
  test("an edit survives switching diagram immediately and back", async ({ page }) => {
    const [a, b] = publicExamples;
    const node = a.nodeIds[0];
    // Every timer is fake and paused after the edit: only the switch itself can save it.
    await page.clock.install();
    await gotoCanvas(page, a.slug);
    await page.getByTestId(`node-${node}`).click();
    await waitForSelectionSettled(page);
    await pauseClock(page);
    await page.getByTestId("inspector-field-label").fill("Edited just now");
    await expect(page.getByTestId(`node-${node}`)).toContainText("Edited just now");
    await openExample(page, b.slug);
    await expect(page.getByTestId("diagram-title")).toHaveText(b.title);
    await page.getByTestId("example-picker").click();
    const copy = (await page.getByTestId(/^picker-option-my-.*(?<!-title)$/).getAttribute("data-testid"))?.slice(
      "picker-option-".length,
    );
    if (!copy) throw new Error("The switch did not keep a copy");
    await page.keyboard.press("Escape");
    await openExample(page, copy);
    await expect(page.getByTestId(`node-${node}`)).toContainText("Edited just now");
    await expect(page.getByTestId("reset-diagram")).toHaveCount(0);
  });

  test('your own diagrams don\'t offer "Edited, reset": the edits are the diagram', async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    await importDiagram(page, "Mine");
    await page.getByTestId("node-n0").click();
    await page.getByTestId("inspector-field-label").fill("Renamed");
    await expect(page.getByTestId("node-n0")).toContainText("Renamed");
    await expect(page.getByTestId("reset-diagram")).toHaveCount(0);
  });

  test("hiding the page saves pending edits (reload, close, tab switch)", async ({ page }) => {
    await page.clock.install();
    await gotoCanvas(page, publicExamples[0].slug);
    // An example's first edit can save immediately when it becomes an owned copy. Start with an owned
    // document so this edit must stay pending until pagehide/visibilitychange flushes it.
    await importDiagram(page, "Page lifecycle");
    const node = "n0";
    await page.getByTestId(`node-${node}`).click();
    await expect(page.getByTestId("inspector-field-label")).toBeVisible();
    await pauseClock(page);
    await page.getByTestId("inspector-field-label").fill("Before pagehide");
    const saved = async () =>
      page.evaluate(
        (key) => localStorage.getItem(key) ?? "",
        `${STORAGE_KEYS.autosavePrefix}${await currentDiagram(page)}`,
      );
    expect(await saved()).not.toContain("Before pagehide");
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    expect(await saved()).toContain("Before pagehide");

    await page.getByTestId("inspector-field-label").fill("Before hidden");
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await saved()).toContain("Before hidden");
  });
});

test.describe("Your diagrams", () => {
  test("Open and Import add diagrams instead of replacing; the picker lists yours first", async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const a = await importDiagram(page, "Alpha");
    const b = await importDiagram(page, "Beta", 3);
    expect(a).not.toBe(b);
    await page.getByTestId("example-picker").click();
    await expect(page.getByTestId("diagram-menu").getByTestId(/^picker-option-.*(?<!-title)$/)).toHaveText([
      "Beta",
      "Alpha",
    ]);
    await expect(page.getByTestId(`picker-option-${publicExamples[0].slug}`)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await openExample(page, a);
    await expect(page.getByTestId("diagram-title")).toHaveText("Alpha");

    await openLibrary(page);
    await expect(page.getByTestId(`library-title-${a}`)).toHaveText("Alpha");
    await expect(page.getByTestId(`library-item-${b}`)).toContainText("3 nodes");
    await expect(page.getByTestId(`library-open-${a}`)).toHaveAttribute("aria-current", "true");
    await page.getByTestId(`library-open-${b}`).click();
    await expect(page.getByTestId("library-dialog")).toHaveCount(0);
    await expect(page.getByTestId("diagram-title")).toHaveText("Beta");
    expectNoErrors(consoleErrors);
  });

  test("rename, duplicate and delete (with Undo)", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const a = await importDiagram(page, "Alpha");
    const b = await importDiagram(page, "Beta");
    await openLibrary(page);

    // Rename a closed diagram in place (Esc cancels, Enter commits).
    await page.getByTestId(`library-rename-${a}`).click();
    await page.getByTestId("library-rename-input").fill("Nope");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("library-dialog")).toBeVisible();
    await expect(page.getByTestId(`library-title-${a}`)).toHaveText("Alpha");
    await page.getByTestId(`library-rename-${a}`).click();
    await page.getByTestId("library-rename-input").fill("Alpha renamed");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId(`library-title-${a}`)).toHaveText("Alpha renamed");

    // Renaming the open one is an undoable edit on the canvas.
    await page.getByTestId(`library-rename-${b}`).click();
    await page.getByTestId("library-rename-input").fill("Beta renamed");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("diagram-title")).toHaveText("Beta renamed");
    await expect(page.getByTestId(`library-title-${b}`)).toHaveText("Beta renamed");

    // Duplicate: a new entry, offered to open.
    await page.getByTestId(`library-duplicate-${a}`).click();
    await expect(page.getByTestId("toast")).toContainText("Duplicated");
    await expect(page.getByTestId(/^library-item-/)).toHaveCount(3);
    await page.getByTestId("duplicate-open").click();
    await expect(page.getByTestId("diagram-title")).toHaveText("Alpha renamed (copy)");
    const copy = await currentDiagram(page);
    expect([a, b]).not.toContain(copy);

    // Deleting the open diagram moves on to another one; Undo brings it back and reopens it.
    await openLibrary(page);
    await page.getByTestId(`library-delete-${copy}`).click();
    await expect(page.getByTestId(`library-item-${copy}`)).toHaveCount(0);
    await expect(page.getByTestId("example-picker")).not.toHaveAttribute("data-diagram-slug", copy);
    await page.getByTestId("library-dialog-close").click();
    await page.getByTestId("delete-undo").click();
    await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", copy);
    await expect(page.getByTestId("diagram-title")).toHaveText("Alpha renamed (copy)");

    // Everything persists across a reload.
    await page.reload();
    await openLibrary(page);
    await expect(page.getByTestId(/^library-item-/)).toHaveCount(3);
    await expect(page.getByTestId(`library-title-${a}`)).toHaveText("Alpha renamed");
  });

  test("the picker label follows title edits as you type", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    await importDiagram(page, "Alpha");
    // No timer runs: the label can't be waiting for the autosave.
    await page.clock.install();
    await pauseClock(page);
    await page.getByTestId("inspector-toggle").click();
    await page.getByTestId("inspector-field-title").fill("Alpha, retitled");
    await expect(page.getByTestId("example-picker")).toContainText("Alpha, retitled");
  });

  test("a recency refresh between pointer-down and pointer-up keeps the library action under the pointer", async ({
    page,
  }) => {
    await page.clock.install();
    await gotoCanvas(page, publicExamples[0].slug);
    const a = await importDiagram(page, "Alpha");
    const b = await importDiagram(page, "Beta");
    await openLibrary(page);
    await pauseClock(page);
    const duplicate = page.getByTestId(`library-duplicate-${a}`);
    await duplicate.hover();
    await page.mouse.down();
    // An autosave or another tab can move Alpha ahead of Beta after the hit test.
    await page.evaluate((slug) => {
      const key = `diagrams.library-entry.v1:${slug}`;
      const stored = localStorage.getItem(key);
      if (!stored) throw new Error("Expected the imported library entry");
      const entry = JSON.parse(stored);
      localStorage.setItem(key, JSON.stringify({ ...entry, title: "Alpha refreshed", updatedAt: Date.now() + 1 }));
      window.dispatchEvent(new StorageEvent("storage", { key }));
    }, a);
    await expect(page.getByTestId(`library-title-${a}`)).toHaveText("Alpha refreshed");
    await expect(page.getByTestId(/^library-title-/)).toHaveText(["Beta", "Alpha refreshed"]);
    await page.clock.runFor(2);
    await page.mouse.up();
    await expect(page.getByTestId("toast")).toContainText("Duplicated");
    await expect(page.getByTestId(/^library-item-/)).toHaveCount(3);
    await page.getByTestId("duplicate-open").click();
    await expect(page.getByTestId("diagram-title")).toHaveText("Alpha (copy)");
    expect([a, b]).not.toContain(await currentDiagram(page));
    await openLibrary(page);
    await expect(page.getByTestId(/^library-title-/)).toHaveText(["Alpha (copy)", "Alpha refreshed", "Beta"]);
  });

  test("the start card lists your recent diagrams first, with thumbnails", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const a = await importDiagram(page, "Alpha", 2);
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-new").click();
    await expect(page.getByTestId("start-card")).toBeVisible();
    await expect(page.getByTestId(`start-recent-${a}`)).toContainText("Alpha");
    await expect(page.getByTestId(`start-recent-${a}-thumb`)).toHaveAttribute("data-nodes", "2");
    // A blank draft is never kept, and isn't listed.
    await openLibrary(page);
    await expect(page.getByTestId(/^library-item-/)).toHaveCount(1);
  });

  test("the old single 'Your diagram' slot is upgraded in place on first load", async ({ page }) => {
    await page.addInitScript(
      ([key, autosave, d]) => {
        if (localStorage.getItem("diagrams.library.v1")) return;
        localStorage.setItem(key, JSON.stringify(d));
        localStorage.setItem(autosave, JSON.stringify({ ...d, title: "Legacy, edited" }));
      },
      [STORAGE_KEYS.imported, `${STORAGE_KEYS.autosavePrefix}imported`, diagram("Legacy", 2)] as const,
    );
    await page.goto("./?view=canvas&example=imported");
    await expect(page.getByTestId("diagram-title")).toHaveText("Legacy, edited");
    await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", "imported");
    await openLibrary(page);
    await expect(page.getByTestId("library-title-imported")).toHaveText("Legacy, edited");
    expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEYS.library)).toContain('"imported"');
  });

  test("a nearly full browser storage warns once and shows on the meter", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("filler", "x".repeat(4_300_000));
      } catch {
        // This browser's quota is smaller: the warning can't be provoked, and the test skips below.
      }
    });
    await gotoCanvas(page, publicExamples[0].slug);
    test.skip(!(await page.evaluate(() => !!localStorage.getItem("filler"))), "storage quota too small");
    await expect(page.getByTestId("toast")).toContainText("storage");
    await page.getByTestId("storage-warning-open").click();
    await expect(page.getByTestId("library-dialog")).toBeVisible();
    await expect(page.getByTestId("library-usage")).toContainText("almost full");
  });
});
