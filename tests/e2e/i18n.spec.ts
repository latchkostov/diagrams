import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  gotoCanvas,
  expectNoErrors,
  pageLoadTimeout,
  waitForStableBox,
  waitForStableViewport,
  waitForSelectionSettled,
  fitDiagram,
  pauseClock,
} from "./fixtures";
import en from "../../src/i18n/en";
import { parse, compile } from "../../src/i18n/icu";
import { helpersFor } from "../../src/i18n/helpers";
import { pseudoLocalize } from "../../src/i18n/pseudo";
import {
  callTool,
  fakeModel,
  installFakeLanguageModel,
  installFakeModelContext,
  installFakeSpeech,
  modelReply,
  nodeCount,
  openAdvanced,
  openAiPanel,
  speech,
  speechState,
  toolNames,
} from "./ai-helpers";

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

test("a pending catalog locale refresh keeps search and stored node names", async ({ page }) => {
  await gotoCanvas(page, SLUG);
  if ((await page.getByTestId("palette").getAttribute("class"))?.includes("is-collapsed"))
    await page.getByTestId("palette-toggle").click();
  await page.getByTestId("palette-search").fill("generic.database");
  await page.getByTestId("palette-item-generic.database").click();
  await expect(page.getByTestId("inspector-field-stencil")).toContainText("Database");
  let release = () => {};
  let asked = false;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(catalogRequest("de"), async (route) => {
    asked = true;
    await held;
    await route.continue();
  });
  try {
    await openLanguage(page);
    await page.getByTestId("language-option-de").click();
    await expect.poll(() => asked).toBe(true);
    await page.keyboard.press("Escape");
    await page.getByTestId("palette-search").fill(de["stencil.genericDatabaseName"]);
    await expect(page.getByTestId("palette-item-generic.database")).toHaveCount(0);
    release();
    await expect(page.getByTestId("palette-item-generic.database")).toContainText(de["stencil.genericDatabaseName"]);
    await expect(page.getByTestId("palette-search")).toHaveValue(de["stencil.genericDatabaseName"]);
    await expect(page.getByTestId("inspector-field-stencil")).toContainText(de["stencil.genericDatabaseName"]);
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("Database");
    await expect(page.getByTestId("inspector-field-sublabel")).toHaveValue("database");
  } finally {
    release();
  }
});

test("an open quick-add row refreshes after its catalog language arrives", async ({ page }) => {
  await gotoCanvas(page, SLUG);
  let release = () => {};
  let asked = false;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(catalogRequest("de"), async (route) => {
    asked = true;
    await held;
    await route.continue();
  });
  try {
    await openLanguage(page);
    await page.getByTestId("language-option-de").click();
    await expect.poll(() => asked).toBe(true);
    await page.keyboard.press("Escape");
    await page.getByTestId("node-payments").click();
    await page.keyboard.press("Alt+ArrowRight");
    await page.getByTestId("quick-add-search").fill("generic.database");
    const row = page.getByTestId("context-menu-item-quick-add:generic.database");
    await expect(row).toContainText("Database");
    await expect(row).toHaveAttribute("data-active", "true");
    release();
    await expect(row).toContainText(de["stencil.genericDatabaseName"]);
    await expect(row).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("quick-add-search")).toHaveValue("generic.database");
  } finally {
    release();
  }
});

test("expanded catalog names wrap in the library, inspector and gallery previews", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await remember(page, "en-XA");
  await gotoCanvas(page, SLUG);
  if ((await page.getByTestId("palette").getAttribute("class"))?.includes("is-collapsed"))
    await page.getByTestId("palette-toggle").click();
  for (const id of ["generic.identity-provider", "generic.secret-store", "generic.vector-db"]) {
    await page.getByTestId("palette-search").fill(id);
    const item = page.getByTestId(`palette-item-${id}`);
    await expect(item).toContainText("[");
    await expectNothingCut(item, `expanded library name: ${id}`);
  }
  await page.getByTestId("palette-search").fill("generic.identity-provider");
  await page.getByTestId("palette-item-generic.identity-provider").click();
  await expectNothingCut(page.getByTestId("inspector-field-stencil"), "expanded inspector name");
  await page.goto("./?view=gallery");
  await page.getByTestId("gallery-search").fill("generic.identity-provider");
  const tile = page.getByTestId("stencil-tile-generic.identity-provider");
  await expect(page.getByTestId("tile-stage-generic.identity-provider")).toContainText("[");
  await expectNothingCut(page.getByTestId("tile-stage-generic.identity-provider"), "expanded gallery preview");
  await tile.click();
  await expectNothingCut(page.getByTestId("stencil-drawer"), "expanded stencil details");
  await expectSeparatePreviews(page);
});

for (const code of ["de", "ja", "ar"] as const) {
  test(`stencil catalog in ${code}: translated discovery, previews and picker; brands and diagram text stay`, async ({
    page,
    consoleErrors,
  }) => {
    const text = catalog(code);
    const database = text["stencil.genericDatabaseName"];
    const external = text["stencil.genericExternalApiName"];
    await remember(page, code);
    await gotoCanvas(page, SLUG);
    if ((await page.getByTestId("palette").getAttribute("class"))?.includes("is-collapsed"))
      await page.getByTestId("palette-toggle").click();
    const search = page.getByTestId("palette-search");
    await search.fill(database);
    const item = page.getByTestId("palette-item-generic.database");
    await expect(item).toContainText(database);
    await expect(item).toHaveAttribute(
      "title",
      `${database} (${text["stencil.vendorGeneric"]})\n${text["stencil.genericDatabaseDescription"]}`,
    );
    await search.fill(external);
    await expect(page.getByTestId("palette-item-generic.external-api")).toContainText(external);
    await search.fill("external api");
    await expect(page.getByTestId("palette-item-generic.external-api")).toBeVisible();
    await search.fill("pg");
    await expect(page.getByTestId("palette-item-postgres")).toContainText("PostgreSQL");
    await search.fill("Stripe");
    await expect(page.getByTestId("palette-item-stripe")).toContainText("Stripe");

    await search.fill(database);
    await page.getByTestId("palette-item-generic.database").click();
    // A translated preview never becomes the person's diagram content.
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("Database");
    await expect(page.getByTestId("inspector-field-sublabel")).toHaveValue("database");

    await fitDiagram(page);
    await page.getByTestId("node-payments").click();
    const label = await page.getByTestId("inspector-field-label").inputValue();
    await page.getByTestId("inspector-field-stencil").click();
    await page.getByTestId("stencil-picker-search").fill(database);
    await expect(page.getByTestId("context-menu-item-pick-stencil:generic.database")).toContainText(database);
    await page.getByTestId("context-menu-item-pick-stencil:generic.database").click();
    await expect(page.getByTestId("inspector-field-stencil")).toContainText(database);
    await expect(page.getByTestId("inspector-field-label")).toHaveValue(label);

    await page.goto("./?view=gallery");
    await page.getByTestId("gallery-search").fill(database);
    const tile = page.getByTestId("stencil-tile-generic.database");
    await expect(tile).toContainText(database);
    await expect(tile).toContainText(text["stencil.genericDatabaseDescription"]);
    await expect(page.getByTestId("tile-stage-generic.database")).toContainText(text["stencil.subtitleDatabase"]);
    await tile.click();
    const drawer = page.getByTestId("stencil-drawer");
    await expect(drawer).toContainText(text["stencil.genericDatabaseDescription"]);
    await expect(drawer).toContainText(text["stencil.subtitleDatabase"]);
    await expect(page.getByTestId("drawer-default-subtitle")).toHaveText("database");
    await expectNothingCut(drawer, `${code}: stencil details`);
    await expectSeparatePreviews(page);
    await page.keyboard.press("Escape");
    await page.getByTestId("gallery-search").fill("Stripe");
    await expect(page.getByTestId("stencil-tile-stripe")).toContainText("Stripe");
    expectNoErrors(consoleErrors);
  });
}

