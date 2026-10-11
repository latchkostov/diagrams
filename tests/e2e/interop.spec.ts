import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test, expect, gotoCanvas, gotoGallery, publicExamples, expectNoErrors } from "./fixtures";

// Import / export / storage (src/interop). Selectors are data-testid only.

const MERMAID = `flowchart LR
  web([Customer]) -->|POST /orders| api[Order API]
  subgraph cloud [Azure]
    api -.->|OrderPlaced| bus[(Service Bus orders)]
    bus -.-> fn[Billing Azure Function]
  end
  fn --> db[(Postgres ledger)]
`;

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no bounding box");
  return box;
}

async function openFile(page: Page) {
  await page.getByTestId("file-button").click();
  await expect(page.getByTestId("file-menu")).toBeVisible();
}

async function moreFormats(page: Page, item: string) {
  await openFile(page);
  await page.getByTestId("file-more-formats").click();
  await expect(page.getByTestId("file-more-formats-menu")).toBeVisible();
  await page.getByTestId(item).click();
}

test.describe("interop", () => {
  test("File menu: common actions first, Google Drive hidden without configuration", async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    await openFile(page);
    const menu = page.getByTestId("file-menu");
    for (const id of [
      "file-save",
      "file-open",
      "export-png",
      "export-share-link",
      "file-more-formats",
      "file-import-from",
    ]) {
      await expect(menu.getByTestId(id)).toBeVisible();
    }
    // No VITE_GOOGLE_CLIENT_ID in the test build: no Drive rows at all (not even disabled ones).
    await expect(page.getByTestId("file-open-drive")).toHaveCount(0);
    await expect(page.getByTestId("file-save-drive")).toHaveCount(0);
    // Keyboard: Escape closes and returns focus to the trigger.
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(page.getByTestId("file-button")).toBeFocused();

    // The canvas context menu offers the same, also without Drive.
    await page.getByTestId("canvas-wrap").click({ button: "right", position: { x: 700, y: 60 } });
    await page.getByTestId("context-menu-item-canvas.import").hover();
    await expect(page.getByTestId("context-menu-item-import:paste")).toBeVisible();
    await expect(page.getByTestId("context-menu-item-import:drive")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("gallery: File menu only offers opening", async ({ page }) => {
    await gotoGallery(page);
    await openFile(page);
    await expect(page.getByTestId("file-open")).toBeVisible();
    await expect(page.getByTestId("file-save")).toHaveCount(0);
    await expect(page.getByTestId("export-png")).toHaveCount(0);
  });

  test("exports .drawio and imports it back", async ({ page }, info) => {
    const ex = publicExamples[0];
    await gotoCanvas(page, ex.slug);
    const [download] = await Promise.all([page.waitForEvent("download"), moreFormats(page, "export-drawio")]);
    expect(download.suggestedFilename()).toBe(`${ex.slug}.drawio`);
    const file = info.outputPath("exported.drawio");
    await download.saveAs(file);
    const xml = readFileSync(file, "utf8");
    expect(xml).toMatch(/^<mxfile /);
    for (const id of ex.nodeIds) expect(xml).toContain(`dg_id="${id}"`);

    await page.getByTestId("import-input").setInputFiles(file);
    await expect(page.getByTestId("toast")).toContainText("Imported");
    await expect(page.getByTestId("example-picker")).toHaveValue("imported");
    await expect(page.getByTestId("diagram-title")).toHaveText(ex.title);
    for (const id of ex.nodeIds) await expect(page.getByTestId(`node-${id}`)).toBeVisible();
    for (const id of ex.edgeIds) await expect(page.getByTestId(`edge-${id}`)).toBeAttached();
  });

  test("a multi-page draw.io file asks which page to open", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    await page
      .getByTestId("import-input")
      .setInputFiles(join(process.cwd(), "src/interop/drawio/fixtures/two-pages-compressed.drawio"));
    await expect(page.getByTestId("drawio-pages-dialog")).toBeVisible();
    await page.getByTestId("drawio-page-1").click();
    await expect(page.getByTestId("toast")).toContainText("Imported");
    await expect(page.getByTestId("node-s3")).toBeVisible();
    await expect(page.getByTestId("node-sqs")).toBeVisible();
  });

  test("pasting Mermaid text imports a laid-out diagram", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    await openFile(page);
    await page.getByTestId("file-import-from").click();
    await page.getByTestId("import-paste").click();
    await expect(page.getByTestId("paste-dialog")).toBeVisible();
    await page.getByTestId("paste-input").fill(MERMAID);
    await expect(page.getByTestId("paste-format")).toContainText("Mermaid");
    await page.getByTestId("paste-submit").click();
    await expect(page.getByTestId("paste-dialog")).toHaveCount(0);
    await expect(page.getByTestId("toast")).toContainText("Imported");
    await expect(page.getByTestId("example-picker")).toHaveValue("imported");
    for (const id of ["web", "api", "bus", "fn", "db"]) await expect(page.getByTestId(`node-${id}`)).toBeVisible();
    // Laid out left to right.
    const a = await boxOf(page.getByTestId("node-web"));
    const b = await boxOf(page.getByTestId("node-api"));
    expect(b.x).toBeGreaterThan(a.x + 50);
    expectNoErrors(consoleErrors);
  });

  test("pasting something unreadable explains why", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    await openFile(page);
    await page.getByTestId("file-import-from").click();
    await page.getByTestId("import-paste").click();
    await page.getByTestId("paste-input").fill("hello there");
    await expect(page.getByTestId("paste-format")).toContainText("Unrecognised");
    await page.getByTestId("paste-submit").click();
    await expect(page.getByTestId("toast")).toContainText("Supported");
  });

  test("share link round-trips in a new page without touching the user's diagrams", async ({
    page,
    context,
    consoleErrors,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const ex = publicExamples[1];
    await gotoCanvas(page, ex.slug);
    await openFile(page);
    await page.getByTestId("export-share-link").click();
    // Copied: the toast offers details; if the clipboard was refused, the dialog opens directly.
    const details = page.getByTestId("toast-share-details");
    const dialog = page.getByTestId("share-link-dialog");
    await expect(details.or(dialog)).toBeVisible();
    if (await details.isVisible()) await details.click();
    await expect(dialog).toBeVisible();
    const url = page.getByTestId("share-link-url");
    await expect(url).toHaveValue(/#d=[A-Za-z0-9_-]+$/);
    const link = await url.inputValue();

    const other = await context.newPage();
    await other.goto(link);
    await expect(other.getByTestId("shared-banner")).toBeVisible();
    await expect(other.getByTestId("example-picker")).toHaveValue("shared");
    await expect(other.getByTestId("diagram-title")).toHaveText(ex.title);
    for (const id of ex.nodeIds) await expect(other.getByTestId(`node-${id}`)).toBeVisible();
    await expect(other).not.toHaveURL(/#d=/);

    // "Save a copy" moves it into the user's own (imported) slot.
    await other.getByTestId("shared-keep").click();
    await expect(other.getByTestId("example-picker")).toHaveValue("imported");
    await expect(other.getByTestId("shared-banner")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("embed mode is a read-only viewer", async ({ page, consoleErrors }) => {
    const ex = publicExamples[0];
    await page.goto(`./?embed=1&example=${ex.slug}`);
    await expect(page.getByTestId("embed-view")).toBeVisible();
    await expect(page.getByTestId("topbar")).toHaveCount(0);
    await expect(page.getByTestId("diagram-title")).toHaveText(ex.title);
    await expect(page.getByTestId("embed-open-in-app")).toHaveAttribute("href", new RegExp(`example=${ex.slug}`));
    const node = page.getByTestId(`node-${ex.nodeIds[0]}`);
    const other = page.getByTestId(`node-${ex.nodeIds[1]}`);
    await expect(node).toBeVisible();
    const offset = async () => {
      const [a, b] = [await boxOf(node), await boxOf(other)];
      return { dx: Math.round(b.x - a.x), dy: Math.round(b.y - a.y) };
    };
    // No editing affordances: no context menu, no undo controls.
    // (Read-only nodes let pointer events through to the pane, so click by position.)
    const nb = await boxOf(node);
    await page.mouse.click(nb.x + nb.width / 2, nb.y + nb.height / 2, { button: "right" });
    await expect(page.getByTestId("context-menu")).toHaveCount(0);
    await expect(page.getByTestId("undo-button")).toHaveCount(0);
    const before = await offset();
    // Dragging a node pans the view instead of moving the node: relative positions don't change.
    const box = await boxOf(node);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 260, box.y + 160, { steps: 8 });
    await page.mouse.up();
    expect(await offset()).toEqual(before);
    expectNoErrors(consoleErrors);
  });

  test("embed dialog previews the viewer and copies an iframe", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    await moreFormats(page, "export-embed");
    await expect(page.getByTestId("embed-dialog")).toBeVisible();
    await expect(page.getByTestId("embed-snippet")).toHaveValue(/^<iframe src=".*embed=1/);
    await expect(page.getByTestId("embed-preview")).toBeAttached();
    await expect(page.getByTestId("embed-options")).toHaveCount(0);
    await page.getByTestId("embed-options-toggle").click();
    await page.getByTestId("embed-height").selectOption("640");
    await expect(page.getByTestId("embed-snippet")).toHaveValue(/height="640"/);
  });

  test("dropping a file anywhere imports it", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const dt = await page.evaluateHandle((text) => {
      const d = new DataTransfer();
      d.items.add(new File([text], "flow.mmd", { type: "text/plain" }));
      return d;
    }, MERMAID);
    await page.getByTestId("canvas-view").dispatchEvent("dragenter", { dataTransfer: dt });
    await expect(page.getByTestId("drop-overlay")).toBeVisible();
    await page.getByTestId("drop-overlay").dispatchEvent("drop", { dataTransfer: dt });
    await expect(page.getByTestId("drop-overlay")).toHaveCount(0);
    await expect(page.getByTestId("toast")).toContainText("Imported");
    await expect(page.getByTestId("diagram-title")).toHaveText("flow");
    await expect(page.getByTestId("node-api")).toBeVisible();
  });

  test("an invalid import never replaces the imported diagram; malformed groups are repaired", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const file = (name: string, d: unknown) => ({
      name,
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(d)),
    });
    const good = {
      format: "diagrams/v1",
      title: "Keep me",
      nodes: [{ id: "a", stencil: "kafka.topic", label: "A", x: 0, y: 0 }],
      edges: [],
    };
    await page.getByTestId("import-input").setInputFiles(file("good.json", good));
    await expect(page.getByTestId("diagram-title")).toHaveText("Keep me");

    await page
      .getByTestId("import-input")
      .setInputFiles(
        file("bad.json", { ...good, title: "Bad", nodes: [{ id: "a", stencil: "x", label: "A", x: "left", y: 0 }] }),
      );
    await expect(page.getByTestId("toast")).toContainText("Couldn't import bad.json");
    await page.reload();
    await expect(page.getByTestId("diagram-title")).toHaveText("Keep me");

    // groups: {} used to crash the canvas after import; now it's dropped with a note.
    await page.getByTestId("import-input").setInputFiles(file("groups.json", { ...good, title: "Groups", groups: {} }));
    await expect(page.getByTestId("toast")).toContainText("groups field wasn't a list");
    await expect(page.getByTestId("diagram-title")).toHaveText("Groups");
    await expect(page.getByTestId("node-a")).toBeVisible();
    await expect(page.getByTestId("error-boundary")).toHaveCount(0);
  });

  test("URL rewrites keep the live view's params on the same diagram", async ({ page }) => {
    const slug = "kafka-order-pipeline";
    const sim = JSON.parse(readFileSync(join(process.cwd(), "src/examples", `${slug}.json`), "utf8")).simulations[0]
      .id as string;
    await page.goto(`./?view=canvas&example=${slug}&sim=${sim}&live=1&speed=2&paused=1`);
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    await page.getByTestId("present-toggle").click();
    await expect(page.getByTestId("present-exit")).toBeVisible();
    await expect(page).toHaveURL(/present=1/);
    for (const kv of [`sim=${sim}`, "live=1", "speed=2", "paused=1"]) await expect(page).toHaveURL(new RegExp(kv));
    await page.getByTestId("present-exit").click();
    await expect(page).not.toHaveURL(/present=1/);
    for (const kv of [`sim=${sim}`, "live=1", "speed=2"]) await expect(page).toHaveURL(new RegExp(kv));
    // Switching diagrams drops them (simulation ids belong to a diagram).
    const other = publicExamples.find((e) => e.slug !== slug);
    if (!other) throw new Error("needs a second public example");
    await page.getByTestId("example-picker").selectOption(other.slug);
    await expect(page).not.toHaveURL(/sim=/);
  });

  test("PNG export produces a real image", async ({ page }, info) => {
    test.slow(); // rendering + font embedding is CPU-bound and slows down under parallel load
    await gotoCanvas(page, publicExamples[0].slug);
    await openFile(page);
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 45_000 }),
      page.getByTestId("export-png").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.png$/);
    const file = info.outputPath("diagram.png");
    await download.saveAs(file);
    expect(statSync(file).size).toBeGreaterThan(5_000);
    expect([...readFileSync(file).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  test("image options sit behind a disclosure", async ({ page }) => {
    test.slow();
    await gotoCanvas(page, publicExamples[0].slug);
    await moreFormats(page, "export-image");
    await expect(page.getByTestId("image-dialog")).toBeVisible();
    await expect(page.getByTestId("image-options")).toHaveCount(0);
    await page.getByTestId("image-options-toggle").click();
    await page.getByTestId("image-format-svg").click();
    await expect(page.getByTestId("image-export")).toContainText("SVG");
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 45_000 }),
      page.getByTestId("image-export").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.svg$/);
  });
});
