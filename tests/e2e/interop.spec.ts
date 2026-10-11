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

async function fileItem(page: Page, item: string) {
  await openFile(page);
  await page.getByTestId(item).click();
}

async function moreFormats(page: Page, item: string) {
  await openFile(page);
  await page.getByTestId("file-more-formats").click();
  await expect(page.getByTestId("file-more-formats-menu")).toBeVisible();
  await page.getByTestId(item).click();
}

const NATIVE = {
  format: "diagrams/v1",
  title: "Save regression A",
  nodes: [{ id: "a", stencil: "generic.service", label: "A", x: 40, y: 160 }],
  edges: [],
};
interface FsState {
  pickerCalls: number;
  writes: { name: string; text: string }[];
  cancel: boolean;
  rejectWrite: boolean;
  denyPermission: boolean;
  defer: boolean;
  release?: () => void;
}
declare global {
  interface Window {
    __fs: FsState;
  }
}

async function fakeFileSystem(page: Page) {
  await page.addInitScript((diagram) => {
    const state: FsState = {
      pickerCalls: 0,
      writes: [],
      cancel: false,
      rejectWrite: false,
      denyPermission: false,
      defer: false,
    };
    window.__fs = state;
    const handle = (name: string) => ({
      kind: "file",
      name,
      getFile: async () => new File([JSON.stringify(diagram)], name, { type: "application/json" }),
      queryPermission: async () => (state.denyPermission ? "denied" : "granted"),
      requestPermission: async () => (state.denyPermission ? "denied" : "granted"),
      createWritable: async () => ({
        write: async (text: string) => {
          if (state.rejectWrite) throw new Error("write failed");
          state.writes.push({ name, text });
        },
        close: async () => {},
      }),
    });
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: async () => [handle("opened-a.json")],
    });
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async () => {
        state.pickerCalls++;
        if (state.cancel) throw new DOMException("cancelled", "AbortError");
        const selected = handle(`saved-${state.pickerCalls}.json`);
        if (state.defer)
          await new Promise<void>((resolve) => {
            state.release = resolve;
          });
        return selected;
      },
    });
  }, NATIVE);
}

