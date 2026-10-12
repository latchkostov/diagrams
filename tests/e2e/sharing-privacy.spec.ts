import { readFileSync } from "node:fs";
import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors } from "./fixtures";
import { filePayload } from "./html-viewer";

// Sharing, export, embed and privacy, reviewed together (docs/DESIGN-REVIEW.md, round 21): every way out says who
// can open what it makes, a private diagram's off rows say why from the keyboard too, and Esc always closes.
// Every diagram here is public or synthetic.

const SLUG = "kafka-order-pipeline";
const PRIVATE_SHARE = "Private diagrams can't be shared as links. Export Interactive HTML instead.";

/** An edited diagram of your own (not a pristine example), so Embed code… opens on "In the link". Returns its slug. */
async function importDiagram(page: Page, title: string) {
  await page.getByTestId("import-input").setInputFiles({
    name: "plan.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "diagrams/v1",
        title,
        nodes: [
          { id: "intake", stencil: "generic.service", label: "Intake service", x: 0, y: 0 },
          { id: "ledger", stencil: "postgres", label: "Ledger", x: 320, y: 0 },
        ],
        edges: [{ id: "intake-to-ledger", from: "intake", to: "ledger" }],
      }),
    ),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText(title);
  return page.getByTestId("example-picker").inputValue();
}

/** File ▸ Privacy ▸ Private diagram. */
async function makePrivate(page: Page) {
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-privacy").click();
  await page.getByTestId("privacy-diagram").click();
  await expect(page.getByTestId("private-badge")).toBeVisible();
}

declare global {
  interface Window {
    __compress: { hold: boolean; held: number; release: (() => void)[] };
  }
}

/**
 * Lets a test hold link making (the DEFLATE step every share link and link embed runs) until it says so, in every
 * page of the context: a dialog can then be seen, and closed, while its link is still being made.
 */
async function controlCompression(context: BrowserContext) {
  await context.addInitScript(() => {
    const gate: Window["__compress"] = { hold: false, held: 0, release: [] };
    window.__compress = gate;
    const Real = window.CompressionStream;
    window.CompressionStream = class {
      readonly writable: WritableStream<BufferSource>;
      readonly readable: ReadableStream<Uint8Array>;
      constructor(format: CompressionFormat) {
        const real = new Real(format);
        this.writable = real.writable;
        const wait = gate.hold
          ? new Promise<void>((resolve) => {
              gate.held++;
              gate.release.push(resolve);
            })
          : undefined;
        this.readable = real.readable.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ start: () => wait }));
      }
    } as unknown as typeof CompressionStream;
  });
}
const holdCompression = (page: Page) => page.evaluate(() => void (window.__compress.hold = true));
const heldCompressions = (page: Page) => page.evaluate(() => window.__compress.held);
const releaseCompression = (page: Page) =>
  page.evaluate(() => {
    window.__compress.hold = false;
    for (const go of window.__compress.release.splice(0)) go();
  });

/** Copy share link, then the toast's Details: the Share link dialog, opened from a toast that goes as it acts. */
async function shareDetails(page: Page) {
  await page.getByTestId("file-button").click();
  await page.getByTestId("export-share-link").click();
  await expect(page.getByTestId("toast-share-details")).toBeVisible();
}

