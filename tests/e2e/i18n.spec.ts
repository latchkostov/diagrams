import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors, pageLoadTimeout, waitForStableBox } from "./fixtures";

// Languages (docs/I18N.md, docs/DESIGN-REVIEW.md round 33): View ▸ Language… switches the converted areas at once and
// is remembered; the browser's language is the default; Arabic mirrors the chrome but not the diagram; the
// pseudo-locale (en-XA, e2e and dev builds) shows nothing cut off at 1280 × 800; Clear everything forgets the choice.
// The self-hosting switch (VITE_LOCALES) is checked in self-host.spec.ts and self-host-locked.spec.ts.
// Expected words are read from the catalogs, so a better translation never breaks a test.

const catalog = (code: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "src", "i18n", "locales", `${code}.json`), "utf8")) as Record<
    string,
    string
  >;
const de = catalog("de");
const SLUG = "kafka-order-pipeline";

/** The bare address: a blank canvas with the start card. */
async function gotoStart(page: Page) {
  await page.goto("./");
  await expect(page.getByTestId("start-card")).toBeVisible({ timeout: pageLoadTimeout() });
}

/** View ▸ Language…: the dialog (its code loads on first use). */
async function openLanguage(page: Page) {
  await page.getByTestId("view-button").click();
  await page.getByTestId("view-language").click();
  await expect(page.getByTestId("language-dialog")).toBeVisible();
}

/** Starts the page in a language, as a remembered choice would. */
const remember = (page: Page, code: string) =>
  page.addInitScript((c) => window.localStorage.setItem("diagrams.locale", c), code);

test.describe("choosing a language", () => {
  test("View ▸ Language… switches the converted areas at once, and a reload keeps it", async ({
    page,
    consoleErrors,
  }) => {
    await gotoStart(page);
    await expect(page.getByTestId("start-blank")).toHaveText("Start blank");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    await openLanguage(page);
    // English needs no notice; the browser's language comes first.
    await expect(page.getByTestId("language-machine")).toHaveCount(0);
    await expect(page.getByTestId("language-option-browser")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("language-option-de").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.getByTestId("language-option-de")).toHaveAttribute("aria-checked", "true");

    // The dialog itself switched, and says it's machine-translated, with a way to correct it.
    const dialog = page.getByTestId("language-dialog");
    await expect(dialog.getByRole("heading")).toHaveText(de["language.title"]);
    await expect(page.getByTestId("language-machine")).toBeVisible();
    const suggest = page.getByTestId("language-suggest");
    await expect(suggest).toHaveAttribute("href", /^https:\/\/github\.com\/latchkostov\/diagrams\/issues\/new\?/);
    await expect(suggest).toHaveAttribute("href", /German/);
    await page.getByTestId("language-done").click();
    await expect(dialog).toHaveCount(0);

    // The start card, the top bar and its menus, under the dialog all along.
    await expect(page.getByTestId("start-blank")).toHaveText(de["start.blank"]);
    await expect(page.getByTestId("start-card").getByRole("heading", { level: 2 })).toHaveText(de["start.title"]);
    await expect(page.getByTestId("view-canvas")).toHaveText(de["topbar.diagram"]);
    await page.getByTestId("file-button").click();
    await expect(page.getByTestId("file-new")).toContainText(de["file.new"]);
    await expect(page.getByTestId("file-open")).toContainText(de["file.open"]);
    await page.keyboard.press("Escape");
    await page.getByTestId("view-button").click();
    // The View menu's Language row keeps the English word too, the way back for someone who can't read German.
    await expect(page.getByTestId("view-language")).toContainText(de["view.language"]);
    await expect(page.getByTestId("view-language")).toContainText("Language");
    await page.keyboard.press("Escape");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.getByTestId("start-blank")).toHaveText(de["start.blank"], { timeout: pageLoadTimeout() });
    expectNoErrors(consoleErrors);
  });

  test("Ctrl+K finds Language… by the English word, from any language", async ({ page, consoleErrors }) => {
    await remember(page, "ja");
    await gotoStart(page);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.keyboard.type("language");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("language-dialog")).toBeVisible();
    // Back to the browser's language (English here).
    await page.getByTestId("language-option-browser").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.getByTestId("language-done").click();
    await expect(page.getByTestId("start-blank")).toHaveText("Start blank");
    expectNoErrors(consoleErrors);
  });

  test("Share…, the shortcuts sheet and the privacy dialogs speak it too", async ({ page, consoleErrors }) => {
    await remember(page, "de");
    await gotoCanvas(page, SLUG);
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-share").click();
    await expect(page.getByTestId("share-chooser").getByRole("heading")).toHaveText(de["share.title"]);
    await expect(page.getByTestId("share-option-file")).toContainText(de["share.file"]);
    await page.keyboard.press("Escape");

    await page.getByTestId("canvas-wrap").focus();
    await page.keyboard.press("?");
    await expect(page.getByTestId("shortcuts-dialog").getByRole("heading", { level: 2 })).toHaveText(
      de["shortcuts.title"],
    );
    await page.keyboard.press("Escape");

    await page.getByTestId("file-button").click();
    await page.getByTestId("file-privacy").click();
    await page.getByTestId("privacy-clear-device").click();
    await expect(page.getByTestId("clear-device-dialog").getByRole("heading")).toHaveText(de["clear.title"]);
    await expect(page.getByTestId("clear-device-cancel")).toHaveText(de["common.cancel"]);
    await page.getByTestId("clear-device-cancel").click();
    expectNoErrors(consoleErrors);
  });
});

