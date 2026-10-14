import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors, pageLoadTimeout, waitForStableBox } from "./fixtures";
import en from "../../src/i18n/en";
import { parse, compile } from "../../src/i18n/icu";
import { helpersFor } from "../../src/i18n/helpers";
import { pseudoLocalize } from "../../src/i18n/pseudo";

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

// Each File dialog is checked independently, including its Options and password disclosures. Expectations come
// from the real ICU catalogs: they check reordered placeholders and counts as well as plain labels.
for (const code of ["de", "ar", "en-XA"]) {
  test.describe(`File dialogs in ${code}`, () => {
    test.use({ viewport: { width: 1280, height: 800 } });
    test.beforeEach(async ({ page }) => remember(page, code));
    const messages = code === "en-XA" ? en : catalog(code);
    const words = (key: keyof typeof en, values: Record<string, unknown> = {}) => {
      const parts = parse(messages[key]);
      const compiled = new Function("h", "return " + compile(code === "en-XA" ? pseudoLocalize(parts) : parts))(
        helpersFor(code === "en-XA" ? "en" : code),
      ) as string | ((values: Record<string, unknown>) => string);
      return typeof compiled === "string" ? compiled : compiled(values);
    };
    const check = async (page: Page, id: string, title: keyof typeof en, values: Record<string, unknown> = {}) => {
      await expect(page.getByTestId(`${id}-title`)).toHaveText(words(title, values));
      await expectNothingCut(page.getByTestId(id), `${code}: ${id}`);
      const box = await page.getByTestId(id).boundingBox();
      if (!box) throw new Error(`${id} has no box`);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(1280);
      expect(box.y + box.height).toBeLessThanOrEqual(800);
    };
    const file = async (page: Page, item: string, parent?: string) => {
      await page.getByTestId("file-button").click();
      if (parent) await page.getByTestId(parent).click();
      await page.getByTestId(item).click();
    };
    const share = async (page: Page, item: string, publicChoice = false) => {
      await file(page, "file-share");
      if (publicChoice) await page.getByTestId("share-public-toggle").click();
      await page.getByTestId(item).click();
    };

    test("paste, open a link, and the import report", async ({ page, consoleErrors }) => {
      await gotoCanvas(page, SLUG);
      await file(page, "import-paste", "file-import-from");
      await expect(page.getByTestId("paste-dialog")).toContainText(words("fileDialog.pasteADiagram"));
      await check(page, "paste-dialog", "fileDialog.pasteADiagram");
      await expect(page.getByTestId("paste-submit")).toContainText(words("fileDialog.import"));
      await expect(page.getByTestId("paste-format")).toHaveText(words("fileDialog.waitingForText"));
      await page.getByTestId("paste-cancel").click();
      await file(page, "import-share-link", "file-import-from");
      await check(page, "open-link-dialog", "fileDialog.openAShareLink");
      await expect(page.getByTestId("open-link-input")).toHaveAttribute("aria-label", words("fileDialog.shareLink"));
      await page.getByTestId("open-link-cancel").click();
      await file(page, "import-paste", "file-import-from");
      await page
        .getByTestId("paste-input")
        .fill(
          "name: i18n-fixture\nservices:\n  api:\n    image: example/unknown\n  redis:\n    image: redis:7\nvolumes:\n  data: {}\n",
        );
      await page.getByTestId("paste-submit").click();
      await page.getByTestId("toast-import-details").click();
      await check(page, "import-report", "importReport.importReport");
      await expect(page.getByTestId("import-report-summary")).toHaveText(
        words("importReport.drew", { nodes: 2, connections: 0, boundaries: 0 }),
      );
      await expect(page.getByTestId("import-report-not-drawn")).toContainText(words("importDetail.volume"));
      await expect(page.getByTestId("diagram-title")).toHaveText("i18n-fixture");
      await page.getByTestId("import-report-done").click();
      expectNoErrors(consoleErrors);
    });

    test("image and Interactive HTML, including Options and its password", async ({ page, consoleErrors }) => {
      await gotoCanvas(page, SLUG);
      await file(page, "export-image", "file-more-formats");
      await page.getByTestId("image-options-toggle").click();
      await check(page, "image-dialog", "fileDialog.exportImage");
      await expect(page.getByTestId("image-export")).toContainText(
        words("fileDialog.downloadFormat", { format: "PNG" }),
      );
      await page.getByTestId("image-cancel").click();
      await file(page, "export-html", "file-more-formats");
      await page.getByTestId("html-export-options-toggle").click();
      await page.getByTestId("html-export-password-toggle").check();
      await check(page, "html-export-dialog", "htmlExport.interactiveHTML");
      await expect(page.getByTestId("html-export-password-strength")).toHaveText(
        words("password.minimum", { count: 8 }),
      );
      await page.getByTestId("html-export-password-input").fill("password");
      await expect(page.getByTestId("html-export-password-strength")).toHaveText(
        words("password.easyToGuessTryFourOrMore"),
      );
      await expect(page.getByTestId("html-export-banner")).toHaveAttribute(
        "placeholder",
        words("htmlExport.egConfidentialInternalUseOnly"),
      );
      await page.getByTestId("html-export-cancel").click();
      expectNoErrors(consoleErrors);
    });

    test("share link, password link and unlock", async ({ page, consoleErrors }) => {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await gotoCanvas(page, SLUG);
      await share(page, "share-option-link", true);
      await check(page, "share-link-dialog", "fileDialog.shareLink");
      await expect(page.getByTestId("share-link-copy")).toContainText(words("fileDialog.copyLink"));
      await page.getByTestId("share-link-password").click();
      await check(page, "password-link-dialog", "passwordLink.linkWithPassword");
      await page.getByTestId("password-link-input").fill("river violet moon lantern");
      await expect(page.getByTestId("password-link-strength")).toHaveText(words("password.strong"));
      await page.getByTestId("password-link-copy").click();
      const url = await page.getByTestId("password-link-url").inputValue();
      await check(page, "password-link-dialog", "passwordLink.linkWithPassword");
      await page.getByTestId("password-link-done").click();
      await file(page, "import-share-link", "file-import-from");
      await page.getByTestId("open-link-input").fill(url);
      await page.getByTestId("open-link-submit").click();
      await check(page, "password-prompt", "passwordLink.thisDiagramIsPasswordprotected");
      await page.getByTestId("password-prompt-input").fill("wrong password");
      await page.getByTestId("password-prompt-submit").click();
      await expect(page.getByTestId("password-prompt-error")).toHaveText(words("passwordLink.wrongPassword"));
      await page.getByTestId("password-prompt-cancel").click();
      expectNoErrors(consoleErrors);
    });

    test("all three embed sources, their Options, and Your diagrams", async ({ page, consoleErrors }) => {
      await gotoCanvas(page, SLUG);
      await share(page, "share-option-embed-public", true);
      await check(page, "embed-dialog", "fileDialog.embedCode");
      await expect(page.getByTestId("embed-source-example")).toHaveText(words("embedDialog.exampleByName"));
      await page.getByTestId("embed-source-inline").click();
      await page.getByTestId("embed-options-toggle").click();
      await check(page, "embed-dialog", "fileDialog.embedCode");
      await page.getByTestId("embed-dialog-close").click();
      await share(page, "share-option-embed");
      await page.getByTestId("embed-options-toggle").click();
      await check(page, "embed-dialog", "fileDialog.embedCode");
      await expect(page.getByTestId("embed-host-format-component")).toHaveText(words("embedDialog.webComponent"));
      await page.getByTestId("embed-host-format-iframe").click();
      await expect(page.getByTestId("embed-host-format-iframe")).toHaveText("iframe + postMessage");
      await page.getByTestId("embed-dialog-close").click();
      await file(page, "file-library");
      await check(page, "library-dialog", "topbar.yourDiagrams");
      expectNoErrors(consoleErrors);
    });

    test("cloud Open from, Save to and Save prompts", async ({ page, consoleErrors }) => {
      await page.goto(`./?view=canvas&example=${SLUG}&storage=test`);
      await expect(page.getByTestId("canvas-view")).toBeVisible();
      await file(page, "open-from-test", "file-open-from");
      await check(page, "storage-files-dialog", "storageDialog.title", { provider: "Test storage" });
      await expect(page.getByTestId("storage-files-empty")).toHaveText(
        words("storageDialog.empty", { provider: "Test storage" }),
      );
      await page.getByTestId("storage-files-dialog-close").click();
      await file(page, "save-to-test", "file-save-to");
      await expect(page.getByTestId("toast")).toContainText(
        words("fileToast.savedToValue0AsValue1", { value0: "Test storage", value1: `${SLUG}.diagram.json` }),
      );
      await file(page, "file-save");
      await expect(page.getByTestId("toast")).toContainText(
        words("fileToast.savedToValue0AsValue1", { value0: "Test storage", value1: `${SLUG}.diagram.json` }),
      );
      expectNoErrors(consoleErrors);
    });

    test("native Open, draw.io pages, Save and Save as use localized descriptions", async ({ page, consoleErrors }) => {
      const drawio = readFileSync(
        join(process.cwd(), "src/interop/drawio/fixtures/two-pages-compressed.drawio"),
        "utf8",
      );
      await page.addInitScript((text) => {
        const state = { open: "", save: "", writes: 0 };
        Object.defineProperty(window, "__i18nNative", { value: state });
        const handle = (name: string) => ({
          kind: "file",
          name,
          getFile: async () => new File([text], name, { type: "application/xml" }),
          createWritable: async () => ({
            write: async () => {
              state.writes++;
            },
            close: async () => {},
          }),
        });
        Object.defineProperty(window, "showOpenFilePicker", {
          configurable: true,
          value: async (options: { types: { description: string }[] }) => {
            state.open = options.types[0].description;
            return [handle("pages.drawio")];
          },
        });
        Object.defineProperty(window, "showSaveFilePicker", {
          configurable: true,
          value: async (options: { types: { description: string }[] }) => {
            state.save = options.types[0].description;
            return handle("saved.diagram.json");
          },
        });
      }, drawio);
      const native = () =>
        page.evaluate(
          () => (window as Window & { __i18nNative: { open: string; save: string; writes: number } }).__i18nNative,
        );
      await gotoCanvas(page, SLUG);
      await file(page, "file-open");
      await check(page, "drawio-pages-dialog", "fileDialog.chooseAPage");
      expect((await native()).open).toBe(words("fileType.open"));
      await expect(page.getByTestId("drawio-pages-dialog")).toContainText(
        words("fileDialog.pagesSubtitle", { name: "pages.drawio", count: 2 }),
      );
      await page.getByTestId("drawio-pages-dialog-close").click();
      await file(page, "file-save");
      await expect.poll(async () => (await native()).writes).toBe(1);
      expect((await native()).save).toBe(words("fileType.native"));
      await file(page, "export-save-as");
      await expect.poll(async () => (await native()).writes).toBe(2);
      expect((await native()).save).toBe(words("fileType.native"));
      expectNoErrors(consoleErrors);
    });

    test("cloud blocked sign-in, consent, admin, expiry and full-storage prompts", async ({ page, consoleErrors }) => {
      for (const [scenario, key, values] of [
        ["blocked", "cloud.theLabelSigninWindowWasBlockedAllow", { label: "OneDrive" }],
        ["admin", "cloud.yourOrganizationsAdminHasToApproveLive", { label: "OneDrive" }],
        ["denied", "cloud.labelAccessWasntGrantedSoLiveDiagrams", { label: "OneDrive" }],
        ["expired", "cloud.oneDriveSigninExpiredWhileTryingToAction", { action: "download_the_file" }],
        ["full", "cloud.yourOneDriveIsFullSoTheFile", {}],
      ] as const) {
        await page.goto(`./?view=lab&preset=file-prompts&scenario=${scenario}`);
        await expect(page.getByTestId("file-prompts-message")).toHaveText(words(key, values), {
          timeout: pageLoadTimeout(),
        });
        await check(page, "file-prompts-dialog", "storageDialog.title", { provider: "OneDrive" });
      }
      expectNoErrors(consoleErrors);
    });
  });
}

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

