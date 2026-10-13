import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Download, FrameLocator, Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors, publicExamples } from "./fixtures";
import { expectPlaying, filePayloadText, hostPage, KAFKA, watchedPage } from "./html-viewer";
import { deflateRaw, textToBytes } from "../../src/interop/codec";
import { encryptBytes } from "../../src/interop/passwordCrypto";

// Interactive HTML export (src/export, docs/INTEROP.md): File ▸ Export as ▸ Interactive HTML… downloads one
// self-contained file. Opened from file:// (and inside an <iframe>, sandboxed or not), it shows the diagram,
// plays its simulations, makes no requests at all, trips no Content-Security-Policy and leaves the browser's
// storage alone. Selectors are data-testid only.

const BANNER = "Confidential: internal use only";
const ANYONE = "Anyone who has this file can open it.";

async function openHtmlExport(page: Page) {
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  await expect(page.getByTestId("file-more-formats-menu")).toBeVisible();
  await page.getByTestId("export-html").click();
  await expect(page.getByTestId("html-export-dialog")).toBeVisible();
}

async function download(page: Page): Promise<{ download: Download; path: string; html: string }> {
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId("html-export-download").click()]);
  const path = test.info().outputPath(file.suggestedFilename());
  await file.saveAs(path);
  return { download: file, path, html: readFileSync(path, "utf8") };
}

