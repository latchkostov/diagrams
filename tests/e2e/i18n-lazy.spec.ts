import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import en from "../../src/i18n/en";
import { planningP3Fixture } from "../../src/lab/planningP3Fixture";
import { test, expect, gotoCanvas, STORAGE_KEYS, waitForStableViewport } from "./fixtures";
import { holdChunk } from "./chunk";
import { openSurface } from "./lazy-surface-helpers";
import { catalogRequest as catalog } from "../../scripts/e2e-catalog";

const translations = (code: string) =>
  JSON.parse(readFileSync(`src/i18n/locales/${code}.json`, "utf8")) as Record<string, string>;

for (const code of ["de", "ar", "ru"]) {
  test(`${code}: first canvas renders while every optional catalog is held`, async ({ page }) => {
    await page.addInitScript((locale) => localStorage.setItem("diagrams.locale", locale), code);
    const held = await holdChunk(page, catalog(code, "tutorials|tutorialTitles|stencils|simulation|exports|ai"));
    try {
      await gotoCanvas(page, "kafka-order-pipeline");
      const words = JSON.parse(readFileSync(`src/i18n/locales/${code}.json`, "utf8")) as Record<string, string>;
      await expect(page.getByTestId("file-button")).toContainText(words["file.menu"]);
      expect(await page.evaluate(() => document.documentElement.lang)).toBe(code);
      await page.getByTestId("view-button").click();
      await expect(page.getByTestId("theme-toggle")).toContainText(words["htmlExport.theme"]);
      await page.getByTestId("theme-toggle").hover();
      await expect(page.getByTestId("theme-light")).toContainText(words["htmlExport.light"]);
      await expect(page.getByTestId("theme-dark")).toContainText(words["htmlExport.dark"]);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.getByTestId("node-orders").click();
      await expect(page.getByTestId("dock-tab-ai")).toContainText(words["ai.aI"]);
    } finally {
      held.release();
    }
  });
}