/** A language's catalog: the build's chunk, or the dev server's virtual module. */
const catalogRequest = (code: string) =>
  new RegExp(String.raw`/(?:assets/${code}-[\w-]+\.js|@id/__x00__virtual:i18n/catalog/${code})(?:\?|$)`);

test.describe("when a language can't be downloaded", () => {
  test("nothing changes, the dialog says so with Retry, and the retry switches", async ({ page }) => {
    await gotoStart(page);
    await page.route(catalogRequest("de"), (route) => route.abort());
    await openLanguage(page);
    await page.getByTestId("language-option-de").click();
    await expect(page.getByTestId("language-failed")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByTestId("language-option-browser")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("language-option-de")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("language-option-de")).toBeFocused();
    expect(await page.evaluate(() => localStorage.getItem("diagrams.locale"))).toBeNull();

    await page.unroute(catalogRequest("de"));
    await page.getByTestId("language-retry").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.getByTestId("language-failed")).toHaveCount(0);
    await expect(page.getByTestId("language-option-de")).toHaveAttribute("aria-checked", "true");
    expect(await page.evaluate(() => localStorage.getItem("diagrams.locale"))).toBe("de");
  });

  test("the canvas's code downloads while the language does, not after", async ({ page }) => {
    await remember(page, "de");
    // The catalog waits until the canvas's code is asked for: without the preload, that never happens.
    let canvasAsked: () => void = () => {};
    const canvas = new Promise<void>((resolve) => (canvasAsked = resolve));
    page.on("request", (r) => /CanvasView/.test(r.url()) && canvasAsked());
    await page.route(catalogRequest("de"), async (route) => {
      await canvas;
      await route.continue();
    });
    await gotoCanvas(page, SLUG);
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
  });
});