test.describe("Interactive HTML export", () => {
  test("exports the Kafka example as one file that plays offline, with zero requests", async ({
    page,
    context,
    consoleErrors,
  }) => {
    test.setTimeout(90_000);
    await gotoCanvas(page, KAFKA);
    await openHtmlExport(page);
    await expect(page.getByTestId("html-export-anyone")).toContainText(ANYONE);
    await expect(page.getByTestId("html-export-summary")).toContainText("plays “Black Friday");
    // Options: a banner; the rest stays as it is (both simulations, the first plays).
    await page.getByTestId("html-export-options-toggle").click();
    await page.getByTestId("html-export-banner").fill(BANNER);
    const { download: file, path, html } = await download(page);
    expect(file.suggestedFilename()).toBe("Kafka order pipeline.html");
    await expect(page.getByTestId("toast").last()).toContainText("Anyone who has it can open it");

    // One file: the viewer, the diagram, and only the icons it uses.
    expect(html).toContain('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'');
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toContain("unsafe-inline");
    expect(html).not.toMatch(/<script[^>]+\bsrc=|<link[^>]+stylesheet/);
    expect(html).toContain("<title>Kafka order pipeline</title>");

    // Opened from disk.
    const url = pathToFileURL(path).href;
    const viewer = await watchedPage(context);
    await viewer.page.goto(url);
    await expectPlaying(viewer.page);
    await expect(viewer.page.getByTestId("viewer-banner")).toHaveText(BANNER);
    await expect(viewer.page.getByTestId("viewer-footer")).toContainText("Exported from Live Diagrams on");
    // Keyboard: zoom and fit have names and keys.
    await expect(viewer.page.getByTestId("viewer-zoom-in")).toHaveAccessibleName("Zoom in");
    await expect(viewer.page.getByTestId("live-play")).toHaveAccessibleName(/Pause|Play/);

    // Nothing but the file itself: no fonts, no icons, no site, no favicon.
    expect(viewer.requests.filter((r) => !r.startsWith("data:"))).toEqual([url]);
    expect(await viewer.page.evaluate(() => window.__violations ?? [])).toEqual([]);
    expect(viewer.errors).toEqual([]);
    await viewer.page.close();
    expectNoErrors(consoleErrors);
  });

  test("the file plays inside an <iframe> too, still with zero requests", async ({ page, context }) => {
    test.setTimeout(90_000);
    await gotoCanvas(page, KAFKA);
    await openHtmlExport(page);
    const { path } = await download(page);
    const hostUrl = hostPage(path);
    const viewer = await watchedPage(context);
    await viewer.page.goto(hostUrl);
    await expectPlaying(viewer.page.frameLocator('[data-testid="frame"]'));
    expect(viewer.requests.filter((r) => !r.startsWith("data:"))).toEqual([hostUrl, pathToFileURL(path).href]);
    const inner = viewer.page.frames().find((f) => f !== viewer.page.mainFrame());
    expect(await inner?.evaluate(() => window.__violations ?? [])).toEqual([]);
    expect(viewer.errors).toEqual([]);
    await viewer.page.close();
  });

  test("plays in a sandboxed iframe, where storage is denied", async ({ page, context }) => {
    test.setTimeout(90_000);
    await gotoCanvas(page, KAFKA);
    await openHtmlExport(page);
    const { path } = await download(page);
    // allow-scripts without allow-same-origin: an opaque origin, where any storage access throws.
    const hostUrl = hostPage(path, "allow-scripts");
    const viewer = await watchedPage(context);
    await viewer.page.goto(hostUrl);
    await expectPlaying(viewer.page.frameLocator('[data-testid="frame"]'));
    const inner = viewer.page.frames().find((f) => f !== viewer.page.mainFrame());
    expect(await inner?.evaluate(() => window.__realStorage === undefined)).toBe(true);
    expect(await inner?.evaluate(() => window.__violations ?? [])).toEqual([]);
    expect(viewer.requests.filter((r) => !r.startsWith("data:"))).toEqual([hostUrl, pathToFileURL(path).href]);
    expect(viewer.errors).toEqual([]);
    await viewer.page.close();
  });

  test("leaves the reader's storage alone, and the reader's preferences out", async ({ page, context }) => {
    test.setTimeout(90_000);
    // A diagram with dependency edges (config, secret, identity, telemetry), exported light.
    await gotoCanvas(page, "aks-app-config-key-vault");
    await openHtmlExport(page);
    await page.getByTestId("html-export-options-toggle").click();
    await page.getByTestId("html-export-theme-light").click();
    const { path } = await download(page);

    // The reader's own file:// storage: a sentinel, dependencies hidden and a dark theme, in the app's keys.
    const seeded = {
      sentinel: "kept",
      "diagrams.showDependencies.v1": "0",
      "diagrams.settings.v1": JSON.stringify({ theme: "dark" }),
    };
    const seedFile = join(dirname(path), "seed.html");
    writeFileSync(seedFile, "<!doctype html><title>Seed</title>");
    const viewer = await watchedPage(context);
    await viewer.page.goto(pathToFileURL(seedFile).href);
    await viewer.page.evaluate((entries) => {
      for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
      sessionStorage.setItem("session-sentinel", "kept");
    }, seeded);

    await viewer.page.goto(pathToFileURL(path).href);
    await expect(viewer.page.getByTestId("html-viewer")).toBeVisible();
    // The file's choices, not the reader's: the dependency edges drawn, the exported theme.
    await expect(viewer.page.getByTestId("edge-glyph-api-to-appcfg")).toBeVisible();
    await expect(viewer.page.locator("html")).toHaveAttribute("data-theme", "light");
    // Interact: zoom, fit, and live (its first simulation plays at once) off and on again.
    await viewer.page.getByTestId("viewer-zoom-in").click();
    await viewer.page.getByTestId("viewer-fit").click();
    await expect(viewer.page.getByTestId("live-controls")).toBeVisible();
    await viewer.page.getByTestId("live-toggle").click();
    await expect(viewer.page.getByTestId("live-controls")).toHaveCount(0);
    await viewer.page.getByTestId("live-toggle").click();
    await expect(viewer.page.getByTestId("live-controls")).toBeVisible();

    const real = await viewer.page.evaluate(() => {
      const dump = (s?: Storage) => {
        if (!s) return null;
        const out: Record<string, string | null> = {};
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i);
          if (k !== null) out[k] = s.getItem(k);
        }
        return out;
      };
      return { local: dump(window.__realStorage), session: dump(window.__realSession) };
    });
    expect(real.local).toEqual(seeded);
    expect(real.session).toEqual({ "session-sentinel": "kept" });
    expect(viewer.errors).toEqual([]);
    await viewer.page.close();
  });

  test("a Private diagram can be exported, and the dialog says who can open the file", async ({ page }) => {
    await gotoCanvas(page, KAFKA);
    await page.getByTestId("import-input").setInputFiles({
      name: "work.diagram.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          format: "diagrams/v1",
          title: "Ledger flow",
          private: true,
          nodes: [
            { id: "intake", stencil: "generic.service", label: "Intake service", x: 0, y: 0 },
            { id: "ledger", stencil: "postgres", label: "Ledger", x: 320, y: 0 },
          ],
          edges: [{ id: "intake-to-ledger", from: "intake", to: "ledger" }],
        }),
      ),
    });
    await expect(page.getByTestId("diagram-title")).toHaveText("Ledger flow");
    await expect(page.getByTestId("private-badge")).toBeVisible();
    await openHtmlExport(page);
    await expect(page.getByTestId("html-export-anyone")).toContainText(ANYONE);
    // Options: the title, and the theme by keyboard (a radio group: one Tab stop, arrow keys select).
    await page.getByTestId("html-export-options-toggle").click();
    await page.getByTestId("html-export-title").fill("Ledger flow (team copy)");
    const light = page.getByTestId("html-export-theme-light");
    const dark = page.getByTestId("html-export-theme-dark");
    await light.click();
    await light.focus();
    await expect(light).toHaveAttribute("tabindex", "0");
    await expect(dark).toHaveAttribute("tabindex", "-1");
    await page.keyboard.press("ArrowRight");
    await expect(dark).toBeFocused();
    await expect(dark).toHaveAttribute("aria-checked", "true");
    const { download: file, html } = await download(page);
    expect(file.suggestedFilename()).toBe("Ledger flow (team copy).html");
    expect(html).toContain('<html lang="en" data-theme="dark">');
    expect(html).toContain("Intake service");
  });

  test("Ctrl+K finds it", async ({ page }) => {
    await gotoCanvas(page, KAFKA);
    await page.getByTestId("canvas-view").click({ position: { x: 600, y: 40 } });
    await page.keyboard.press("Control+k");
    await page.getByTestId("command-input").fill("interactive html");
    await page.getByTestId("command-item-action:export:html").click();
    await expect(page.getByTestId("html-export-dialog")).toBeVisible();
  });
});

