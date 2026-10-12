import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { BrowserContext, Download, FrameLocator, Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors, publicExamples } from "./fixtures";

// Interactive HTML export (src/export, docs/INTEROP.md): File ▸ Export as ▸ Interactive HTML… downloads one
// self-contained file. Opened from file:// (and inside an <iframe>), it shows the diagram, plays its
// simulations, makes no requests at all and trips no Content-Security-Policy. Selectors are data-testid only.

const KAFKA = "kafka-order-pipeline";
const kafkaNodes = publicExamples.find((e) => e.slug === KAFKA)?.nodeIds ?? [];
const BANNER = "Confidential: internal use only";
const ANYONE = "Anyone who has this file can open it.";

declare global {
  interface Window {
    __violations?: string[];
    /** The browser's own localStorage, kept before the viewer swaps in its in-memory one. */
    __realStorage?: Storage;
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
    window.__realStorage = window.localStorage;
    const seen: string[] = (window.__violations = []);
    document.addEventListener("securitypolicyviolation", (e) =>
      seen.push(`${e.effectiveDirective} blocked ${e.blockedURI || "(inline)"}`),
    );
  });
  return { page, requests, errors };
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

/** The viewer shows every node with its icon, plays the simulation (particles move) and switches simulations. */
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
  await expect(scope.getByTestId("live-play")).toHaveAttribute("data-state", /playing|waiting/);
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
    // The viewer writes nothing to the browser's storage (every file:// page shares it).
    expect(await viewer.page.evaluate(() => window.__realStorage?.length)).toBe(0);
    await viewer.page.close();
    expectNoErrors(consoleErrors);
  });

  test("the file plays inside an <iframe> too, still with zero requests", async ({ page, context }) => {
    test.setTimeout(90_000);
    await gotoCanvas(page, KAFKA);
    await openHtmlExport(page);
    const { path } = await download(page);
    // A local host page, as SharePoint or Confluence would frame it.
    const host = join(dirname(path), "host.html");
    writeFileSync(
      host,
      `<!doctype html><title>Host</title><h1>Team wiki</h1><iframe data-testid="frame" src="${encodeURIComponent(
        "Kafka order pipeline.html",
      )}" style="width:1100px;height:640px;border:0"></iframe>`,
    );
    const hostUrl = pathToFileURL(host).href;
    const viewer = await watchedPage(context);
    await viewer.page.goto(hostUrl);
    const frame = viewer.page.frameLocator('[data-testid="frame"]');
    await expectPlaying(frame);
    expect(viewer.requests.filter((r) => !r.startsWith("data:"))).toEqual([hostUrl, pathToFileURL(path).href]);
    const inner = viewer.page.frames().find((f) => f !== viewer.page.mainFrame());
    expect(await inner?.evaluate(() => window.__violations ?? [])).toEqual([]);
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
    // Options: the title and the theme.
    await page.getByTestId("html-export-options-toggle").click();
    await page.getByTestId("html-export-title").fill("Ledger flow (team copy)");
    await page.getByTestId("html-export-theme-dark").click();
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