const cases = [
  { id: "tutorial.app", bucket: "tutorials", pending: "tutorial-app-loading", ready: "tutorial-start" },
  { id: "canvas.stencils", bucket: "stencils", pending: "palette-loading", ready: "palette-item-generic.database" },
  {
    id: "inspector.simulation",
    bucket: "simulation",
    pending: "inspector.simulation-loading",
    ready: "inspector-section-node-simulation",
  },
] as const;
for (const code of ["de", "ar"]) {
  const words = JSON.parse(readFileSync(`src/i18n/locales/${code}.json`, "utf8")) as Record<string, string>;
  for (const surface of cases) {
    test(`${code}: ${surface.id} holds its catalog, recovers with Retry and preserves interaction`, async ({
      page,
    }) => {
      await page.addInitScript((locale) => localStorage.setItem("diagrams.locale", locale), code);
      const held = await holdChunk(page, catalog(code, surface.bucket));
      try {
        await openSurface(page, surface.id);
        await expect.poll(held.requested).toBe(true);
        await expect(page.getByTestId(surface.pending)).toBeVisible();
        await expect(page.getByTestId(surface.ready)).toHaveCount(0);
        await expect(page.getByTestId(surface.pending)).toContainText(
          words[surface.id === "tutorial.app" ? "tutorials.loading" : "common.loading"],
        );
        expect(await page.evaluate(() => document.documentElement.dir)).toBe(code === "ar" ? "rtl" : "ltr");
        expect(await page.evaluate(() => getComputedStyle(document.body).cursor)).not.toMatch(/wait|progress/);
        if (surface.id === "canvas.stencils") {
          await page.getByTestId("palette-toggle").click();
          await page.getByTestId("palette-search").fill("generic.database");
          await expect(page.getByTestId("palette-search")).toBeFocused();
        }
        if (surface.id === "inspector.simulation") {
          await expect(page.getByTestId("inspector-field-label")).toBeFocused();
          await page.getByTestId("inspector-field-label").fill("Caller translated later");
          await expect(page.getByTestId("node-caller")).toContainText("Caller translated later");
        }
        if (code === "de" && surface.id === "canvas.stencils") {
          await page.getByTestId("file-button").click();
          await page.getByTestId("file-more-formats").click();
          await page.getByTestId("export-image").click();
          await page.getByTestId("image-options-toggle").click();
          await page.getByTestId("image-format-svg").click();
          const download = page.waitForEvent("download");
          await page.getByTestId("image-export").click();
          const svg = await download;
          expect(svg.suggestedFilename()).toMatch(/\.svg$/);
          expect(await svg.failure()).toBeNull();
          await page.keyboard.press("Escape");
        }
        // These optional editing surfaces never block image export/recording readiness.
        await page.evaluate(async () => {
          await window.__lazySurfaces?.ensureLoaded();
        });
        held.fail = true;
        held.release();
        await expect(page.getByTestId("lazy-load-retry")).toBeVisible();
        await expect(page.getByTestId("lazy-load-retry")).toHaveText(words["common.retry"]);
        await expect(page.getByTestId("toast").filter({ has: page.getByTestId("lazy-load-retry") })).toContainText(
          words["ai.loadFailed"],
        );
        await expect(page.getByTestId(surface.ready)).toHaveCount(0);
        held.fail = false;
        await page.getByTestId("lazy-load-retry").click();
        await expect(page.getByTestId(surface.ready)).toBeVisible();
        await expect(page.getByTestId(surface.pending)).toHaveCount(0);
        if (surface.id === "canvas.stencils") {
          await expect(page.getByTestId(surface.ready)).toContainText(words["stencil.genericDatabaseName"]);
          await expect(page.getByTestId(surface.ready)).toHaveAttribute(
            "title",
            `${words["stencil.genericDatabaseName"]} (${words["stencil.vendorGeneric"]})\n${words["stencil.genericDatabaseDescription"]}`,
          );
          await expect(page.getByTestId("palette-search")).toHaveValue("generic.database");
          await expect(page.getByTestId("palette-search")).toBeFocused();
        } else if (surface.id === "tutorial.app") {
          await expect(page.getByTestId("tutorial-app")).toContainText(words["tutorials.mobileApi.title"]);
          await expect(page.getByTestId("tutorial-start")).toBeFocused();
        } else {
          await expect(page.getByTestId(surface.ready)).toContainText(
            words["inspector.simulation"] ?? en["inspector.simulation"],
          );
          await expect(page.getByTestId("inspector-field-label")).toHaveValue("Caller translated later");
          // R-c7c8e8fd1b: the deferred catalog's own field labels, not just the core section title.
          const concurrency = page.getByTestId("inspector-unit-concurrency");
          if (!(await concurrency.isVisible())) await page.getByTestId("inspector-section-node-simulation").click();
          await expect(concurrency).toContainText(words["inspector.concurrency"] ?? en["inspector.concurrency"]);
          if (code === "ar") expect(words["inspector.concurrency"]).not.toBe(en["inspector.concurrency"]);
        }
      } finally {
        held.release();
      }
    });
  }
}

for (const code of ["de", "ar"]) {
  const words = JSON.parse(readFileSync(`src/i18n/locales/${code}.json`, "utf8")) as Record<string, string>;
  for (const surface of ["gallery", "commands"] as const) {
    test(`${code}: ${surface} retries a failed catalog without reloading the page`, async ({ page }) => {
      await page.addInitScript((locale) => localStorage.setItem("diagrams.locale", locale), code);
      const held = await holdChunk(page, catalog(code, "stencils"));
      try {
        if (surface === "gallery") await page.goto("./?view=gallery");
        else {
          await gotoCanvas(page, "kafka-order-pipeline");
          await page.keyboard.press("ControlOrMeta+k");
        }
        await expect.poll(held.requested).toBe(true);
        const pending = surface === "gallery" ? "view-loading" : "lazy-dialog-loading";
        const retry = surface === "gallery" ? "view-load-retry" : "lazy-dialog-retry";
        await expect(page.getByTestId(pending)).toContainText(words["common.loading"]);
        held.fail = true;
        held.release();
        await expect(page.getByTestId(retry)).toHaveText(words["common.retry"]);
        await expect(page.getByTestId(surface === "gallery" ? "view-loading" : "lazy-dialog-error")).toContainText(
          words["fileDialog.loadFailed"],
        );
        held.fail = false;
        if (surface === "commands") {
          await page.getByTestId(retry).focus();
          await page.keyboard.press("Enter");
        } else await page.getByTestId(retry).click();
        if (surface === "gallery") {
          await page.getByTestId("gallery-search").fill("generic.database");
          await expect(page.getByTestId("stencil-tile-generic.database")).toContainText(
            words["stencil.genericDatabaseDescription"],
          );
        } else {
          await expect(page.getByTestId("command-input")).toBeFocused();
          await page.getByTestId("command-input").fill("generic.database");
          await expect(page.getByTestId("command-palette")).toContainText(words["stencil.genericDatabaseName"]);
        }
        await expect(page.getByTestId(retry)).toHaveCount(0);
      } finally {
        held.release();
      }
    });
  }
  test(`${code}: command discovery leaves lesson translations deferred`, async ({ page }) => {
    await page.addInitScript((locale) => localStorage.setItem("diagrams.locale", locale), code);
    const lessons = await holdChunk(page, catalog(code, "tutorials"));
    try {
      await gotoCanvas(page, "kafka-order-pipeline");
      await page.keyboard.press("ControlOrMeta+k");
      await expect(page.getByTestId("command-input")).toBeFocused();
      await page.getByTestId("command-input").fill(words["tutorials.mobileApi.title"]);
      await expect(page.getByTestId("command-palette")).toContainText(
        words["tutorials.command"].replace("{title}", words["tutorials.mobileApi.title"]),
      );
      expect(lessons.requested()).toBe(false);
    } finally {
      lessons.release();
    }
  });
}