// Require a password (src/export/lock.ts): the file carries the payload encrypted with password links' crypto and
// nothing of the diagram in the clear; opened from file://, it asks for the password, says when it's wrong, then
// decrypts in the page and plays, still with zero requests and no CSP violations.
test.describe("Interactive HTML with a password", () => {
  const PASSWORD = "plum orbit lantern 42";
  const WRONG = "plum orbit lantern 24";
  /** The neutral title and a random suffix: nothing from the diagram, never the same twice. */
  const LOCKED_NAME = /^Diagram \(password protected\) [a-z2-9]{5}\.html$/;

  /** Turns Require a password on and types `password`, checking the field as the password link's dialog has it. */
  async function requirePassword(page: Page, password: string) {
    await expect(page.getByTestId("html-export-password-toggle")).not.toBeChecked();
    await page.getByTestId("html-export-password-toggle").check();
    // The keyboard is in the field, and the dialog now says who can open the file.
    await expect(page.getByTestId("html-export-password-input")).toBeFocused();
    await expect(page.getByTestId("html-export-protected")).toContainText("Only people with the password can open it.");
    await expect(page.getByTestId("html-export-protected")).toContainText("Send the password separately");
    await expect(page.getByTestId("html-export-anyone")).toHaveCount(0);
    await expect(page.getByTestId("html-export-password-note")).toContainText("can’t be recovered");
    // Too short: no download yet. The same hint and Show as Copy link with password….
    await page.getByTestId("html-export-password-input").fill("short");
    await expect(page.getByTestId("html-export-password-strength")).toHaveAttribute("data-level", "short");
    await expect(page.getByTestId("html-export-download")).toBeDisabled();
    await page.getByTestId("html-export-password-input").fill(password);
    await expect(page.getByTestId("html-export-password-strength")).not.toHaveAttribute("data-level", "short");
    await page.getByTestId("html-export-password-show").check();
    await expect(page.getByTestId("html-export-password-input")).toHaveAttribute("type", "text");
    await page.getByTestId("html-export-password-show").uncheck();
    await expect(page.getByTestId("html-export-password-input")).toHaveAttribute("type", "password");
    await expect(page.getByTestId("html-export-download")).toBeEnabled();
  }

  /** The prompt: a wrong password first (said, kept and selected to fix), then the right one, by keyboard. */
  async function unlock(scope: Page | FrameLocator, keyboard: Page["keyboard"]) {
    await expect(scope.getByTestId("html-viewer-locked")).toBeVisible();
    const input = scope.getByTestId("viewer-password-input");
    await expect(input).toBeFocused();
    await expect(scope.getByTestId("viewer-password-submit")).toBeDisabled();
    await keyboard.type(WRONG);
    await keyboard.press("Enter");
    await expect(scope.getByTestId("viewer-password-error")).toHaveText(
      "That password doesn't open this file. Check it and try again.",
      { timeout: 15_000 },
    );
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toBeFocused();
    // The selection comes a frame after the message: wait for it before typing over it.
    await expect
      .poll(() => input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]))
      .toEqual([0, WRONG.length]);
    // Typing replaces the selection and clears the message.
    await keyboard.type(PASSWORD);
    await expect(scope.getByTestId("viewer-password-error")).toHaveCount(0);
    await keyboard.press("Enter");
    await expect(scope.getByTestId("html-viewer")).toBeVisible({ timeout: 15_000 });
    await expect(scope.getByTestId("html-viewer-locked")).toHaveCount(0);
    // The keyboard moves on to the diagram (named for it), so the arrow keys pan at once.
    await expect(scope.getByTestId("viewer-canvas")).toBeFocused();
  }

  test("exports the Kafka example encrypted, and opens it from file:// with the password", async ({
    page,
    context,
    consoleErrors,
  }) => {
    test.setTimeout(90_000);
    await gotoCanvas(page, KAFKA);
    await openHtmlExport(page);
    await page.getByTestId("html-export-options-toggle").click();
    await page.getByTestId("html-export-banner").fill(BANNER);
    await requirePassword(page, PASSWORD);
    const { download: file, path, html } = await download(page);
    // Named and titled for nothing in it.
    expect(file.suggestedFilename()).toMatch(LOCKED_NAME);
    await expect(page.getByTestId("toast").last()).toContainText("Only people with the password can open it");

    // Nothing of the diagram in the clear: not its title, banner, node or simulation names, or the icons it uses.
    expect(html).toContain("<title>Diagram (password protected)</title>");
    const block = filePayloadText(html);
    expect(Object.keys(JSON.parse(block)).sort()).toEqual(["encrypted", "theme", "version"]);
    // (Whole titles and words: the viewer's own code says "Black Friday" for a capacity preset.)
    for (const text of ["Kafka order pipeline", BANNER, "Black Friday: 2,000 orders/s", "Payments is offline"])
      expect(html.includes(text), text).toBe(false);
    for (const text of ["black-friday", "payments-outage", "data:image"])
      expect(block.includes(text), text).toBe(false);
    for (const id of publicExamples.find((e) => e.slug === KAFKA)?.nodeIds ?? [])
      expect(block.includes(id), id).toBe(false);
    // The same strict page: its policy and script are the template's.
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toContain("unsafe-inline");

    const url = pathToFileURL(path).href;
    const viewer = await watchedPage(context);
    await viewer.page.goto(url);
    // WebCrypto runs from file:// (a secure context in Chromium).
    expect(await viewer.page.evaluate(() => window.isSecureContext && !!crypto.subtle)).toBe(true);
    await expect(viewer.page.getByTestId("viewer-footer")).toContainText("Exported from Live Diagrams");
    await unlock(viewer.page, viewer.page.keyboard);
    await expectPlaying(viewer.page);
    await expect(viewer.page.getByTestId("viewer-banner")).toHaveText(BANNER);
    await expect(viewer.page.getByTestId("viewer-footer")).toContainText("Exported from Live Diagrams on");
    // The real title, once unlocked, in this tab only.
    await expect(viewer.page).toHaveTitle("Kafka order pipeline");

    expect(viewer.requests.filter((r) => !r.startsWith("data:"))).toEqual([url]);
    expect(await viewer.page.evaluate(() => window.__violations ?? [])).toEqual([]);
    expect(viewer.errors).toEqual([]);
    await viewer.page.close();

    // The right password, but what it decrypts to isn't a payload: the prompt says the file is damaged, never a blank
    // or broken page.
    const sealed = await encryptBytes(await deflateRaw(textToBytes("{ not json")), PASSWORD);
    const damagedPath = test.info().outputPath("damaged-locked.html");
    writeFileSync(
      damagedPath,
      html.replace(/"encrypted":"[^"]+"/, () => `"encrypted":"${sealed}"`),
    );
    const damaged = await watchedPage(context);
    await damaged.page.goto(pathToFileURL(damagedPath).href);
    await damaged.page.getByTestId("viewer-password-input").fill(PASSWORD);
    await damaged.page.getByTestId("viewer-password-input").press("Enter");
    await expect(damaged.page.getByTestId("viewer-password-error")).toHaveText(
      "This file's diagram is damaged. Export it again from Live Diagrams.",
      { timeout: 15_000 },
    );
    await expect(damaged.page.getByTestId("viewer-lock")).toBeVisible();
    expect(damaged.errors).toEqual([]);
    await damaged.page.close();

    // Where the browser has no WebCrypto (a page on plain http://), the prompt says so before asking.
    const insecure = await context.newPage();
    await insecure.addInitScript(() => Object.defineProperty(crypto, "subtle", { value: undefined }));
    await insecure.goto(url);
    await expect(insecure.getByTestId("viewer-password-unsupported")).toContainText("open it from disk");
    await insecure.getByTestId("viewer-password-input").fill(PASSWORD);
    await expect(insecure.getByTestId("viewer-password-submit")).toBeDisabled();
    await insecure.close();
    expectNoErrors(consoleErrors);
  });

  test("a Private diagram exports with a password, and unlocks in a sandboxed iframe too", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    await gotoCanvas(page, KAFKA);
    await page.getByTestId("import-input").setInputFiles({
      name: "work.diagram.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          format: "diagrams/v1",
          title: "Ledger flow",
          private: true,
          nodes: [
            { id: "intake", stencil: "generic.service", label: "Intake service", x: 0, y: 0 },
            { id: "ledger", stencil: "postgres", label: "Ledger", x: 320, y: 0 },
          ],
          edges: [{ id: "intake-to-ledger", from: "intake", to: "ledger", label: "Post entries" }],
        }),
      ),
    });
    await expect(page.getByTestId("diagram-title")).toHaveText("Ledger flow");
    await expect(page.getByTestId("private-badge")).toBeVisible();
    // Private changes nothing here: the export is on, with or without a password.
    await openHtmlExport(page);
    await requirePassword(page, PASSWORD);
    // Enter in the field downloads.
    const [file] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("html-export-password-input").press("Enter"),
    ]);
    expect(file.suggestedFilename()).toMatch(LOCKED_NAME);
    // Another protected export gets a name of its own: downloads to one folder never meet.
    await openHtmlExport(page);
    await page.getByTestId("html-export-password-toggle").check();
    await page.getByTestId("html-export-password-input").fill(PASSWORD);
    const again = await download(page);
    expect(again.download.suggestedFilename()).toMatch(LOCKED_NAME);
    expect(again.download.suggestedFilename()).not.toBe(file.suggestedFilename());
    const path = test.info().outputPath("private-locked.html");
    await file.saveAs(path);
    const html = readFileSync(path, "utf8");
    for (const text of ["Ledger", "Intake", "intake", "Post entries"]) expect(html.includes(text), text).toBe(false);
    // Not even that it's private (the viewer's own code names the field).
    expect(filePayloadText(html)).not.toContain("private");

    // Framed by a host page that sandboxes it (allow-scripts only: an opaque origin, no storage), as a wiki might.
    const hostUrl = hostPage(path, "allow-scripts");
    const viewer = await watchedPage(context);
    await viewer.page.goto(hostUrl);
    const frame = viewer.page.frameLocator('[data-testid="frame"]');
    await frame.getByTestId("viewer-password-input").click();
    await unlock(frame, viewer.page.keyboard);
    await expect(frame.getByTestId("node-intake")).toBeVisible();
    await expect(frame.getByTestId("node-ledger")).toBeVisible();
    const inner = viewer.page.frames().find((f) => f !== viewer.page.mainFrame());
    expect(await inner?.evaluate(() => window.__violations ?? [])).toEqual([]);
    expect(viewer.requests.filter((r) => !r.startsWith("data:"))).toEqual([hostUrl, pathToFileURL(path).href]);
    expect(viewer.errors).toEqual([]);
    await viewer.page.close();
  });
});