test("the File menu says who can open each link, and so does the toast", async ({ page, context, consoleErrors }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await gotoCanvas(page, SLUG);
  await page.getByTestId("file-button").click();
  await expect(page.getByTestId("export-share-link")).toContainText("Anyone with the link can open it");
  await expect(page.getByTestId("export-share-link-password")).toContainText(
    "Only people with the password can open it",
  );
  await page.getByTestId("export-share-link").click();
  await expect(page.getByTestId("toast").last()).toContainText("Anyone with the link can open the diagram.");
  await page.getByTestId("toast-share-details").click();
  const dialog = page.getByTestId("share-link-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("share-link-copy")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // The toast that opened it is gone: the keyboard comes back to the canvas, not the page.
  await expect(page.getByTestId("canvas-wrap")).toBeFocused();
  expectNoErrors(consoleErrors);
});

test("Esc closes the Share link and Embed dialogs while their link is still being made", async ({
  page,
  context,
  consoleErrors,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await controlCompression(context);
  await gotoCanvas(page, SLUG);
  const dialog = page.getByTestId("share-link-dialog");

  // Pending: Copy link is off, so the dialog holds focus itself, and Esc closes it.
  await shareDetails(page);
  await holdCompression(page);
  await page.getByTestId("toast-share-details").click();
  await expect(dialog).toBeVisible();
  await expect.poll(() => heldCompressions(page)).toBeGreaterThan(0);
  await expect(page.getByTestId("share-link-copy")).toBeDisabled();
  await expect(dialog).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("canvas-wrap")).toBeFocused();
  // The link made after it closed doesn't bring it back.
  await releaseCompression(page);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
  await expect(dialog).toHaveCount(0);

  // Focus the person moved while it was pending stays where they put it when the link is ready.
  await shareDetails(page);
  await holdCompression(page);
  await page.getByTestId("toast-share-details").click();
  await expect(dialog).toBeFocused();
  await page.getByTestId("share-link-dialog-close").focus();
  await releaseCompression(page);
  await expect(page.getByTestId("share-link-copy")).toBeEnabled();
  await expect(page.getByTestId("share-link-dialog-close")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // Embed code… ▸ In the link, for a diagram of your own: the same while its code is made.
  await importDiagram(page, "Pending plan");
  const before = await heldCompressions(page);
  await holdCompression(page);
  await page.getByTestId("file-button").click();
  await page.getByTestId("export-embed").click();
  const embed = page.getByTestId("embed-dialog");
  await expect(embed).toBeVisible();
  await expect(page.getByTestId("embed-source-inline")).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => heldCompressions(page)).toBeGreaterThan(before);
  await expect(page.getByTestId("embed-copy")).toBeDisabled();
  await expect(embed).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(embed).toHaveCount(0);
  await releaseCompression(page);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
  await expect(embed).toHaveCount(0);
  expectNoErrors(consoleErrors);
});

test("a link refused for a diagram made private meanwhile offers Interactive HTML", async ({
  page,
  context,
  consoleErrors,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await controlCompression(context);
  await page.goto(`./?view=canvas&example=${SLUG}&storage=test`);
  await expect(page.getByTestId("canvas-view")).toBeVisible();
  const slug = await importDiagram(page, "Refused plan");
  await page.evaluate(() => navigator.clipboard.writeText("before"));
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));

  // Copy share link starts making the link; another tab makes the diagram private before it's done.
  await holdCompression(page);
  await page.getByTestId("file-button").click();
  await page.getByTestId("export-share-link").click();
  await expect.poll(() => heldCompressions(page)).toBeGreaterThan(0);
  const other = await context.newPage();
  await other.goto(`./?view=canvas&example=${slug}&storage=test`);
  await expect(other.getByTestId("diagram-title")).toHaveText("Refused plan");
  await makePrivate(other);
  await other.close();
  await releaseCompression(page);

  // No link: the toast says why, and its one action opens Interactive HTML for this diagram (it downloads nothing).
  await expect(page.getByTestId("toast").filter({ hasText: PRIVATE_SHARE })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("before");
  await expect(page.getByTestId("toast-private-export")).toHaveText("Interactive HTML…");
  await page.getByTestId("toast-private-export").click();
  await expect(page.getByTestId("html-export-dialog")).toBeVisible();
  await expect(page.getByTestId("html-export-title")).toHaveCount(0); // Options stay closed.
  expect(downloads).toEqual([]);

  const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId("html-export-download").click()]);
  expect(file.suggestedFilename()).toBe("Refused plan.html");
  const path = test.info().outputPath(file.suggestedFilename());
  await file.saveAs(path);
  const { diagram } = filePayload(readFileSync(path, "utf8"));
  expect(diagram.title).toBe("Refused plan");
  expect(diagram.private).toBe(true);
  expectNoErrors(consoleErrors);
});

