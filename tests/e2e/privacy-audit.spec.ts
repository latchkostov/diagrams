import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors } from "./fixtures";
import { MOD, SLUG } from "./ai-helpers";

// The privacy audit's fixes (docs/PRIVACY-AUDIT.md): what a private diagram must never leave behind in the address
// bar, the browser's history, a request, a third party's script, a link embed or this browser's storage. Every
// diagram here is synthetic: "Quillfeather" is a made-up word, so finding it anywhere means the diagram leaked.
// Selectors are data-testid only.

const WORD = "quillfeather";
const SIM_ID = `storm-${WORD}-ledger`;

/** A synthetic work diagram with a simulation whose id is made from its words (as a storm's is). */
const work = (extra: object = {}) => ({
  format: "diagrams/v1",
  title: "Quillfeather payroll",
  nodes: [
    { id: `${WORD}-intake`, stencil: "generic.service", label: "Quillfeather intake", x: 0, y: 0 },
    { id: `${WORD}-ledger`, stencil: "postgres", label: "Quillfeather ledger", x: 320, y: 0 },
  ],
  edges: [{ id: "intake-to-ledger", from: `${WORD}-intake`, to: `${WORD}-ledger` }],
  simulations: [
    {
      id: SIM_ID,
      title: "Quillfeather month end",
      seed: 7,
      traffic: [
        {
          id: "runs",
          node: `${WORD}-intake`,
          messageType: "PayrollRun",
          shape: { kind: "constant", ratePerSec: 5, durationMs: 4000 },
        },
      ],
      timeline: [],
      expectations: [],
    },
  ],
  ...extra,
});

/** Imports a diagram into Your diagrams (private when the file says so) and returns its slug. */
async function importDiagram(page: Page, diagram: object) {
  await page.getByTestId("import-input").setInputFiles({
    name: "work.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(diagram)),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText("Quillfeather payroll");
  const slug = await page.getByTestId("example-picker").inputValue();
  expect(slug).toMatch(/^my-/);
  return slug;
}

/** Goes live and plays the diagram's simulation from the live bar's picker. */
async function playSimulation(page: Page) {
  await page.getByTestId("live-toggle").click();
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await page.getByTestId("live-sim-picker").selectOption(SIM_ID);
  await expect(page.getByTestId("live-sim-picker")).toHaveValue(SIM_ID);
}

/** Every request the page makes, and whether it stays on the app's origin. */
function watchRequests(page: Page) {
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  return {
    outside: (origin: string) =>
      urls.filter((u) => /^https?:/.test(u) && new URL(u).origin !== origin && !u.startsWith("data:")),
    carrying: (word: string) => urls.filter((u) => decodeURIComponent(u).toLowerCase().includes(word)),
  };
}

const appOrigin = () => new URL(test.info().project.use.baseURL ?? "http://localhost").origin;

test.describe("the address bar and history", () => {
  test("a private diagram's simulation id never goes in the address bar; a public one's does", async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, SLUG);
    await importDiagram(page, work());
    await playSimulation(page);
    // The live link of a diagram that can be shared names its simulation.
    await expect.poll(() => new URL(page.url()).searchParams.get("sim")).toBe(SIM_ID);
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-controls")).toHaveCount(0);

    await importDiagram(page, work({ private: true }));
    await expect(page.getByTestId("private-badge")).toBeVisible();
    await playSimulation(page);
    await expect.poll(() => new URL(page.url()).searchParams.get("live")).toBe("1");
    expect(page.url().toLowerCase()).not.toContain(WORD);
    expect(new URL(page.url()).searchParams.has("sim")).toBe(false);
    expectNoErrors(consoleErrors);
  });

  test("a public diagram turned private while playing drops its simulation from the address bar", async ({ page }) => {
    await gotoCanvas(page, SLUG);
    await importDiagram(page, work());
    await playSimulation(page);
    await expect.poll(() => new URL(page.url()).searchParams.get("sim")).toBe(SIM_ID);
    await page.keyboard.press(`${MOD}+k`);
    await page.getByTestId("command-input").fill("private");
    await page.getByTestId("command-item-action:file.private").click();
    await expect(page.getByTestId("private-badge")).toBeVisible();
    await expect.poll(() => page.url().toLowerCase()).not.toContain(WORD);
  });
});

test.describe("requests and third parties", () => {
  test("a private diagram's session: no request leaves the origin or carries its words", async ({
    page,
    consoleErrors,
  }) => {
    const requests = watchRequests(page);
    await gotoCanvas(page, SLUG);
    await importDiagram(page, work({ private: true }));
    await page.getByTestId("file-button").click();
    await expect(page.getByTestId("file-privacy")).toBeVisible();
    await page.keyboard.press("Escape");
    await playSimulation(page);
    await page.getByTestId("live-toggle").click();
    await page.keyboard.press(`${MOD}+k`);
    await page.getByTestId("command-input").fill("intake");
    await expect(page.getByTestId(`command-item-node:${WORD}-intake`)).toBeVisible();
    await page.keyboard.press("Escape");
    expect(requests.outside(appOrigin())).toEqual([]);
    expect(requests.carrying(WORD)).toEqual([]);
    expectNoErrors(consoleErrors);
  });

  test("the File menu warms up storage providers for a public diagram, never for a private one", async ({ page }) => {
    // The test provider stands in for Google Drive, whose warm-up loads Google's scripts into the page.
    await page.goto(`./?view=canvas&example=${SLUG}&storage=test`);
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    const preloads = () =>
      page.evaluate(() => (window as { __testStoragePreloads?: number }).__testStoragePreloads ?? 0);
    await page.getByTestId("file-button").click();
    await expect(page.getByTestId("file-privacy")).toBeVisible();
    await expect.poll(preloads).toBe(1);
    await page.keyboard.press("Escape");

    await importDiagram(page, work({ private: true }));
    await expect(page.getByTestId("private-badge")).toBeVisible();
    await page.getByTestId("file-button").click();
    await expect(page.getByTestId("file-privacy")).toBeVisible();
    await page.keyboard.press("Escape");
    // The provider's code is loaded once already, so a warm-up would have run by now: none did.
    expect(await preloads()).toBe(1);
  });
});

