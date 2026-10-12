import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { BrowserContext, Download, FrameLocator, Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors, publicExamples } from "./fixtures";

// Interactive HTML export (src/export, docs/INTEROP.md): File ▸ Export as ▸ Interactive HTML… downloads one
// self-contained file. Opened from file:// (and inside an <iframe>, sandboxed or not), it shows the diagram,
// plays its simulations, makes no requests at all, trips no Content-Security-Policy and leaves the browser's
// storage alone. Selectors are data-testid only.

const KAFKA = "kafka-order-pipeline";
const kafkaNodes = publicExamples.find((e) => e.slug === KAFKA)?.nodeIds ?? [];
const BANNER = "Confidential: internal use only";
const ANYONE = "Anyone who has this file can open it.";

declare global {
  interface Window {
    __violations?: string[];
    /** The browser's own stores, kept before the viewer swaps in its in-memory ones (absent where denied). */
    __realStorage?: Storage;
    __realSession?: Storage;
  }
}

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

/** A fresh tab that records every request it makes, its CSP violations and its console errors. */
async function watchedPage(context: BrowserContext) {
  const page = await context.newPage();
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("console", (m) => {
    if (m.type() === "error" || /Content Security Policy|Refused to/i.test(m.text()))
      errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await page.addInitScript(() => {
    const seen: string[] = (window.__violations = []);
    document.addEventListener("securitypolicyviolation", (e) =>
      seen.push(`${e.effectiveDirective} blocked ${e.blockedURI || "(inline)"}`),
    );
    // A sandboxed frame (an opaque origin) throws on any storage access.
    try {
      window.__realStorage = window.localStorage;
      window.__realSession = window.sessionStorage;
    } catch {
      // Denied: the viewer must cope.
    }
  });
  return { page, requests, errors };
}

/** A local page that frames the file, as SharePoint or Confluence would. */
function hostPage(file: string, sandbox?: string) {
  const host = join(dirname(file), sandbox ? "host-sandboxed.html" : "host.html");
  const attrs = sandbox ? `sandbox="${sandbox}" ` : "";
  writeFileSync(
    host,
    `<!doctype html><title>Host</title><h1>Team wiki</h1><iframe data-testid="frame" ${attrs}src="${encodeURIComponent(
      basename(file),
    )}" style="width:1100px;height:640px;border:0"></iframe>`,
  );
  return pathToFileURL(host).href;
}

/** Painted pixels on the live particle canvas (main-thread renderer, so the page can read it). */
function particleSample(scope: Page | FrameLocator) {
  return scope.getByTestId("live-canvas").evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext("2d");
    if (!ctx || !c.width || !c.height) return "";
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let painted = 0;
    let hash = 0;
    for (let i = 3; i < data.length; i += 4)
      if (data[i] > 40) {
        painted++;
        hash = (hash * 31 + i) | 0;
      }
    return painted ? `${painted}:${hash}` : "";
  });
}

/**
 * The viewer shows every node with its icon, plays the simulation (particles move), and switching runs the
 * other simulation: its own narration, its node going down, its clock moving on and its particles.
 */
async function expectPlaying(scope: Page | FrameLocator) {
  await expect(scope.getByTestId("html-viewer")).toBeVisible();
  expect(kafkaNodes.length).toBeGreaterThan(10);
  for (const id of kafkaNodes) await expect(scope.getByTestId(`node-${id}`)).toBeVisible();
  // Icons are data URIs that loaded under the file's CSP.
  const icon = scope.getByTestId(`node-${kafkaNodes[0]}`).locator("img").first();
  await expect(icon).toHaveAttribute("src", /^data:image\/svg\+xml,/);
  await expect.poll(() => icon.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  await expect(scope.getByTestId("live-controls")).toBeVisible();
  await expect(scope.getByTestId("live-sim-picker")).toHaveValue("black-friday");
  await expect(scope.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
  // Particles move: the painted pixels change from one sample to the next.
  await expect.poll(() => particleSample(scope), { timeout: 10_000 }).not.toBe("");
  const a = await particleSample(scope);
  await expect.poll(() => particleSample(scope), { timeout: 10_000 }).not.toBe(a);

  await scope.getByTestId("live-sim-picker").selectOption("payments-outage");
  await expect(scope.getByTestId("live-sim-picker")).toHaveValue("payments-outage");
  await scope.getByTestId("live-speed").selectOption("4");
  // Its own timeline at 4 s: payments goes down, and its note pauses the run.
  await expect(scope.getByTestId("live-note")).toContainText("Payments is offline", { timeout: 15_000 });
  await expect(scope.getByTestId("node-badge-payments")).toHaveAttribute("data-status", "down");
  await expect(scope.getByTestId("live-play")).toHaveAttribute("data-state", "waiting");
  const paused = await scope.getByTestId("live-clock").innerText();
  await scope.getByTestId("live-note-continue").click();
  await expect(scope.getByTestId("live-clock")).not.toHaveText(paused, { timeout: 10_000 });
  const b = await particleSample(scope);
  await expect.poll(() => particleSample(scope), { timeout: 10_000 }).not.toBe(b);
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