test("the refusal's Interactive HTML… explains itself when no diagram is open", async ({
  page,
  context,
  consoleErrors,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await controlCompression(context);
  await page.goto(`./?view=canvas&example=${SLUG}&storage=test`);
  await expect(page.getByTestId("canvas-view")).toBeVisible();
  const slug = await importDiagram(page, "Gone plan");
  await holdCompression(page);
  await page.getByTestId("file-button").click();
  await page.getByTestId("export-share-link").click();
  await expect.poll(() => heldCompressions(page)).toBeGreaterThan(0);
  const other = await context.newPage();
  await other.goto(`./?view=canvas&example=${slug}&storage=test`);
  await makePrivate(other);
  await other.close();
  await releaseCompression(page);
  await expect(page.getByTestId("toast-private-export")).toBeVisible();

  // The canvas goes (the Stencils tab) while the toast is up: its action says why instead of failing silently.
  await page.getByTestId("view-gallery").click();
  await expect(page.getByTestId("canvas-view")).toHaveCount(0);
  await page.getByTestId("toast-private-export").click();
  await expect(page.getByTestId("toast").last()).toContainText(
    "Couldn't export the interactive HTML. Open a diagram on the canvas first.",
  );
  await expect(page.getByTestId("html-export-dialog")).toHaveCount(0);
  expectNoErrors(consoleErrors);
});

test("a private diagram's off link rows are reachable from the keyboard and say why", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, SLUG);
  await makePrivate(page);
  await page.keyboard.press("Escape");
  await page.getByTestId("file-button").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("file-menu")).toBeVisible();
  const link = page.getByTestId("export-share-link");
  for (let i = 0; i < 12; i++) {
    if (await link.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("ArrowDown");
  }
  await expect(link).toBeFocused();
  await expect(link).toHaveAttribute("aria-disabled", "true");
  await expect(link).toContainText(PRIVATE_SHARE);
  // Off: Enter does nothing, and no link is made.
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("file-menu")).toBeVisible();
  await expect(page.getByTestId("share-link-dialog")).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("export-share-link-password")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("export-embed")).toBeFocused();
  await expect(page.getByTestId("export-embed")).toContainText("Your app supplies it (private)");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("file-menu")).toHaveCount(0);
  await expect(page.getByTestId("file-button")).toBeFocused();

  // The Privacy submenu and the dialog name the way to share it.
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-privacy").click();
  await expect(page.getByTestId("file-privacy-menu")).toContainText("export Interactive HTML");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByTestId("private-badge").click();
  await expect(page.getByTestId("privacy-dialog")).toContainText("export Interactive HTML");
  await expect(page.getByTestId("privacy-dialog-list")).toContainText("embeds only where your own app supplies it");
  await page.keyboard.press("Escape");
  expectNoErrors(consoleErrors);
});

test("Embed code: In the link says who can open it, and the preview is a Tab stop Esc backs out of", async ({
  page,
  consoleErrors,
}) => {
  await page.goto(`./?view=canvas&example=${SLUG}&storage=test`);
  await expect(page.getByTestId("canvas-view")).toBeVisible();
  await importDiagram(page, "Settlement plan");
  await page.getByTestId("file-button").click();
  await page.getByTestId("export-embed").click();
  const dialog = page.getByTestId("embed-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("embed-source-inline")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("embed-inline-note")).toContainText(
    "Anyone who can see the page can open this diagram.",
  );
  await expect(page.getByTestId("embed-copy")).toBeFocused();

  // Into the preview from the keyboard; Esc backs out to it in the dialog, the next Esc closes the dialog.
  const viewer = page.frameLocator('[data-testid="embed-preview"]');
  await expect(viewer.getByTestId("embed-view")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("embed-snippet").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("embed-preview")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("embed-preview-area")).toBeFocused();
  await expect(dialog).toBeVisible();

  // Your app supplies it: the note gives way to the private promise, and its preview backs out the same way.
  await page.getByTestId("embed-source-host").click();
  await expect(page.getByTestId("embed-inline-note")).toHaveCount(0);
  await expect(page.getByTestId("embed-host-note")).toBeVisible();
  await expect(viewer.getByTestId("diagram-title")).toHaveText("Settlement plan", { timeout: 15_000 });
  await page.getByTestId("embed-snippet").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("embed-preview")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("embed-preview-area")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expectNoErrors(consoleErrors);
});