// R-2a2de5cb73: quick-add and Change stencil rank translated stencil descriptions, so their search waits for them.
for (const code of ["de", "ar"]) {
  const words = translations(code);
  for (const menu of ["quick-add", "stencil-picker"] as const) {
    test(`${code}: ${menu} search waits for stencil metadata, recovers with Retry and finds by description`, async ({
      page,
    }) => {
      await page.addInitScript((locale) => localStorage.setItem("diagrams.locale", locale), code);
      const held = await holdChunk(page, catalog(code, "stencils"));
      try {
        await gotoCanvas(page, "kafka-order-pipeline");
        await waitForStableViewport(page);
        await page.getByTestId("node-payments").click();
        if (menu === "quick-add") await page.keyboard.press("Alt+ArrowRight");
        else await page.getByTestId("inspector-field-stencil").click();
        const search = page.getByTestId(`${menu}-search`);
        await expect(search).toBeFocused();
        await expect.poll(held.requested).toBe(true);
        const description = words["stencil.genericDatabaseDescription"];
        await search.fill(description);
        const row = page.getByTestId(
          `context-menu-item-${menu === "quick-add" ? "quick-add" : "pick-stencil"}:generic.database`,
        );
        await expect(page.getByTestId(`${menu}-search-loading`)).toHaveText(words["common.loading"]);
        await expect(row).toHaveCount(0);
        await expect(page.getByTestId(menu)).not.toContainText(words["menu.noMatches"] ?? en["menu.noMatches"]);
        held.fail = true;
        held.release();
        await expect(page.getByTestId(`${menu}-search-retry`)).toHaveText(words["common.retry"]);
        await expect(page.getByTestId(`${menu}-search-failed`)).toContainText(words["fileDialog.loadFailed"]);
        await expect(row).toHaveCount(0);
        held.fail = false;
        await expect(search).toBeFocused();
        await search.press("Enter");
        await expect(row).toBeVisible();
        await expect(row).toContainText(words["stencil.genericDatabaseName"]);
        await expect(page.getByTestId(`${menu}-search-loading`)).toHaveCount(0);
        await expect(search).toHaveValue(description);
      } finally {
        held.release();
      }
    });
  }
}

// R-5361b25fac: planning controls share "Advanced" with the inspector and Live; it never waits for the AI catalog.
for (const code of ["de", "ar"]) {
  const words = translations(code);
  test(`${code}: planning controls are translated while the AI catalog is held`, async ({ page }) => {
    const d = planningP3Fixture("stripe");
    await page.addInitScript(
      ({ key, d, locale }) => {
        localStorage.setItem(key, JSON.stringify(d));
        localStorage.setItem("diagrams.locale", locale);
        localStorage.setItem("diagrams.inspector.open.v1", JSON.stringify({ "node-simulation": true }));
      },
      { key: STORAGE_KEYS.autosavePrefix + "kafka-order-pipeline", d, locale: code },
    );
    const ai = await holdChunk(page, catalog(code, "ai"));
    const simulation = await holdChunk(page, catalog(code, "simulation"));
    try {
      await gotoCanvas(page, "kafka-order-pipeline");
      await waitForStableViewport(page);
      await page.getByTestId("node-api").click();
      await expect.poll(simulation.requested).toBe(true);
      await expect(page.getByTestId("admission-advanced-toggle")).toHaveCount(0);
      simulation.release();
      await expect(page.getByTestId("admission-advanced-toggle")).toContainText(words["ai.advanced"]);
      expect(words["ai.advanced"]).not.toBe(en["ai.advanced"]);
      await expect(page.getByTestId("admission-rate")).toBeVisible();
    } finally {
      simulation.release();
      ai.release();
    }
  });
}