test.describe("the browser's language is the default", () => {
  test.use({ locale: "bg-BG" });

  test("Bulgarian browser, Bulgarian app: no choice made, nothing stored", async ({ page, consoleErrors }) => {
    const bg = catalog("bg");
    await gotoStart(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "bg");
    await expect(page.getByTestId("start-blank")).toHaveText(bg["start.blank"]);
    expect(await page.evaluate(() => localStorage.getItem("diagrams.locale"))).toBeNull();
    await openLanguage(page);
    await expect(page.getByTestId("language-option-browser")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("language-option-browser")).toContainText("Български");
    expectNoErrors(consoleErrors);
  });
});

test.describe("the browser's language falls back", () => {
  test.use({ locale: "pt-AO" });

  test("Angolan Portuguese reads European Portuguese", async ({ page }) => {
    await gotoStart(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-PT");
  });
});

test.describe("right to left", () => {
  test("Arabic mirrors the chrome, not the diagram", async ({ page, consoleErrors }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const box = async (testId: string) => {
      const b = await page.getByTestId(testId).boundingBox();
      if (!b) throw new Error(`${testId} isn't shown`);
      return b;
    };
    /** Whether the gateway is left of the orders service (upstream first, as the diagram is drawn). */
    const order = async () => (await box("rf__node-gateway")).x < (await box("rf__node-orders")).x;
    await gotoCanvas(page, SLUG);
    const english = await order();

    await page.evaluate(() => localStorage.setItem("diagrams.locale", "ar"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });

    // The chrome: the brand on the right, the File and View buttons on the left.
    expect((await box("brand")).x).toBeGreaterThan((await box("topbar-actions")).x);
    // Menus open from the trigger's other edge, inside the window.
    await page.getByTestId("file-button").click();
    // After its opening animation (it pops in, scaled).
    await waitForStableBox(page.getByTestId("file-menu"));
    const menu = await box("file-menu");
    const button = await box("file-button");
    // Aligned with the button's left edge (kept 8 px inside the window).
    expect(Math.abs(menu.x - Math.max(8, button.x))).toBeLessThan(2);
    await page.keyboard.press("Escape");

    // The diagram: the same order, left to right, as in English.
    expect(english).toBe(true);
    expect(await order()).toBe(english);
    expect(await page.getByTestId("rf__wrapper").evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");
    expectNoErrors(consoleErrors);
  });
});

/**
 * Nothing in `root` is cut off: no box whose text is wider than it with its overflow hidden, and nothing reaching
 * past `root`'s sides. What's scrolled away vertically (a long menu) is fine.
 */
async function expectNothingCut(root: Locator, label: string) {
  const problems = await root.evaluate((rootEl) => {
    const out: string[] = [];
    const outer = rootEl.getBoundingClientRect();
    const name = (el: Element) =>
      `${(el as HTMLElement).dataset.testid ?? el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}"`;
    for (const el of [rootEl, ...rootEl.querySelectorAll("*")]) {
      // Not shown, or only to screen readers (sr-only: a 1 px box).
      if (!(el instanceof HTMLElement) || !el.getClientRects().length || el.clientWidth <= 1) continue;
      const style = getComputedStyle(el);
      const clips = style.overflowX === "hidden" || style.overflowX === "clip" || style.textOverflow === "ellipsis";
      if (clips && el.scrollWidth > el.clientWidth + 1 && (el.textContent ?? "").trim()) out.push(`cut: ${name(el)}`);
      const box = el.getBoundingClientRect();
      if (el !== rootEl && box.width > 0 && (box.right > outer.right + 1 || box.left < outer.left - 1))
        out.push(`past the edge: ${name(el)}`);
    }
    return out;
  });
  expect(problems, label).toEqual([]);
}

/** The menu rows' titles are all pseudo-localized (in brackets), but for names that stay as they are. */
async function expectAllTranslated(menu: Locator, label: string, except: string[] = []) {
  const titles = await menu
    .getByTestId(/./)
    .evaluateAll(
      (els, skip) =>
        els
          .filter(
            (el) =>
              el.getAttribute("role")?.startsWith("menuitem") && !skip.includes(el.getAttribute("data-testid") ?? ""),
          )
          .map((el) => `${el.getAttribute("data-testid")}: ${(el.textContent ?? "").trim()}`),
      except,
    );
  expect(titles.length, label).toBeGreaterThan(0);
  expect(
    titles.filter((t) => !t.includes("[")),
    label,
  ).toEqual([]);
}

test.describe("the pseudo-locale", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await remember(page, "en-XA");
  });

  test("the start card and the top bar's menus: translated, nothing cut off at 1280 × 800", async ({
    page,
    consoleErrors,
  }) => {
    await gotoStart(page);
    await expect(page.getByTestId("start-blank")).toContainText("[");
    await expectNothingCut(page.getByTestId("start-card"), "start card");
    await expectNothingCut(page.getByTestId("topbar"), "top bar");

    await page.getByTestId("view-button").click();
    await expectNothingCut(page.getByTestId("view-menu"), "View menu");
    // Capacity and Checks wait for their batches (docs/I18N.md).
    await expectAllTranslated(page.getByTestId("view-menu"), "View menu", ["view-checks", "capacity-overlay-toggle"]);
    await page.keyboard.press("Escape");

    await page.getByTestId("view-button").click();
    await page.getByTestId("view-language").click();
    await expect(page.getByTestId("language-dialog")).toBeVisible();
    await expectNothingCut(page.getByTestId("language-dialog"), "Language dialog");
    await page.getByTestId("language-done").click();
    expectNoErrors(consoleErrors);
  });

  test("the File menu, Share…, the shortcuts sheet and the privacy dialogs: nothing cut off", async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, SLUG);
    await page.getByTestId("file-button").click();
    const file = page.getByTestId("file-menu");
    await expectNothingCut(file, "File menu");
    await expectAllTranslated(file, "File menu");
    await page.getByTestId("file-more-formats").click();
    await expectNothingCut(page.getByTestId("file-more-formats-menu"), "Export as");
    await expectAllTranslated(page.getByTestId("file-more-formats-menu"), "Export as", ["export-drawio"]);
    await page.getByTestId("file-privacy").click();
    await expectNothingCut(page.getByTestId("file-privacy-menu"), "Privacy");
    await expectAllTranslated(page.getByTestId("file-privacy-menu"), "Privacy");
    await page.getByTestId("privacy-clear-device").click();
    await expectNothingCut(page.getByTestId("clear-device-dialog"), "Clear everything");
    await page.getByTestId("clear-device-cancel").click();

    await page.getByTestId("file-button").click();
    await page.getByTestId("file-share").click();
    await expect(page.getByTestId("share-chooser")).toBeVisible();
    await page.getByTestId("share-public-toggle").click();
    await expectNothingCut(page.getByTestId("share-chooser"), "Share…");
    await page.keyboard.press("Escape");

    await page.getByTestId("canvas-wrap").focus();
    await page.keyboard.press("?");
    await expect(page.getByTestId("shortcuts-dialog")).toBeVisible();
    await expectNothingCut(page.getByTestId("shortcuts-dialog"), "Keyboard shortcuts");
    await page.keyboard.press("Escape");

    await page.getByTestId("file-button").click();
    await page.getByTestId("file-privacy").click();
    await page.getByTestId("privacy-diagram").click();
    await page.getByTestId("private-badge").click();
    await expect(page.getByTestId("privacy-dialog")).toBeVisible();
    await expectNothingCut(page.getByTestId("privacy-dialog"), "Private diagram");
    await page.getByTestId("privacy-turn-off").click();
    expectNoErrors(consoleErrors);
  });
});

test("Clear everything forgets the language: the app comes back in the browser's", async ({ page, consoleErrors }) => {
  await gotoStart(page);
  await openLanguage(page);
  await page.getByTestId("language-option-de").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await page.getByTestId("language-done").click();

  await page.getByTestId("file-button").click();
  await page.getByTestId("file-privacy").click();
  await page.getByTestId("privacy-clear-device").click();
  // The list says the language goes too.
  await expect(page.getByTestId("clear-device-list")).toContainText(de["clear.settings"]);
  await page.getByTestId("clear-device-confirm").click();

  await expect(page.locator("html")).toHaveAttribute("lang", "en", { timeout: pageLoadTimeout() });
  await expect(page.getByTestId("start-blank")).toHaveText("Start blank", { timeout: pageLoadTimeout() });
  expect(await page.evaluate(() => localStorage.getItem("diagrams.locale"))).toBeNull();
  expectNoErrors(consoleErrors);
});