async function importNative(page: Page, title = NATIVE.title) {
  await page.getByTestId("import-input").setInputFiles({
    name: "test.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...NATIVE, title })),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText(title);
}

async function saveFile(page: Page) {
  await openFile(page);
  await page.getByTestId("file-save").click();
  await expect(page.getByTestId("toast")).toHaveAttribute("data-kind", "success");
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

    // The canvas context menu keeps only Export (same names as the File menu); opening and saving stay in File.
    await page.getByTestId("canvas-wrap").click({ button: "right", position: { x: 700, y: 60 } });
    await expect(page.getByTestId("context-menu-item-canvas.import")).toHaveCount(0);
    await expect(page.getByTestId("context-menu-item-canvas.save")).toHaveCount(0);
    await page.getByTestId("context-menu-item-canvas.export").hover();
    await expect(page.getByTestId("context-menu-item-export:png")).toContainText("Export PNG");
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
    await fileItem(page, "export-embed");
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

test.describe("interop review regressions", () => {
  test("Save reuses its handle with the latest edits", async ({ page }) => {
    await fakeFileSystem(page);
    await gotoCanvas(page, publicExamples[0].slug);
    await importNative(page);
    await saveFile(page);
    await page.getByTestId("inspector-toggle").click();
    await page.getByTestId("inspector-field-title").fill("Latest edits");
    await page.keyboard.press("Control+s");
    await expect.poll(() => page.evaluate(() => window.__fs.writes.length)).toBe(2);
    const state = await page.evaluate(() => window.__fs);
    expect(state.pickerCalls).toBe(1);
    expect(state.writes.map((w) => w.name)).toEqual(["saved-1.json", "saved-1.json"]);
    expect(JSON.parse(state.writes[1].text).title).toBe("Latest edits");
  });

  test("cancelled Save As preserves the existing binding", async ({ page }) => {
    await fakeFileSystem(page);
    await gotoCanvas(page, publicExamples[0].slug);
    await importNative(page);
    await saveFile(page);
    await page.evaluate(() => {
      window.__fs.cancel = true;
    });
    await fileItem(page, "export-save-as");
    await expect.poll(() => page.evaluate(() => window.__fs.pickerCalls)).toBe(2);
    await page.keyboard.press("Control+s");
    await expect.poll(() => page.evaluate(() => window.__fs.writes.length)).toBe(2);
    const state = await page.evaluate(() => window.__fs);
    expect(state.pickerCalls).toBe(2);
    expect(state.writes[1].name).toBe("saved-1.json");
  });

  test("rejected writes and permissions show errors without a success toast", async ({ page }) => {
    await fakeFileSystem(page);
    await gotoCanvas(page, publicExamples[0].slug);
    await importNative(page);
    await saveFile(page);
    await page.evaluate(() => {
      window.__fs.rejectWrite = true;
    });
    await page.keyboard.press("Control+s");
    await expect(page.getByTestId("toast")).toHaveAttribute("data-kind", "error");
    await expect(page.getByTestId("toast")).toContainText("write failed");
    await page.evaluate(() => {
      window.__fs.rejectWrite = false;
      window.__fs.denyPermission = true;
    });
    await page.keyboard.press("Control+s");
    await expect(page.getByTestId("toast")).toHaveAttribute("data-kind", "error");
    await expect(page.getByTestId("toast")).toContainText("wasn't granted");
    expect(await page.evaluate(() => window.__fs.writes.length)).toBe(1);
  });

  test("gallery replacement never writes the new diagram to A's handle", async ({ page }) => {
    await fakeFileSystem(page);
    await gotoCanvas(page, publicExamples[0].slug);
    await openFile(page);
    await page.getByTestId("file-open").click();
    await expect(page.getByTestId("diagram-title")).toHaveText(NATIVE.title);
    await saveFile(page);
    await page.getByTestId("view-gallery").click();
    await page.getByTestId("stencil-tile-generic.service").click();
    await page.getByTestId("drawer-new").click();
    await page.getByTestId("drawer-confirm-replace").click();
    await expect(page.getByTestId("diagram-title")).not.toHaveText(NATIVE.title);
    await saveFile(page);
    const state = await page.evaluate(() => window.__fs);
    expect(state.pickerCalls).toBe(1);
    expect(state.writes.map((w) => w.name)).toEqual(["opened-a.json", "saved-1.json"]);
  });

  test("Lab replacement clears the previous Save destination", async ({ page }) => {
    await fakeFileSystem(page);
    await gotoCanvas(page, publicExamples[0].slug);
    await importNative(page);
    await saveFile(page);
    await page.getByTestId("view-lab").click();
    await page.getByTestId("lab-preset-link-nodes-on-canvas").click();
    await page.getByTestId("lab-open-editor").click();
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    await saveFile(page);
    expect(await page.evaluate(() => window.__fs.pickerCalls)).toBe(2);
  });

  test("late Save As cannot attach its handle to an imported replacement", async ({ page }) => {
    await fakeFileSystem(page);
    await gotoCanvas(page, publicExamples[0].slug);
    await importNative(page);
    await page.evaluate(() => {
      window.__fs.defer = true;
    });
    await openFile(page);
    await page.getByTestId("file-save").click();
    await expect.poll(() => page.evaluate(() => !!window.__fs.release)).toBe(true);
    await importNative(page, "Replacement B");
    await page.evaluate(() => {
      const s = window.__fs;
      s.defer = false;
      s.release?.();
    });
    await expect.poll(() => page.evaluate(() => window.__fs.writes.length)).toBe(1);
    await expect(page.getByTestId("toast")).toContainText("open diagram has changed");
    await saveFile(page);
    expect(await page.evaluate(() => window.__fs.pickerCalls)).toBe(2);
  });

  test("unrelated slot changes preserve the canvas, undo history and pending edits", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    await page.getByTestId("inspector-toggle").click();
    await page.getByTestId("inspector-field-title").fill("Unsaved edit");
    await page.getByTestId("canvas-view").evaluate((el) => el.setAttribute("data-test-instance", "kept"));
    await page.evaluate((diagram) => {
      localStorage.setItem("diagrams.imported.v1", JSON.stringify(diagram));
      window.dispatchEvent(new StorageEvent("storage", { key: "diagrams.imported.v1" }));
    }, NATIVE);
    await expect(page.getByTestId("example-picker")).toContainText(NATIVE.title);
    await expect(page.getByTestId("canvas-view")).toHaveAttribute("data-test-instance", "kept");
    await expect(page.getByTestId("diagram-title")).toHaveText("Unsaved edit");
    await page.getByTestId("undo-button").click();
    await expect(page.getByTestId("diagram-title")).toHaveText(publicExamples[0].title);
  });

  test("gallery-only sessions do not download the editable canvas", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await gotoGallery(page);
    await openFile(page);
    expect(requests.some((url) => url.includes("/canvas/CanvasView.tsx"))).toBe(false);
    await page.keyboard.press("Escape");
    await page.getByTestId("view-canvas").click();
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    await page.getByTestId("canvas-wrap").click({ button: "right", position: { x: 700, y: 60 } });
    await page.getByTestId("context-menu-item-canvas.export").hover();
    await expect(page.getByTestId("context-menu-item-export:json")).toBeVisible();
  });

  test("menu selections restore trigger focus and dialog invokers", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    await page.getByTestId("view-button").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId(/^view-node-/).first()).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("view-button")).toBeFocused();
    await openFile(page);
    await page.getByTestId("file-import-from").click();
    await page.getByTestId("import-paste").click();
    await expect(page.getByTestId("paste-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("file-button")).toBeFocused();
  });
});