// R-49ad249fb4: while the palette's catalogs download, its loading dialog's Close works from the keyboard.
for (const code of ["de", "ar"]) {
  for (const key of ["Enter", "Space"] as const) {
    test(`${code}: the loading command palette closes with ${key} on Close, and never runs a command`, async ({
      page,
    }) => {
      await page.addInitScript((locale) => localStorage.setItem("diagrams.locale", locale), code);
      const held = await holdChunk(page, catalog(code, "stencils"));
      try {
        await gotoCanvas(page, "kafka-order-pipeline");
        await page.getByTestId("canvas-wrap").focus();
        const before = page.url();
        await page.keyboard.press("ControlOrMeta+k");
        await expect(page.getByTestId("lazy-dialog-loading")).toBeVisible();
        await expect.poll(held.requested).toBe(true);
        const close = page.getByTestId("lazy-dialog-close");
        for (let i = 0; i < 4 && !(await close.evaluate((el) => el === document.activeElement)); i++)
          await page.keyboard.press("Tab");
        await expect(close).toBeFocused();
        await page.keyboard.press(key);
        await expect(page.getByTestId("lazy-dialog")).toHaveCount(0);
        held.release();
        await page.evaluate(async () => {
          await window.__lazySurfaces?.ensureLoaded();
        });
        await expect(page.getByTestId("command-palette")).toHaveCount(0);
        await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
        expect(page.url()).toBe(before);
        // The palette released its capture: it opens again and takes typing.
        await page.keyboard.press("ControlOrMeta+k");
        await expect(page.getByTestId("command-input")).toBeFocused();
      } finally {
        held.release();
      }
    });
  }
}

// R-772d092ba0: a surface waiting on the old language's catalog follows a language switch, and never hangs or fails.
async function chooseLanguage(page: Page, code: string) {
  await page.getByTestId("view-button").click();
  await page.getByTestId("view-language").click();
  await page.getByTestId(`language-option-${code}`).click();
  await expect(page.getByTestId(`language-option-${code}`)).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("language-done").click();
}
for (const [from, to] of [
  ["de", "en"],
  ["de", "ar"],
  ["ar", "de"],
] as const) {
  test(`${from} to ${to}: a simulation section held on the old catalog follows the switch and ignores that request's failure`, async ({
    page,
  }) => {
    await page.addInitScript((locale) => localStorage.setItem("diagrams.locale", locale), from);
    const held = await holdChunk(page, catalog(from, "simulation"));
    try {
      await openSurface(page, "inspector.simulation");
      await expect.poll(held.requested).toBe(true);
      await expect(page.getByTestId("inspector.simulation-loading")).toBeVisible();
      await chooseLanguage(page, to);
      expect(await page.evaluate(() => document.documentElement.lang)).toBe(to);
      await expect(page.getByTestId("inspector-section-node-simulation")).toBeVisible();
      await expect(page.getByTestId("inspector.simulation-loading")).toHaveCount(0);
      const words: Record<string, string | undefined> = to === "en" ? en : translations(to);
      const concurrency = page.getByTestId("inspector-unit-concurrency");
      if (!(await concurrency.isVisible())) await page.getByTestId("inspector-section-node-simulation").click();
      await expect(concurrency).toContainText(words["inspector.concurrency"] ?? en["inspector.concurrency"]);
      held.fail = true;
      held.release();
      await page.evaluate(async () => {
        await window.__lazySurfaces?.ensureLoaded();
      });
      await expect(page.getByTestId("lazy-load-retry")).toHaveCount(0);
      await expect(page.getByTestId("inspector-section-node-simulation")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.lang)).toBe(to);
    } finally {
      held.release();
    }
  });
}