test("stencil details promise the subtitle created by Add and New diagram", async ({ page }) => {
  await remember(page, "de");
  await gotoCanvas(page, SLUG);
  for (const action of ["drawer-add", "drawer-new"]) {
    await page.goto("./?view=gallery");
    await page.getByTestId("gallery-search").fill("generic.database");
    await page.getByTestId("stencil-tile-generic.database").click();
    const subtitle = page.getByTestId("drawer-default-subtitle");
    await expect(subtitle).toHaveText("database");
    const promised = await subtitle.innerText();
    await page.getByTestId(action).click();
    await page.getByTestId(action === "drawer-add" ? "node-database-1" : "node-database").click();
    await expect(page.getByTestId("inspector-field-sublabel")).toHaveValue(promised);
  }
});

for (const variant of ["card", "compact", "iconOnly"]) {
  test(`wrapped catalog previews stay inside their stage and clear their captions: ${variant}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await remember(page, "en-XA");
    await page.addInitScript((nodeVariant) => {
      localStorage.setItem("diagrams.settings.v1", JSON.stringify({ nodeVariant }));
    }, variant);
    await page.goto("./?view=gallery");
    for (const id of [
      "generic.identity-provider",
      "generic.secret-store",
      "generic.vector-db",
      "azure.service-bus.queue",
    ]) {
      await page.getByTestId("gallery-search").fill(id);
      const stage = page.getByTestId(`tile-stage-${id}`);
      await expect(stage).toContainText("[");
      await expectNothingCut(stage, `wrapped ${variant} tile: ${id}`);
      expect(await previewProblems(stage), `${variant}: ${id}`).toEqual([]);
      await page.getByTestId(`stencil-tile-${id}`).click();
      await expect(page.getByTestId("drawer-preview")).toBeVisible();
      expect(await previewProblems(page.getByTestId("drawer-preview")), `drawer: ${id}`).toEqual([]);
      await expectSeparatePreviews(page);
      if (id === "generic.identity-provider" && variant === "iconOnly")
        await page.screenshot({ path: "tests/.output/review-ux-gallery.png" });
      await page.getByTestId("drawer-close").click();
    }
  });
}

test("the preview audit detects vertical clipping and overlap with its own figcaption", async ({ page }) => {
  await remember(page, "en-XA");
  await page.goto("./?view=gallery");
  await page.getByTestId("gallery-search").fill("generic.identity-provider");
  await page.getByTestId("stencil-tile-generic.identity-provider").click();
  const stage = page.getByTestId("drawer-preview");
  await expect(stage).toBeVisible();
  expect(await previewProblems(stage)).toEqual([]);
  // Use the actual rendered preview as the deliberately clipped fixture; no timing or screenshot oracle.
  await stage.evaluate((el) => {
    el.style.height = "24px";
    el.style.overflow = "hidden";
  });
  expect(await previewProblems(stage)).toContainEqual(expect.stringContaining("vertical"));
  await stage.evaluate((el) => el.removeAttribute("style"));
  const caption = page.getByTestId("drawer-preview-iconOnly").getByTestId("node-caption");
  const captionBox = await caption.boundingBox();
  const figcaptionBox = await page.getByTestId("drawer-variant-iconOnly").boundingBox();
  if (!captionBox || !figcaptionBox) throw new Error("Missing caption geometry");
  await caption.evaluate((el, delta) => {
    el.style.translate = `0 ${delta}px`;
  }, figcaptionBox.y - captionBox.y);
  expect(await previewProblems(stage)).toContainEqual(expect.stringContaining("figcaption overlap"));
  await caption.evaluate((el) => el.removeAttribute("style"));
  expect(await previewProblems(stage)).toEqual([]);
});

for (const code of ["de", "ar", "en-XA"]) {
  test.describe(`canvas chrome in ${code}`, () => {
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

    test("context menus, submenus and command palette translate and wrap", async ({
      page,
      consoleErrors,
    }, testInfo) => {
      await gotoCanvas(page, SLUG);
      await waitForStableViewport(page);
      const canvas = page.getByTestId("canvas-wrap");
      const box = await canvas.boundingBox();
      if (!box) throw new Error("Canvas has no box");
      await canvas.click({ button: "right", position: { x: box.width / 2, y: 90 } });
      await expect(page.getByTestId("context-menu-item-canvas.add-node")).toContainText(words("menu.addNodeHere"));
      await expectNothingCut(page.getByTestId("context-menu"), `${code}: canvas menu`);
      await page.getByTestId("context-menu-item-canvas.annotate").click();
      const submenu = page.getByTestId("context-menu-sub");
      await expect(submenu).toBeVisible();
      await expectNothingCut(submenu, `${code}: annotation submenu`);
      if (code === "ar") {
        const parentBox = await page.getByTestId("context-menu").boundingBox();
        const childBox = await submenu.boundingBox();
        if (!parentBox || !childBox) throw new Error("Menu has no box");
        expect(childBox.x).toBeLessThan(parentBox.x);
      }
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.getByTestId("node-payments").click({ button: "right" });
      await expect(page.getByTestId("context-menu-item-node.rename")).toContainText(words("library.rename"));
      await expectNothingCut(page.getByTestId("context-menu"), `${code}: node menu`);
      await page.keyboard.press("Escape");

      await page.getByTestId("edge-label-shopper-to-gateway").click({ button: "right" });
      await expect(page.getByTestId("context-menu-item-edge.relationship")).toContainText(words("chrome.relationship"));
      await expectNothingCut(page.getByTestId("context-menu"), `${code}: edge menu`);
      await page.getByTestId("context-menu-item-edge.route").click();
      await expect(page.getByTestId("context-menu-item-edge.from-side")).toContainText(words("menu.fromSide"));
      await expectNothingCut(submenu, `${code}: edge routing submenu`);
      await page.getByTestId("context-menu-item-edge.from-side").click();
      await expect(page.getByTestId("context-menu-item-edge.from-side:right")).toContainText(words("chrome.right"));
      await expectNothingCut(page.getByTestId("context-menu-sub-sub"), `${code}: edge side submenu`);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      // A boundary named by the person stays as written while its menu is translated.
      await fitDiagram(page);
      await page.getByTestId("node-shopper").click();
      await page.getByTestId("node-gateway").click({ modifiers: ["ControlOrMeta"] });
      await page.keyboard.press("ControlOrMeta+g");
      const boundaryName = page.getByTestId("inspector-field-label");
      await expect(boundaryName).toBeFocused();
      await boundaryName.fill("i18n boundary");
      await boundaryName.press("Enter");
      await expect(page.getByTestId("group-label-boundary-1")).toHaveText("i18n boundary");
      await waitForStableViewport(page);
      await page.getByTestId("group-label-boundary-1").click({ button: "right" });
      await expect(page.getByTestId("context-menu-item-group.ungroup")).toContainText(words("menu.removeBoundary"));
      await expectNothingCut(page.getByTestId("context-menu"), `${code}: boundary menu`);
      await page.getByTestId("context-menu-item-group.tone").click();
      await expect(page.getByTestId("context-menu-item-tone:neutral")).toContainText(words("chrome.neutral"));
      await expectNothingCut(submenu, `${code}: boundary colour submenu`);
      await page.screenshot({ path: testInfo.outputPath("boundary-chrome.png") });
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await fitDiagram(page);
      await page.getByTestId("node-payments").click();
      await canvas.focus();
      await page.keyboard.press("ControlOrMeta+k");
      await expect(page.getByTestId("command-palette")).toBeVisible();
      await expect(page.getByTestId("command-item-action:node.rename")).toContainText(words("chrome.renameNode"));
      await expectNothingCut(page.getByTestId("command-palette"), `${code}: palette`);
      await page.getByTestId("command-input").fill("zzzz-no-command");
      await expect(page.getByTestId("command-empty")).toContainText(
        words("chrome.noMatchesForValue", { query: "zzzz-no-command" }),
      );
      await expectNothingCut(page.getByTestId("command-palette"), `${code}: palette empty`);
      await page.screenshot({ path: testInfo.outputPath("canvas-chrome.png") });
      expectNoErrors(consoleErrors);
    });

    test("edit toasts and restored selection feedback use the chosen language", async ({ page, consoleErrors }) => {
      await gotoCanvas(page, SLUG);
      await page.getByTestId("node-payments").click();
      await page.keyboard.press("Alt+ArrowRight");
      await expect(page.getByTestId("quick-add")).toBeVisible();
      await page.getByTestId("quick-add-search").fill("postgres");
      await page.getByTestId("quick-add-search").press("Enter");
      await expect(page.getByTestId("inspector-field-label")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("toast")).toContainText(words("chrome.requestTheCallerWaitsForAReply"));
      await expect(page.getByTestId("toast-make-message")).toHaveText(words("edit.makeItAMessage"));
      await expectNothingCut(page.getByTestId("toast"), `${code}: editing toast`);
      await page.getByTestId("toast-make-message").click();

      await page.getByTestId("node-payments").click({ button: "right" });
      await page.getByTestId("context-menu-item-node.rename").click();
      const name = await page.getByTestId("inspector-field-label").inputValue();
      await page.keyboard.press("Escape");
      await page.getByTestId("node-payments").click({ button: "right" });
      await page.getByTestId("context-menu-item-item.delete").click();
      await expect(page.getByTestId("node-payments")).toHaveCount(0);
      await page.getByTestId("canvas-wrap").focus();
      await page.keyboard.press("ControlOrMeta+z");
      await expect(page.getByTestId("node-payments")).toBeVisible();
      await expect(page.getByTestId("node-payments")).toContainText(name);
      await expect(page.getByTestId("canvas-announce")).toHaveText(
        words("chrome.undoneValue", { selection: words("ai.selected", { count: 5 }) }),
      );
      expectNoErrors(consoleErrors);
    });

    test("stencil library, gallery and Your diagrams chrome translate without clipping", async ({
      page,
      consoleErrors,
    }, testInfo) => {
      await gotoCanvas(page, SLUG);
      if (
        await page
          .getByTestId("palette")
          .getAttribute("class")
          .then((c) => c?.includes("is-collapsed"))
      )
        await page.getByTestId("palette-toggle").click();
      await expect(page.getByTestId("palette-search")).toHaveAttribute("placeholder", words("library.findAStencil"));
      await expect(page.getByTestId("palette-section-messaging")).toContainText(words("chrome.messaging"));
      await page.getByTestId("palette-section-messaging").click();
      await expectNothingCut(page.getByTestId("palette"), `${code}: stencil library`);
      await expect(page.getByTestId("palette-annotate")).toContainText(words("menu.annotate"));
      await page.getByTestId("palette-annotate").scrollIntoViewIfNeeded();
      await expectNothingCut(page.getByTestId("palette-annotate"), `${code}: annotation rail`);
      await page.screenshot({ path: testInfo.outputPath("annotation-rail.png") });
      await page.getByTestId("palette-family").selectOption("aws");
      await page.getByTestId("palette-search").fill("pg");
      await expect(page.getByTestId("palette-empty")).toBeVisible();
      await expectNothingCut(page.getByTestId("palette"), `${code}: library empty`);
      await page.goto("./?view=gallery");
      await expect(page.getByTestId("gallery-head")).toBeVisible();
      await expect(page.getByTestId("gallery-search")).toHaveAttribute(
        "aria-label",
        words("importReport.searchStencils"),
      );
      await expectNothingCut(page.getByTestId("gallery-head"), `${code}: gallery filters`);
      await expectNothingCut(page.getByTestId("gallery-rail"), `${code}: gallery categories`);
      await page.getByTestId("stencil-tile-kafka.topic").click();
      await expect(page.getByTestId("stencil-drawer")).toBeVisible();
      await expect(page.getByTestId("drawer-add")).toContainText(words("gallery.addToCurrentDiagramText").trim());
      await expect(page.getByTestId("drawer-variant-card")).toHaveText(words("view.node.card"));
      await expect(page.getByTestId("drawer-variant-compact")).toHaveText(words("view.node.compact"));
      await expect(page.getByTestId("drawer-variant-iconOnly")).toHaveText(words("view.node.iconOnly"));
      await expectNothingCut(page.getByTestId("stencil-drawer"), `${code}: stencil details`);
      if (code === "ar") {
        const iconStyle = (id: string) =>
          page.getByTestId(id).evaluate((button) => {
            const icon = button.firstElementChild;
            if (!icon) throw new Error("Expected a drawer icon");
            const style = getComputedStyle(icon);
            return { rotate: style.rotate, transform: style.transform };
          });
        const previousIcon = await iconStyle("drawer-prev");
        expect(previousIcon.rotate).toBe("none");
        expect(previousIcon.transform).toBe("none");
        expect((await iconStyle("drawer-next")).transform).toBe("matrix(-1, 0, 0, 1, 0, 0)");
        const before = "kafka.topic";
        const next = "kafka.cluster";
        await expect(page.getByTestId("stencil-drawer")).toHaveAttribute("data-stencil", before);
        await page.getByTestId("drawer-next").click();
        await expect(page.getByTestId("stencil-drawer")).toHaveAttribute("data-stencil", next);
        await page.getByTestId("drawer-prev").click();
        await expect(page.getByTestId("stencil-drawer")).toHaveAttribute("data-stencil", before);
        await page.getByTestId("stencil-drawer").press("ArrowLeft");
        await expect(page.getByTestId("stencil-drawer")).toHaveAttribute("data-stencil", next);
        await page.getByTestId("stencil-drawer").press("ArrowRight");
        await expect(page.getByTestId("stencil-drawer")).toHaveAttribute("data-stencil", before);
      }
      await page.screenshot({ path: testInfo.outputPath("stencil-details.png") });
      await page.getByTestId("drawer-close").click();
      await page.getByTestId("gallery-search").fill("zzzz-no-stencil");
      await expect(page.getByTestId("gallery-empty")).toContainText(
        words("chrome.nothingMatchesValue", { query: "zzzz-no-stencil" }),
      );
      await expectNothingCut(page.getByTestId("gallery-empty"), `${code}: gallery empty`);
      await page.getByTestId("file-button").click();
      await page.getByTestId("file-library").click();
      await expect(page.getByTestId("library-dialog")).toBeVisible();
      await expectNothingCut(page.getByTestId("library-dialog"), `${code}: Your diagrams`);
      await page.screenshot({ path: testInfo.outputPath("library-chrome.png") });
      expectNoErrors(consoleErrors);
    });
  });
}

for (const code of ["de", "fi", "ar", "en-XA"]) {
  test.describe(`AI and keyboard labels in ${code}`, () => {
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

    test("AI chrome, dictation, tool help, thread and Advanced wrap", async ({ page, consoleErrors }, testInfo) => {
      // Tool help is static and can appear before the bridge chunk. Release the chunk only on the first
      // registration read, so an immediate assertion deterministically observes the still-empty host.
      let releaseBridge = () => {};
      const heldBridge = new Promise<void>((resolve) => (releaseBridge = resolve));
      await page.exposeFunction("releaseBridge", releaseBridge);
      await page.route(/\/WebMcpBridge[^/]*\.(?:js|tsx)(?:\?|$)/, async (route) => {
        await heldBridge;
        await route.continue();
      });
      await installFakeLanguageModel(page, {
        replies: [modelReply("Added a worker", [{ op: "add", kind: "service", label: "i18n-worker" }])],
      });
      await installFakeModelContext(page);
      await installFakeSpeech(page);
      await gotoCanvas(page, SLUG);
      await openAiPanel(page);
      await expect(page.getByTestId("ai-empty")).toContainText(words("ai.changeThisDiagramWithAI"));
      await expect(page.getByTestId("ai-ondevice-send")).toHaveText(words("ai.send"));
      await page.getByTestId("ai-tools-toggle").click();
      await expect(page.getByTestId("ai-tool-describe_diagram")).toContainText(words("ai.tool.describeDiagram"));
      await page.evaluate(() => {
        const w = window as unknown as { __mcp: { names(): string[] }; releaseBridge(): Promise<void> };
        const names = w.__mcp.names;
        w.__mcp.names = () => {
          void w.releaseBridge();
          return names();
        };
      });
      await expect.poll(() => toolNames(page)).toContain("edit_diagram");
      await expectNothingCut(page.getByTestId("ai-panel"), `${code}: AI help`, ["ai-resize"]);
      const read = await callTool(page, "describe_diagram");
      expect(read.isError).toBe(false);
      expect(read.text).toContain("Inventory service");

      await openAdvanced(page);
      await expect(page.getByTestId("ai-copy-prompt")).toContainText(words("ai.copyPrompt"));
      await expect(page.getByTestId("ai-reply")).toHaveAttribute("placeholder", words("ai.pasteTheReply"));
      await page.getByTestId("ai-mic").click();
      await expect(page.getByTestId("ai-mic")).toHaveAttribute("data-status", "listening");
      await expect(page.getByTestId("ai-speech-service")).toHaveText(words("ai.speechGoogle"));
      await speech(page, "result", [["add a worker", true]]);
      await expect(page.getByTestId("ai-request")).toHaveValue("Add a worker");
      await page.getByTestId("ai-mic").click();
      await page.getByTestId("ai-reply").fill('[{"op":"add_node","kind":"service","label":"pasted-worker"}]');
      await expect(page.getByTestId("ai-reply-status")).toHaveText(words("ai.opsReady", { count: 1 }));
      await expectNothingCut(page.getByTestId("ai-panel"), `${code}: Advanced`, ["ai-resize"]);
      await page.screenshot({ path: testInfo.outputPath("ai-advanced.png") });

      await page.getByTestId("ai-ondevice-input").fill("Add a worker");
      await page.getByTestId("ai-ondevice-send").click();
      await expect(page.getByTestId("ai-turn-0")).toBeVisible();
      await expect(page.getByTestId("ai-turn-0-undo")).toContainText(words("ai.undoThisChange"));
      await expectNothingCut(page.getByTestId("ai-panel"), `${code}: conversation`, ["ai-resize"]);
      expect((await fakeModel(page)).prompts[0]).toContain("Request: Add a worker");
      await page.getByTestId("ai-clear").click();
      await expect(page.getByTestId("ai-clear-undo")).toContainText(words("ai.undo"));
      expectNoErrors(consoleErrors);
    });

    for (const platform of ["Win32", "MacIntel"]) {
      test(`the whole shortcuts sheet fits, with native key names on ${platform}`, async ({
        page,
        consoleErrors,
      }, testInfo) => {
        await page.addInitScript((p) => Object.defineProperty(navigator, "platform", { get: () => p }), platform);
        await gotoCanvas(page, SLUG);
        await page.getByTestId("canvas-wrap").focus();
        await page.keyboard.press("?");
        const sheet = page.getByTestId("shortcuts-dialog");
        await expect(sheet).toContainText(words("shortcuts.live.toggle"));
        const mac = await page.evaluate(() => /Mac|iPod|iPhone|iPad/.test(navigator.platform));
        await expect(sheet).toContainText(mac ? "⇧" : words("keys.shift"));
        await expect(sheet).toContainText(words("keys.space"));
        if (code === "de") await expect(sheet).toContainText(mac ? "⌘⇧Z" : "Strg+Umschalt+Z");
        await expectNothingCut(sheet, `${code}: shortcuts`);
        const box = await sheet.boundingBox();
        if (!box) throw new Error("The shortcuts sheet has no box");
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(800);
        await page.screenshot({ path: testInfo.outputPath("shortcuts.png") });
        await page.getByTestId("shortcuts-live").scrollIntoViewIfNeeded();
        await expectNothingCut(sheet, `${code}: Live shortcuts`);
        await page.screenshot({ path: testInfo.outputPath("shortcuts-live.png") });
        expectNoErrors(consoleErrors);
      });
    }
  });
}

for (const outcome of ["pending", "failed"]) {
  test(`canvas commands work while the catalog is ${outcome}`, async ({ page }) => {
    await gotoCanvas(page, SLUG);
    let release = () => {};
    let asked = false;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(catalogRequest("de"), async (route) => {
      asked = true;
      if (outcome === "pending") await held;
      await route.abort();
    });
    try {
      await openLanguage(page);
      await page.getByTestId("language-option-de").click();
      await expect.poll(() => asked).toBe(true);
      if (outcome === "failed") await expect(page.getByTestId("language-failed")).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByTestId("node-payments").click({ button: "right" });
      await expect(page.getByTestId("context-menu-item-item.duplicate")).toContainText("Duplicate");
      const before = await nodeCount(page);
      await page.getByTestId("context-menu-item-item.duplicate").click();
      await expect.poll(() => nodeCount(page)).toBe(before + 1);
      await page.getByTestId("canvas-wrap").focus();
      await page.keyboard.press("ControlOrMeta+k");
      await page.getByTestId("command-input").fill("Undo");
      await page.getByTestId("command-item-action:canvas.undo").click();
      await expect.poll(() => nodeCount(page)).toBe(before);
    } finally {
      release();
    }
  });

  test(`AI sending and dictation work while the catalog is ${outcome}`, async ({ page }) => {
    await installFakeSpeech(page);
    await installFakeLanguageModel(page, {
      replies: [modelReply("Added a worker", [{ op: "add", kind: "service", label: "fallback-worker" }])],
    });
    await gotoCanvas(page, SLUG);
    await openAdvanced(page);
    const before = await nodeCount(page);
    let release = () => {};
    let asked = false;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(catalogRequest("de"), async (route) => {
      asked = true;
      if (outcome === "pending") await held;
      await route.abort();
    });
    try {
      await openLanguage(page);
      await page.getByTestId("language-option-de").click();
      await expect.poll(() => asked).toBe(true);
      if (outcome === "failed") await expect(page.getByTestId("language-failed")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("ai-ondevice-send")).toHaveText("Send");
      await page.getByTestId("ai-ondevice-mic").click();
      await expect(page.getByTestId("ai-ondevice-mic")).toHaveAttribute("data-status", "listening");
      await speech(page, "result", [["add a worker", true]]);
      await expect(page.getByTestId("ai-ondevice-input")).toHaveValue("Add a worker");
      await page.getByTestId("ai-ondevice-send").click();
      await expect(page.getByTestId("ai-turn-0")).toHaveAttribute("data-engine", "on-device");
      expect(await nodeCount(page)).toBe(before + 1);
      await page.getByTestId("ai-turn-0-undo").click();
      await expect.poll(() => nodeCount(page)).toBe(before);
      await page.getByTestId("ai-reply").fill('[{"op":"add_node","kind":"service","label":"paste-fallback"}]');
      await page.getByTestId("ai-apply").click();
      await expect.poll(() => nodeCount(page)).toBe(before + 1);
    } finally {
      release();
    }
  });
}

test("switching language updates the mounted AI UI without resetting dictation or the request", async ({ page }) => {
  await installFakeSpeech(page);
  await installFakeLanguageModel(page);
  await gotoCanvas(page, SLUG);
  await openAdvanced(page);
  await page.getByTestId("ai-request").fill("Keep this draft");
  await page.getByTestId("ai-mic").click();
  await expect(page.getByTestId("ai-mic")).toHaveAttribute("data-status", "listening");
  await openLanguage(page);
  await page.getByTestId("language-option-de").click();
  await expect(page.getByTestId("language-option-de")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("language-done").click();
  await expect(page.getByTestId("ai-copy-prompt")).toContainText(de["ai.copyPrompt"]);
  await expect(page.getByTestId("ai-ondevice-send")).toHaveText(de["ai.send"]);
  await expect(page.getByTestId("ai-speech-service")).toHaveText(de["ai.speechGoogle"]);
  await expect(page.getByTestId("ai-request")).toHaveValue("Keep this draft");
  expect((await speechState(page)).starts).toBe(1);
  await page.getByTestId("ai-collapse").click();
  await expect(page.getByTestId("ai-rail-open")).toHaveAttribute("aria-label", de["ai.aIPanel"]);
  const mac = await page.evaluate(() => /Mac|iPod|iPhone|iPad/.test(navigator.platform));
  await expect(page.getByTestId("ai-rail-open")).toHaveAttribute("title", mac ? /⌘I/ : /Strg\+I/);
});

test("switching language retranslates existing AI errors and preserves both drafts", async ({ page }) => {
  await installFakeSpeech(page, { deny: true });
  const bad = modelReply("", [{ op: "connect", from: "Nowhere", to: "Inventory service" }]);
  await installFakeLanguageModel(page, { replies: [bad, bad] });
  await gotoCanvas(page, SLUG);
  await openAdvanced(page);
  await page.getByTestId("ai-request").fill("Keep the Advanced draft");
  await page.getByTestId("ai-reply").fill(
    JSON.stringify({
      ops: [{ op: "set_meta", title: await page.getByTestId("diagram-title").innerText() }],
      layout: "none",
    }),
  );
  await page.getByTestId("ai-apply").click();
  await expect(page.getByTestId("ai-error-message")).toHaveText(en["ai.theReplyDidnTChangeAnything"]);
  await page.getByTestId("ai-mic").click();
  await expect(page.getByTestId("ai-dictation-message")).toHaveText(en["ai.theMicrophoneIsBlockedAllowItFrom"]);
  await page.getByTestId("ai-ondevice-input").fill("Connect nowhere to inventory");
  await page.getByTestId("ai-ondevice-send").click();
  await expect(page.getByTestId("ai-ondevice-error")).toHaveText(en["ai.couldnTApplyThatTryRephrasing"]);
  await openLanguage(page);
  await page.getByTestId("language-option-de").click();
  await expect(page.getByTestId("language-option-de")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("language-done").click();
  await expect.soft(page.getByTestId("ai-dictation-message")).toHaveText(de["ai.theMicrophoneIsBlockedAllowItFrom"]);
  await expect.soft(page.getByTestId("ai-ondevice-error")).toHaveText(de["ai.couldnTApplyThatTryRephrasing"]);
  await expect(page.getByTestId("ai-error-message")).toHaveText(de["ai.theReplyDidnTChangeAnything"]);
  await expect(page.getByTestId("ai-request")).toHaveValue("Keep the Advanced draft");
  await expect(page.getByTestId("ai-ondevice-input")).toHaveValue("Connect nowhere to inventory");
});

test("revert labels follow language switches and reloads without translating the original request", async ({
  page,
}) => {
  await gotoCanvas(page, SLUG);
  await openLanguage(page);
  await page.getByTestId("language-option-de").click();
  await expect(page.getByTestId("language-option-de")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("language-done").click();
  await openAdvanced(page);
  for (const [n, label] of ["First worker", "Second worker"].entries()) {
    await page.getByTestId("ai-request").fill(label);
    await page.getByTestId("ai-reply").fill(JSON.stringify([{ op: "add_node", kind: "service", label }]));
    await page.getByTestId("ai-apply").click();
    await expect(page.getByTestId(`ai-turn-${n}`)).toBeVisible();
  }
  await page.getByTestId("ai-turn-0-revert").click();
  await expect(page.getByTestId("ai-turn-2-request")).toHaveText(de["ai.reverted"].replace("{label}", "First worker"));
  await openLanguage(page);
  await page.getByTestId("language-option-en").click();
  await expect(page.getByTestId("language-option-en")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("language-done").click();
  await expect(page.getByTestId("ai-turn-2-request")).toHaveText("Reverted to “First worker”");
  await expect(page.getByTestId("ai-turn-0-request")).toHaveText("First worker");
  await page.reload();
  await expect(page.getByTestId("ai-panel")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(page.getByTestId("ai-turn-2-request")).toHaveText("Reverted to “First worker”");
  await page.getByTestId("ai-turn-1-revert").click();
  await page.getByTestId("ai-turn-2-revert").click();
  await expect(page.getByTestId("ai-turn-4-request")).toHaveText("Reverted to “First worker”");
});

for (const platform of ["Win32", "MacIntel"]) {
  test(`native key labels on ${platform}`, async ({ page }) => {
    await page.addInitScript((p) => Object.defineProperty(navigator, "platform", { get: () => p }), platform);
    await remember(page, "de");
    await gotoCanvas(page, SLUG);
    await openAdvanced(page);
    await expect(page.getByTestId("ai-collapse")).toHaveAttribute("title", platform === "MacIntel" ? /⌘I/ : /Strg\+I/);
    await page.getByTestId("canvas-wrap").focus();
    await page.keyboard.press("?");
    await expect(page.getByTestId("shortcuts-dialog")).toContainText(
      platform === "MacIntel" ? "⌘⇧Z" : "Strg+Umschalt+Z",
    );
    await expect(page.getByTestId("shortcuts-dialog")).toContainText(platform === "MacIntel" ? "⇧" : de["keys.shift"]);
  });
}

for (const code of ["ar", "he"]) {
  test(`Mac AI combinations are isolated inside ${code} sentences and tooltips`, async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, "platform", { get: () => "MacIntel" }));
    await remember(page, code);
    await installFakeSpeech(page);
    await gotoCanvas(page, SLUG);
    await openAdvanced(page);
    await expect(page.getByTestId("ai-reply-status")).toContainText("\u2066⌘Enter\u2069");
    await expect(page.getByTestId("ai-collapse")).toHaveAttribute("title", /\u2066⌘I\u2069/);
    await expect(page.getByTestId("ai-mic")).toHaveAttribute("title", /\u2066⌘⇧M\u2069/);
    await page.getByTestId("ai-collapse").click();
    await expect(page.getByTestId("ai-rail-open")).toHaveAttribute("title", /\u2066⌘I\u2069/);
  });
}

test("Arabic dock resize keys move its canvas-facing edge in the physical direction", async ({ page }) => {
  await remember(page, "ar");
  await gotoCanvas(page, SLUG);
  await openAiPanel(page);
  await waitForStableBox(page.getByTestId("ai-dock"));
  const before = await page.getByTestId("ai-dock").boundingBox();
  if (!before) throw new Error("The AI dock has no box");
  await page.getByTestId("ai-resize").press("ArrowRight");
  await expect.poll(async () => (await page.getByTestId("ai-dock").boundingBox())?.width).toBe(before.width + 24);
  await page.getByTestId("ai-resize").press("ArrowLeft");
  await expect.poll(async () => (await page.getByTestId("ai-dock").boundingBox())?.width).toBe(before.width);
});

test("English mouse gestures on Mac retain their original literal modifier names", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "platform", { get: () => "MacIntel" }));
  await gotoCanvas(page, SLUG);
  await page.getByTestId("canvas-wrap").focus();
  await page.keyboard.press("?");
  await expect(page.getByTestId("shortcuts-mouse")).toContainText("Shift / Ctrl / ⌘ + click");
  await expect(page.getByTestId("shortcuts-mouse")).toContainText("Ctrl / ⌘ + drag on the canvas");
});

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
      await expect(page.getByTestId(id)).toBeVisible({ timeout: pageLoadTimeout() });
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
      await expect(page.getByTestId("diagram-title")).toHaveText("i18n-fixture");
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await waitForStableViewport(page);
      await waitForStableBox(page.getByTestId("toast-import-details"));
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
      await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
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

    for (const [scenario, key, values] of [
      ["blocked", "cloud.theLabelSigninWindowWasBlockedAllow", { label: "OneDrive" }],
      ["admin", "cloud.yourOrganizationsAdminHasToApproveLive", { label: "OneDrive" }],
      ["denied", "cloud.labelAccessWasntGrantedSoLiveDiagrams", { label: "OneDrive" }],
      ["expired", "cloud.signInExpired", { provider: "OneDrive", action: "download_the_file" }],
      ["full", "cloud.storageFull", { provider: "OneDrive" }],
    ] as const)
      test(`cloud ${scenario} prompt`, async ({ page, consoleErrors }) => {
        await page.goto(`./?view=lab&preset=file-prompts&scenario=${scenario}`);
        await expect(page.getByTestId("file-prompts-message")).toHaveText(words(key, values), {
          timeout: pageLoadTimeout(),
        });
        await check(page, "file-prompts-dialog", "storageDialog.title", { provider: "OneDrive" });
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
  await expect(page.getByTestId("language-dialog")).toBeVisible({ timeout: pageLoadTimeout() });
}

/** Starts the page in a language, as a remembered choice would. */
const remember = (page: Page, code: string) =>
  page.addInitScript((c) => window.localStorage.setItem("diagrams.locale", c), code);

test.describe("choosing a language", () => {
  test("a cached import report follows a language change when reopened", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, SLUG);
    await page.getByTestId("import-input").setInputFiles({
      name: "compose.yaml",
      mimeType: "application/yaml",
      buffer: Buffer.from("services:\n  api:\n    image: nginx\nvolumes:\n  data: {}\n"),
    });
    await page.getByTestId("toast-import-details").click();
    await expect(page.getByTestId("import-report-not-drawn-0")).toContainText(en["importDetail.volume"]);
    await page.getByTestId("import-report-done").click();
    await openLanguage(page);
    await page.getByTestId("language-option-ar").click();
    await expect(page.getByTestId("language-option-ar")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("language-done").click();
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("command-input").fill(catalog("ar")["importReport.importReport"]);
    await page.getByTestId("command-input").press("Enter");
    await expect(page.getByTestId("import-report-not-drawn-0")).toContainText(catalog("ar")["importDetail.volume"]);
    expectNoErrors(consoleErrors);
  });

  test("View ▸ Language… switches the converted areas at once, and a reload keeps it", async ({
    page,
    consoleErrors,
  }) => {
    test.slow(); // Initial load and the reload each initialize the app and its language.
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
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.keyboard.type("language");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("language-dialog")).toBeVisible({ timeout: pageLoadTimeout() });
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

async function expectSeparatePreviews(page: Page) {
  const compact = await page.getByTestId("drawer-preview-compact").boundingBox();
  const caption = await page.getByTestId("drawer-preview-iconOnly").getByTestId("node-caption").boundingBox();
  if (!compact || !caption) throw new Error("Missing stencil preview geometry");
  expect(
    compact.x + compact.width <= caption.x ||
      caption.x + caption.width <= compact.x ||
      compact.y + compact.height <= caption.y ||
      caption.y + caption.height <= compact.y,
    "the icon caption has its own space, including when the preview row wraps",
  ).toBe(true);
}

/** Preview stages must contain all their content, even where overflow is visible. Scrollable drawers may scroll. */
async function previewProblems(stage: Locator): Promise<string[]> {
  return stage.evaluate((root) => {
    const problems: string[] = [];
    const outer = root.getBoundingClientRect();
    const name = (el: Element) => el.getAttribute("data-testid") ?? el.tagName.toLowerCase();
    const intersects = (a: DOMRect, b: DOMRect) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    for (const el of root.querySelectorAll("*")) {
      if (!(el instanceof HTMLElement) || !el.getClientRects().length) continue;
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      if (box.top < outer.top - 1 || box.bottom > outer.bottom + 1)
        problems.push(`vertical stage overflow: ${name(el)}`);
      for (let parent = el.parentElement; parent && root.contains(parent); parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.overflowY !== "hidden" && style.overflowY !== "clip") continue;
        const clip = parent.getBoundingClientRect();
        if (box.top < clip.top - 1 || box.bottom > clip.bottom + 1)
          problems.push(`vertical clipping: ${name(el)} in ${name(parent)}`);
      }
    }
    for (const variant of ["card", "compact", "iconOnly"]) {
      const figure = root.querySelector(`[data-testid="drawer-preview-${variant}"]`);
      const figcaption = figure?.querySelector(`[data-testid="drawer-variant-${variant}"]`);
      if (!figure || !figcaption) continue;
      const captionBox = figcaption.getBoundingClientRect();
      // All node descendants, including the absolutely positioned icon caption, must clear the figure caption.
      const node = figure.firstElementChild;
      if (!node) continue;
      for (const el of node.querySelectorAll("*")) {
        const box = el.getBoundingClientRect();
        if (box.width && box.height && intersects(box, captionBox))
          problems.push(`figcaption overlap: ${name(el)} in ${variant}`);
      }
    }
    return problems;
  });
}

/**
 * Nothing in `root` is cut off: no box whose text is wider than it with its overflow hidden, and nothing reaching
 * past `root`'s sides. What's scrolled away vertically (a long menu) is fine.
 */
async function expectNothingCut(root: Locator, label: string, outside: string[] = []) {
  const problems = await root.evaluate((rootEl, allowedOutside) => {
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
      // The AI dock's splitter straddles the canvas edge by four pixels; it has no display text.
      if (allowedOutside.includes(el.dataset.testid ?? "")) continue;
      if (el !== rootEl && box.width > 0 && (box.right > outer.right + 1 || box.left < outer.left - 1))
        out.push(`past the edge: ${name(el)}`);
    }
    return out;
  }, outside);
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
    await expect(page.getByTestId("language-dialog")).toBeVisible({ timeout: pageLoadTimeout() });
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
  test.slow(); // Both the translated page and the cleared app load from scratch.
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

for (const surface of ["command", "context", "rail", "rail-role", "gallery"] as const) {
  test(`successful pending locale load refreshes mounted ${surface} search and labels`, async ({ page }) => {
    await gotoCanvas(page, SLUG);
    if (surface === "gallery") await page.goto("./?view=gallery");
    let release = () => {};
    let asked = false;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(catalogRequest("de"), async (route) => {
      asked = true;
      await held;
      await route.continue();
    });
    try {
      await openLanguage(page);
      await page.getByTestId("language-option-de").click();
      await expect.poll(() => asked).toBe(true);
      await page.keyboard.press("Escape");
      if (surface === "command") {
        await page.getByTestId("canvas-wrap").focus();
        await page.keyboard.press("ControlOrMeta+k");
        await page.getByTestId("command-input").fill(">");
        await expect(page.getByTestId("command-item-action:canvas.fit")).toContainText("Fit view");
      } else if (surface === "context") {
        await page.getByTestId("node-payments").click({ button: "right" });
        await page.getByTestId("context-menu").press("ArrowDown");
        await expect(page.getByTestId("context-menu-item-node.rename")).toHaveAttribute("data-active", "true");
      } else if (surface === "rail" || surface === "rail-role") {
        if ((await page.getByTestId("palette").getAttribute("class"))?.includes("is-collapsed"))
          await page.getByTestId("palette-toggle").click();
        await page
          .getByTestId("palette-search")
          .fill(surface === "rail" ? de["chrome.roundedRectangle"] : de["gallery.store"]);
        await expect(
          page.getByTestId(surface === "rail" ? "palette-annotate-shape-rounded" : "palette-item-postgres"),
        ).toHaveCount(0);
      } else {
        await page.getByTestId("gallery-search").fill(de["gallery.store"]);
        await expect(page.getByTestId("stencil-tile-postgres")).toHaveCount(0);
      }
      release();
      if (surface === "command") {
        await expect(page.getByTestId("command-item-action:canvas.fit")).toContainText(de["menu.fitView"]);
        await expect(page.getByTestId("command-input")).toHaveValue(">");
      } else if (surface === "context") {
        await expect(page.getByTestId("context-menu-item-node.rename")).toContainText(de["library.rename"]);
        await expect(page.getByTestId("context-menu-item-node.rename")).toHaveAttribute("data-active", "true");
      } else if (surface === "rail" || surface === "rail-role") {
        await expect(
          page.getByTestId(surface === "rail" ? "palette-annotate-shape-rounded" : "palette-item-postgres"),
        ).toBeVisible();
        await expect(page.getByTestId("palette-search")).toHaveValue(
          surface === "rail" ? de["chrome.roundedRectangle"] : de["gallery.store"],
        );
        await page.getByTestId("palette-search").fill(de["gallery.store"]);
        await expect(page.getByTestId("palette-item-postgres")).toBeVisible();
      } else {
        await expect(page.getByTestId("stencil-tile-postgres")).toBeVisible();
        await expect(page.getByTestId("gallery-search")).toHaveValue(de["gallery.store"]);
      }
    } finally {
      release();
    }
  });
}

test("RTL quick-add preserves physical placement and expanded chevrons point down", async ({ page }) => {
  await remember(page, "ar");
  await gotoCanvas(page, SLUG);
  await fitDiagram(page);
  await page.getByTestId("node-payments").click();
  await waitForSelectionSettled(page);
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("landing-outline")).toBeVisible();
  await waitForStableViewport(page);
  const outline = await page.getByTestId("landing-outline").boundingBox();
  const menu = await page.getByTestId("quick-add").boundingBox();
  if (!outline || !menu) throw new Error("Missing quick-add geometry");
  expect(menu.x).toBeGreaterThanOrEqual(outline.x + outline.width);
  await page.keyboard.press("Escape");
  if ((await page.getByTestId("palette").getAttribute("class"))?.includes("is-collapsed"))
    await page.getByTestId("palette-toggle").click();
  const head = page.getByTestId("palette-section-messaging");
  if ((await head.getAttribute("aria-expanded")) === "false") await head.click();
  const style = () =>
    head.evaluate((el) => {
      const icon = el.firstElementChild;
      if (!icon) throw new Error("Missing chevron");
      const css = getComputedStyle(icon);
      return { rotate: css.rotate, transform: css.transform };
    });
  await expect.poll(style).toEqual({ rotate: "90deg", transform: "none" });
  await head.click();
  await expect.poll(style).toEqual({ rotate: "0deg", transform: "matrix(-1, 0, 0, 1, 0, 0)" });
});

test("a language arriving during a pending hover still opens that submenu, beside its parent", async ({ page }) => {
  await page.clock.install();
  await gotoCanvas(page, SLUG);
  await waitForStableViewport(page);
  await pauseClock(page);
  let release = () => {};
  let asked = false;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(catalogRequest("ar"), async (route) => {
    asked = true;
    await held;
    await route.continue();
  });
  try {
    await openLanguage(page);
    await page.getByTestId("language-option-ar").click();
    await expect.poll(() => asked).toBe(true);
    await page.keyboard.press("Escape");
    const canvas = page.getByTestId("canvas-wrap");
    await canvas.click({ button: "right", position: { x: 650, y: 90 } });
    // Hover the row (no click) and change language before its delay ends; the pointer then rests (no mouseleave).
    await page.mouse.move(10, 10);
    await page
      .getByTestId("context-menu-item-canvas.annotate")
      .evaluate((el) => el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })));
    const sub = page.getByTestId("context-menu-sub");
    await expect(sub).toHaveCount(0);
    release();
    await expect(page.getByTestId("context-menu-item-canvas.annotate")).toContainText(catalog("ar")["menu.annotate"]);
    // The hover runs on, with the new language's rows: its submenu opens, in RTL beside its parent.
    await page.clock.runFor(200);
    await expect(sub).toBeVisible();
    await expect
      .poll(async () => {
        const parent = await page.getByTestId("context-menu").boundingBox();
        const child = await sub.boundingBox();
        return parent && child ? Math.abs(child.x + child.width - parent.x) : Infinity;
      })
      .toBeLessThan(16);
  } finally {
    release();
  }
});

test("pending RTL locale refresh retains an open submenu beside its parent", async ({ page }) => {
  await page.clock.install();
  await gotoCanvas(page, SLUG);
  await waitForStableViewport(page);
  await pauseClock(page);
  let release = () => {};
  let asked = false;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(catalogRequest("ar"), async (route) => {
    asked = true;
    await held;
    await route.continue();
  });
  try {
    await openLanguage(page);
    await page.getByTestId("language-option-ar").click();
    await expect.poll(() => asked).toBe(true);
    await page.keyboard.press("Escape");
    const canvas = page.getByTestId("canvas-wrap");
    await canvas.click({ button: "right", position: { x: 650, y: 90 } });
    // Queue hover and click in one turn, then change language before the hover
    // deadline. Keep the physical pointer away so a mouseleave cannot cancel it.
    await page.mouse.move(10, 10);
    await page.getByTestId("context-menu-item-canvas.annotate").evaluate((el) => {
      el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const sub = page.getByTestId("context-menu-sub");
    await expect(sub).toBeVisible();
    release();
    await expect(page.getByTestId("context-menu-item-canvas.annotate")).toContainText(catalog("ar")["menu.annotate"]);
    await expect(sub).toBeVisible();
    // A hover queued in LTR must not overwrite the new RTL anchor later.
    await page.clock.runFor(200);
    await expect
      .poll(async () => {
        const parent = await page.getByTestId("context-menu").boundingBox();
        const child = await sub.boundingBox();
        return parent && child ? Math.abs(child.x + child.width - parent.x) : Infinity;
      })
      .toBeLessThan(16);
  } finally {
    release();
  }
});
