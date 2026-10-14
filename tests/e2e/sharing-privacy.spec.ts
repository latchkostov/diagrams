import { readFileSync } from "node:fs";
import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors, openShareChooser, shareVia, waitForHtmlTemplate } from "./fixtures";
import { filePayload } from "./html-viewer";

// Sharing, export, embed and privacy, reviewed together (docs/DESIGN-REVIEW.md, rounds 21 and 27): every way out says
// who can open what it makes, a private diagram says why its links are gone from the keyboard too, and Esc always
// closes. Share… itself (its order, focus and public step) is tests/e2e/share-chooser.spec.ts. Every diagram here is
// public or synthetic.

const SLUG = "kafka-order-pipeline";
const PRIVATE_SHARE = "Private diagrams can't be shared as links. Export Interactive HTML instead.";

/** An edited diagram of your own (not a pristine example), so the public embed is "In the link". Returns its slug. */
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

test("Share… says who can open each way out, and so does the Share link toast", async ({
  page,
  context,
  consoleErrors,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await gotoCanvas(page, SLUG);
  await openShareChooser(page);
  await expect(page.getByTestId("share-option-html")).toContainText("Anyone who has this file can open it");
  await expect(page.getByTestId("share-option-file")).toContainText("Anyone who has this file can open and edit it");
  await expect(page.getByTestId("share-option-embed")).toContainText("the diagram never leaves your app");
  await expect(page.getByTestId("share-option-password")).toContainText("Only people with the password can open it");
  await expect(page.getByTestId("share-public-toggle")).toContainText("anyone with the link can open it");
  await page.getByTestId("share-public-toggle").click();
  await expect(page.getByTestId("share-option-link")).toContainText("Public: anyone with the link can open it.");
  await expect(page.getByTestId("share-option-embed-public")).toContainText(
    "Public: anyone who can see the page can open it.",
  );
  await page.getByTestId("share-option-link").click();
  const dialog = page.getByTestId("share-link-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("share-link-copy")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("toast").last()).toContainText("Anyone with the link can open the diagram.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/#d=/);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // Share… handed over to the dialog: Esc closes it, and the keyboard goes back to the File button, not the page.
  await expect(page.getByTestId("share-chooser")).toHaveCount(0);
  await expect(page.getByTestId("file-button")).toBeFocused();
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
  await holdCompression(page);
  await shareVia(page, "link");
  await expect(dialog).toBeVisible();
  await expect.poll(() => heldCompressions(page)).toBeGreaterThan(0);
  await expect(page.getByTestId("share-link-copy")).toBeDisabled();
  await expect(dialog).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("file-button")).toBeFocused();
  // The link made after it closed doesn't bring it back.
  await releaseCompression(page);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
  await expect(dialog).toHaveCount(0);

  // Focus the person moved while it was pending stays where they put it when the link is ready.
  await holdCompression(page);
  await shareVia(page, "link");
  await expect(dialog).toBeFocused();
  await page.getByTestId("share-link-dialog-close").focus();
  await releaseCompression(page);
  await expect(page.getByTestId("share-link-copy")).toBeEnabled();
  await expect(page.getByTestId("share-link-dialog-close")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // Embed on a public page, for a diagram of your own (in the link): the same while its code is made.
  await importDiagram(page, "Pending plan");
  const before = await heldCompressions(page);
  await holdCompression(page);
  await shareVia(page, "embed-public");
  const embed = page.getByTestId("embed-dialog");
  await expect(embed).toBeVisible();
  await expect(page.getByTestId("embed-inline-note")).toBeVisible();
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

test("a link dialog closed because the diagram turned private meanwhile offers Interactive HTML", async ({
  page,
  context,
  consoleErrors,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await controlCompression(context);
  await page.goto(`./?view=canvas&example=${SLUG}&storage=test`);
  await expect(page.getByTestId("canvas-view")).toBeVisible();
  const slug = await importDiagram(page, "Refused plan");
  const other = await context.newPage();
  // Load the second canvas while this tab opens its link dialog, rather than serialising two lazy loads.
  const otherReady = other.goto(`./?view=canvas&example=${slug}&storage=test`);
  await page.evaluate(() => navigator.clipboard.writeText("before"));
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));

  // Share link… starts making the link; another tab makes the diagram private before it's done.
  await holdCompression(page);
  await shareVia(page, "link");
  await expect.poll(() => heldCompressions(page)).toBeGreaterThan(0);
  await otherReady;
  await expect(other.getByTestId("diagram-title")).toHaveText("Refused plan");
  await makePrivate(other);
  await other.close();
  await releaseCompression(page);

  // No link: the dialog closed, the toast says why, and its one action opens Interactive HTML for this diagram (it
  // downloads nothing).
  await expect(page.getByTestId("share-link-dialog")).toHaveCount(0);
  await expect(page.getByTestId("toast").filter({ hasText: PRIVATE_SHARE })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("before");
  await expect(page.getByTestId("toast-private-export")).toHaveText("Interactive HTML…");
  const template = waitForHtmlTemplate(page);
  await page.getByTestId("toast-private-export").click();
  await expect(page.getByTestId("html-export-dialog")).toBeVisible();
  await expect(page.getByTestId("html-export-title")).toHaveCount(0); // Options stay closed.
  expect(downloads).toEqual([]);

  await template;
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
  await shareVia(page, "link");
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

test("a private diagram's Share… says why its links are gone, and how to change it, from the keyboard", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, SLUG);
  await makePrivate(page);
  await page.keyboard.press("Escape");
  await page.getByTestId("file-button").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("file-menu")).toBeVisible();
  const share = page.getByTestId("file-share");
  for (let i = 0; i < 12; i++) {
    if (await share.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("ArrowDown");
  }
  await expect(share).toBeFocused();
  await expect(share).toContainText("Files, or an embed your app supplies");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("share-chooser")).toBeVisible();
  await expect(page.getByTestId("share-option-html")).toBeFocused();
  // The arrows walk the rows it allows, then the line that says why the rest are off, with its way to change it.
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("share-option-file")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("share-option-embed")).toBeFocused();
  await expect(page.getByTestId("share-option-embed")).toContainText("Your app supplies it (private)");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("share-make-not-private")).toBeFocused();
  await expect(page.getByTestId("share-private-note")).toContainText(
    "Links and public embeds are off for a private diagram.",
  );
  // It asks first, in the one confirmation, whose default keeps it private.
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("privacy-dialog")).toBeVisible();
  await expect(page.getByTestId("privacy-keep")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("privacy-dialog")).toHaveCount(0);
  await expect(page.getByTestId("private-badge")).toBeVisible();

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

test("Embed code: the public one says who can open it, and each preview is a Tab stop Esc backs out of", async ({
  page,
  consoleErrors,
}) => {
  await page.goto(`./?view=canvas&example=${SLUG}&storage=test`);
  await expect(page.getByTestId("canvas-view")).toBeVisible();
  await importDiagram(page, "Settlement plan");
  // Share… ▸ Embed on a public page: a diagram of your own goes in the link, the one source, so there's no choice.
  await shareVia(page, "embed-public");
  const dialog = page.getByTestId("embed-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("embed-source-inline")).toHaveCount(0);
  await expect(page.getByTestId("embed-host-note")).toHaveCount(0);
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
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // Share… ▸ Embed in your app: the private promise instead, and its preview backs out the same way.
  await shareVia(page, "embed");
  await expect(dialog).toBeVisible();
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
