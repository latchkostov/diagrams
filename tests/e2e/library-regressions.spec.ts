import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, publicExamples } from "./fixtures";

async function seed(page: Page, count = 2) {
  return page.evaluate(async (count) => {
    const url = "/src/lib/diagramIO.ts";
    const io = (await import(url)) as typeof import("../../src/lib/diagramIO");
    return Array.from({ length: count }, (_, i) => io.createDiagram({ title: `Diagram ${i}` }));
  }, count);
}

async function openLibrary(page: Page) {
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-library").click();
  await expect(page.getByTestId("library-dialog")).toBeVisible();
}

test("concurrent tabs publish independent index entries, including autosave, delete and undo", async ({
  page,
  context,
}) => {
  await gotoCanvas(page, publicExamples[0].slug);
  const other = await context.newPage();
  await gotoCanvas(other, publicExamples[0].slug);
  // Force both writers to see the same old shared-index snapshot. This deterministically
  // reproduces the read/read/write/write interleaving even on a single-core test runner.
  for (const tab of [page, other])
    await tab.evaluate(() => {
      const get = Storage.prototype.getItem;
      const snapshot = localStorage.getItem("diagrams.library.v1");
      Storage.prototype.getItem = function (key) {
        return key === "diagrams.library.v1" ? snapshot : get.call(this, key);
      };
      window.addEventListener(
        "library-test-release-index",
        () => {
          Storage.prototype.getItem = get;
        },
        { once: true },
      );
    });
  const [[a], [b]] = await Promise.all([seed(page, 1), seed(other, 1)]);
  for (const tab of [page, other])
    await tab.evaluate(() => window.dispatchEvent(new Event("library-test-release-index")));
  const created = await page.evaluate(async () => {
    const url = "/src/lib/diagramIO.ts";
    const io = (await import(url)) as typeof import("../../src/lib/diagramIO");
    return io.listLibrary().map((entry) => entry.slug);
  });
  expect(created.sort()).toEqual([a, b].sort());
  const titles = await page.evaluate(
    async ({ a, b }) => {
      const url = "/src/lib/diagramIO.ts";
      const io = (await import(url)) as typeof import("../../src/lib/diagramIO");
      const undo = io.deleteLibraryDiagram(a);
      const current = io.getCurrent(b);
      if (!current) throw new Error("Other tab's diagram was lost");
      io.writeAutosave(b, { ...current, title: "Other tab edited" });
      if (!undo()) throw new Error("Undo failed");
      return io.listLibrary().map((entry) => entry.slug);
    },
    { a, b },
  );
  expect(titles.sort()).toEqual([a, b].sort());
  for (const tab of [page, other]) {
    await expect(tab.getByTestId(`picker-option-${a}`)).toHaveCount(1);
    await expect(tab.getByTestId(`picker-option-${b}`)).toHaveText("Other tab edited");
  }
});

test("rename restores focus on Enter and Escape, while pointer blur preserves its destination", async ({ page }) => {
  await gotoCanvas(page, publicExamples[0].slug);
  const [a, b] = await seed(page);
  await openLibrary(page);
  await page.getByTestId(`library-open-${a}`).click();
  await openLibrary(page);
  await expect(page.getByTestId(`library-item-${a}`)).toContainText("Open now · 0 nodes · edited");
  const rename = page.getByTestId(`library-rename-${a}`);
  for (const key of ["Enter", "Escape"]) {
    await rename.click();
    await expect(page.getByTestId("library-rename-input")).toBeFocused();
    await page.getByTestId("library-rename-input").fill("Renamed via keyboard");
    await page.keyboard.press(key);
    await expect(rename).toBeFocused();
    await expect(page.getByTestId("library-rename-input")).toHaveCount(0);
  }
  await rename.click();
  await page.getByTestId(`library-rename-${b}`).click();
  await expect(page.getByTestId("library-rename-input")).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("library-dialog")).toHaveCount(0);
});

test("deletion focuses the next row and Undo is keyboard reachable inside the modal", async ({ page }) => {
  await gotoCanvas(page, publicExamples[0].slug);
  await seed(page);
  await openLibrary(page);
  const rows = page.getByTestId(/^library-item-/);
  const first = ((await rows.nth(0).getAttribute("data-testid")) ?? "").slice("library-item-".length);
  const next = ((await rows.nth(1).getAttribute("data-testid")) ?? "").slice("library-item-".length);
  await page.getByTestId(`library-delete-${first}`).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId(`library-open-${next}`)).toBeFocused();
  const undo = page.getByTestId("library-delete-undo");
  await expect(undo).toBeVisible();
  for (let i = 0; i < 12 && !(await undo.evaluate((el) => el === document.activeElement)); i++)
    await page.keyboard.press("Tab");
  await expect(undo).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId(`library-item-${first}`)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("library-dialog")).toHaveCount(0);
});