test.describe("the keyboard in the Language dialog", () => {
  test("a language found by its name in the current language keeps the keyboard when the language changes", async ({
    page,
  }) => {
    await remember(page, "fr");
    await gotoStart(page);
    await openLanguage(page);
    await page.getByTestId("language-search").fill("allemand");
    await page.getByTestId("language-option-de").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.getByTestId("language-option-de")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("language-dialog")).toHaveCount(0);
  });

  test("the checked language shows where the keyboard is", async ({ page }) => {
    await gotoStart(page);
    await openLanguage(page);
    const browser = page.getByTestId("language-option-browser");
    const outline = () => browser.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(await outline()).toBe("none");
    // From the search field, Tab reaches the first row: Browser default, checked.
    await page.getByTestId("language-search").focus();
    await page.keyboard.press("Tab");
    await expect(browser).toBeFocused();
    expect(await outline()).toBe("solid");
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

    // Presenting: the controls keep to the top right, clear of the diagram's title at the top left.
    await page.getByTestId("present-toggle").click();
    await expect(page.getByTestId("present-exit")).toBeVisible();
    const title = await box("diagram-title");
    const exit = await box("present-exit");
    expect(exit.x).toBeGreaterThan(title.x + title.width);
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

/**
 * The menu rows' titles and descriptions that aren't pseudo-localized (no brackets), each on its own: a translated
 * description never covers for an English title. `except`: rows whose words stay as they are (a product name) or
 * wait for a later batch; a title or description testid alone skips just that line.
 */
function untranslated(menu: Locator, except: string[] = []) {
  return menu.getByTestId(/-(title|desc)$/).evaluateAll(
    (els, skip) =>
      els
        .map((el) => ({ id: el.getAttribute("data-testid") ?? "", text: (el.textContent ?? "").trim() }))
        .filter(
          ({ id, text }) =>
            !skip.some((row) => id === row || id === `${row}-title` || id === `${row}-desc`) && !text.includes("["),
        )
        .map(({ id, text }) => `${id}: ${text}`),
    except,
  );
}

async function expectAllTranslated(menu: Locator, label: string, except: string[] = []) {
  await expect(menu.getByTestId(/-title$/).first(), label).toBeVisible();
  expect(await untranslated(menu, except), label).toEqual([]);
}

test("the pseudo audit reads titles and descriptions apart: an English title is caught under a translated line", async ({
  page,
}) => {
  await page.setContent(
    '<div data-testid="menu"><button role="menuitem" data-testid="row"><span data-testid="row-title">Open…</span>' +
      '<span data-testid="row-desc">[Óóþééñ á ƒííļéé]</span></button></div>',
  );
  expect(await untranslated(page.getByTestId("menu"))).toEqual(["row-title: Open…"]);
});

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
    await expectAllTranslated(page.getByTestId("view-menu"), "View menu", [
      "view-checks",
      "capacity-overlay-toggle",
      // The Language row's second line is English on purpose: the way back for someone who can't read the UI.
      "view-language-desc",
    ]);
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