test.describe("embeds", () => {
  test("a link embed refuses a diagram marked private, with no link out", async ({ page, consoleErrors }) => {
    const payload = deflateRawSync(Buffer.from(JSON.stringify(work({ private: true })))).toString("base64url");
    await page.goto(`./?embed=1#d=${payload}`);
    await expect(page.getByTestId("embed-error")).toContainText("This diagram is private");
    await expect(page.getByTestId("embed-open-in-app")).toHaveCount(0);
    await expect(page.getByTestId(`node-${WORD}-intake`)).toHaveCount(0);

    // The same diagram, not private, shows.
    const open = deflateRawSync(Buffer.from(JSON.stringify(work()))).toString("base64url");
    await page.goto(`./?embed=1&x=1#d=${open}`);
    await expect(page.getByTestId(`node-${WORD}-intake`)).toBeVisible();
    expectNoErrors(consoleErrors);
  });
});

test.describe("this browser's storage", () => {
  test("Ctrl+K never remembers a private diagram's nodes", async ({ page }) => {
    await gotoCanvas(page, SLUG);
    await importDiagram(page, work({ private: true }));
    await page.keyboard.press(`${MOD}+k`);
    await page.getByTestId("command-input").fill("intake");
    await page.getByTestId(`command-item-node:${WORD}-intake`).click();
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
    const recent = await page.evaluate(() => localStorage.getItem("diagrams.paletteRecent.v1") ?? "");
    expect(recent.toLowerCase()).not.toContain(WORD);
  });

  test("Clear everything on this device: one confirmation, then nothing of the diagrams is left, in any tab", async ({
    page,
    context,
    consoleErrors,
  }) => {
    await gotoCanvas(page, SLUG);
    const slug = await importDiagram(page, work({ private: true }));
    // An AI conversation that names it (the panel keeps one per diagram).
    await page.evaluate((w) => localStorage.setItem("diagrams.ai-thread.v1:x", JSON.stringify({ turns: [w] })), WORD);
    const other = await context.newPage();
    await other.goto(`./?view=canvas&example=${slug}`);
    await expect(other.getByTestId("diagram-title")).toHaveText("Quillfeather payroll");

    const openClear = async () => {
      await page.getByTestId("file-button").click();
      await page.getByTestId("file-privacy").click();
      await expect(page.getByTestId("file-privacy-menu")).toBeVisible();
      await page.getByTestId("privacy-clear-device").click();
      await expect(page.getByTestId("clear-device-dialog")).toBeVisible();
    };
    // Cancel is the default and keeps everything.
    await openClear();
    await expect(page.getByTestId("clear-device-cancel")).toBeFocused();
    await page.getByTestId("clear-device-cancel").click();
    await expect(page.getByTestId("clear-device-dialog")).toHaveCount(0);
    expect(await page.evaluate((s) => localStorage.getItem(`diagrams.library-entry.v1:${s}`), slug)).not.toBeNull();

    await openClear();
    const otherReloads = other.waitForEvent("load");
    await Promise.all([page.waitForEvent("load"), page.getByTestId("clear-device-confirm").click()]);
    await otherReloads;
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    await expect(other.getByTestId("canvas-view")).toBeVisible();
    // The app starts over on a blank diagram, and nothing of the old one is anywhere in storage.
    expect(page.url()).not.toContain(slug);
    await expect(page.getByTestId("diagram-title")).not.toHaveText("Quillfeather payroll");
    for (const p of [page, other]) {
      const stored = await p.evaluate(() =>
        Object.keys(localStorage)
          .map((k) => `${k}=${localStorage.getItem(k)}`)
          .join("\n"),
      );
      expect(stored.toLowerCase()).not.toContain(WORD);
      expect(stored).not.toContain("diagrams.library-entry.v1:");
      expect(stored).not.toContain("diagrams.ai-thread.v1:");
    }
    await other.close();
    expectNoErrors(consoleErrors);
  });
});

test.describe("exports", () => {
  test("a private diagram's draw.io and Mermaid toasts never point at public sites", async ({
    page,
    context,
    consoleErrors,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await gotoCanvas(page, SLUG);
    await importDiagram(page, work({ private: true }));
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    await page.getByTestId("export-mermaid").click();
    const toast = page.getByTestId("toast").last();
    await expect(toast).toContainText("Mermaid flowchart copied. This diagram is private");
    await expect(toast).not.toContainText("mermaid.live");
    expectNoErrors(consoleErrors);
  });

  test("an image exported with the Checks card open has no check markers in it", async ({ page }, info) => {
    test.slow(); // rendering + font embedding is CPU-bound
    await gotoCanvas(page, "azure-service-bus-integration");
    await page.getByTestId("checks-count").click();
    await expect(page.getByTestId("check-marker-posting-sub")).toBeVisible();
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    await page.getByTestId("export-image").click();
    await expect(page.getByTestId("image-dialog")).toBeVisible();
    await page.getByTestId("image-options-toggle").click();
    await page.getByTestId("image-format-svg").click();
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 45_000 }),
      page.getByTestId("image-export").click(),
    ]);
    const path = info.outputPath("checked.svg");
    await download.saveAs(path);
    const svg = readFileSync(path, "utf8");
    expect(svg).toContain("posting-sub");
    expect(svg).not.toContain("check-marker");
  });
});