test("deletion Undo remains reachable inside the modal after the toast expires", async ({ page }) => {
  await page.clock.install();
  await gotoCanvas(page, publicExamples[0].slug);
  const [slug] = await seed(page, 1);
  await openLibrary(page);
  await page.getByTestId(`library-delete-${slug}`).click();
  const undo = page.getByTestId("library-delete-undo");
  await expect(undo).toBeVisible();
  await expect(page.getByTestId("library-new")).toBeFocused();
  await page.clock.fastForward(7000);
  await expect(undo).toBeVisible();
  for (let i = 0; i < 6 && !(await undo.evaluate((el) => el === document.activeElement)); i++)
    await page.keyboard.press("Tab");
  await expect(undo).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId(`library-item-${slug}`)).toBeVisible();
});

for (const action of ["delete", "duplicate"] as const)
  test(`${action} aborts on a failed flush and preserves unsaved edits`, async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const [slug] = await seed(page, 1);
    await page.getByTestId("example-picker").selectOption(slug);
    await expect(page.getByTestId("diagram-title")).toHaveText("Diagram 0");
    await openLibrary(page);
    await page.evaluate(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("diagrams.autosave.v1:")) throw new DOMException("full", "QuotaExceededError");
        return set.call(this, key, value);
      };
    });
    await page.getByTestId(`library-rename-${slug}`).click();
    await page.getByTestId("library-rename-input").fill("Unsaved edits");
    await page.keyboard.press("Enter");
    await page.getByTestId(`library-${action}-${slug}`).click();
    await expect(page.getByTestId("library-error")).toContainText("save");
    await expect(page.getByTestId(/^library-item-/)).toHaveCount(1);
    await expect(page.getByTestId("example-picker")).toHaveValue(slug);
    await expect(page.getByTestId("diagram-title")).toHaveText("Unsaved edits");
  });

test("autosaves refresh same-tab title, node count and palette after navigation", async ({ page }) => {
  await gotoCanvas(page, publicExamples[0].slug);
  const [a, b] = await seed(page);
  await expect(page.getByTestId(`picker-option-${a}`)).toHaveText("Diagram 0");
  await expect(page.getByTestId(`picker-option-${b}`)).toHaveText("Diagram 1");
  await page.evaluate(async (slug) => {
    const url = "/src/lib/diagramIO.ts";
    const io = (await import(url)) as typeof import("../../src/lib/diagramIO");
    const current = io.getCurrent(slug);
    if (!current) throw new Error("Missing seeded diagram");
    io.writeAutosave(slug, {
      ...current,
      title: "Fresh title",
      nodes: [{ id: "fresh", stencil: "generic.service", label: "Fresh", x: 0, y: 0 }],
    });
  }, a);
  await page.getByTestId("example-picker").selectOption(b);
  await expect(page.getByTestId(`picker-option-${a}`)).toHaveText("Fresh title");
  await page.keyboard.press("Control+k");
  await page.getByTestId("command-input").fill("Fresh title");
  await expect(page.getByTestId(`command-item-diagram:${a}`)).toHaveText(/Fresh title/);
  await page.keyboard.press("Escape");
  await openLibrary(page);
  await expect(page.getByTestId(`library-item-${a}`)).toContainText("1 node");
});

test("large libraries page thumbnail rows while keeping all diagrams reachable", async ({ page }) => {
  await gotoCanvas(page, publicExamples[0].slug);
  const slugs = await seed(page, 45);
  await openLibrary(page);
  await expect(page.getByTestId(/^library-item-/)).toHaveCount(20);
  await expect(page.getByTestId("library-page-status")).toHaveText("1–20 of 45");
  const rowSlugs = () =>
    page
      .getByTestId(/^library-item-/)
      .evaluateAll((rows) => rows.map((row) => (row.getAttribute("data-testid") ?? "").slice("library-item-".length)));
  const seen = await rowSlugs();
  await page.getByTestId("library-page-next").click();
  await expect(page.getByTestId(/^library-item-/)).toHaveCount(20);
  seen.push(...(await rowSlugs()));
  await page.getByTestId("library-page-next").click();
  await expect(page.getByTestId(/^library-item-/)).toHaveCount(5);
  await expect(page.getByTestId("library-page-status")).toHaveText("41–45 of 45");
  seen.push(...(await rowSlugs()));
  expect(seen.sort()).toEqual(slugs.sort());
  await page.getByTestId("library-page-prev").click();
  await expect(page.getByTestId("library-page-status")).toHaveText("21–40 of 45");
});
