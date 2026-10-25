import { chunk, holdChunk } from "./chunk";
import { currentDiagram } from "./fixtures";
import { openExample } from "./fixtures";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import {
  test,
  pageLoadTimeout,
  expect,
  gotoCanvas,
  gotoGallery,
  gotoLab,
  publicExamples,
  expectNoErrors,
  gotoLive,
  shareVia,
  fitDiagram,
} from "./fixtures";

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

test("a failed image export keeps the format in its error", async ({ page }) => {
  test.slow(); // The canvas and its lazy failure messages load independently.
  await page.route(/\/(?:assets\/image-[^/]+\.js|src\/interop\/image\.ts)(?:\?.*)?$/, (route) => route.abort());
  await gotoCanvas(page, publicExamples[0].slug);
  await fileItem(page, "export-png");
  await expect(page.getByTestId("toast").filter({ hasText: "Couldn't export the PNG." })).toBeVisible({
    timeout: pageLoadTimeout(),
  });
});
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
    for (const id of ["file-save", "file-open", "export-png", "file-share", "file-more-formats", "file-import-from"]) {
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
    await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
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

  test("draw.io export and re-import keeps hand-shaped routes and sides", async ({ page }, info) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const fixture = join(process.cwd(), "tests/parity/corpus/hand-shaped-lines.diagram.json");
    const shaped = JSON.parse(readFileSync(fixture, "utf8")) as {
      title: string;
      edges: { id: string; sourceSide?: string; targetSide?: string }[];
    };
    await page.getByTestId("import-input").setInputFiles(fixture);
    await expect(page.getByTestId("diagram-title")).toHaveText(shaped.title);
    for (const edge of shaped.edges)
      await expect(page.getByTestId(`edge-${edge.id}`)).toHaveAttribute("data-route", "custom");
    const [download] = await Promise.all([page.waitForEvent("download"), moreFormats(page, "export-drawio")]);
    const file = info.outputPath("shaped.drawio");
    await download.saveAs(file);
    expect(readFileSync(file, "utf8")).toContain('<Array as="points">');
    // Switch away first, so every following assertion observes the re-imported file.
    await importNative(page);
    await expect(page.getByTestId("edge-api-db")).toHaveCount(0);
    await page.getByTestId("import-input").setInputFiles(file);
    await expect(page.getByTestId("diagram-title")).toHaveText(shaped.title);
    for (const edge of shaped.edges) {
      const line = page.getByTestId(`edge-${edge.id}`);
      await expect(line).toHaveAttribute("data-route", "custom");
      if (edge.sourceSide) await expect(line).toHaveAttribute("data-source-side", edge.sourceSide);
      if (edge.targetSide) await expect(line).toHaveAttribute("data-target-side", edge.targetSide);
    }
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
    await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
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
    // Share… ▸ Public link or embed ▸ Share link…: the dialog shows the link and copies it.
    await shareVia(page, "link");
    const dialog = page.getByTestId("share-link-dialog");
    await expect(dialog).toBeVisible();
    const url = page.getByTestId("share-link-url");
    await expect(url).toHaveValue(/#d=[A-Za-z0-9_-]+$/);
    // Copy link puts exactly that link on the clipboard, and it's the one that opens below.
    await page.evaluate(() => navigator.clipboard.writeText("before"));
    await page.getByTestId("share-link-copy").click();
    await expect(page.getByTestId("toast").last()).toContainText("Share link copied.");
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toBe(await url.inputValue());

    const other = await context.newPage();
    await other.goto(link);
    await expect(other.getByTestId("shared-banner")).toBeVisible();
    await expect(other.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", "shared");
    await expect(other.getByTestId("diagram-title")).toHaveText(ex.title);
    for (const id of ex.nodeIds) await expect(other.getByTestId(`node-${id}`)).toBeVisible();
    await expect(other).not.toHaveURL(/#d=/);

    // "Save a copy" adds it to Your diagrams.
    await other.getByTestId("shared-keep").click();
    await expect(other.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
    await expect(other.getByTestId("shared-banner")).toHaveCount(0);
    await other.getByTestId("file-button").click();
    await other.getByTestId("file-library").click();
    const copy = await currentDiagram(other);
    await expect(other.getByTestId(`library-title-${copy}`)).toHaveText(ex.title);
    expectNoErrors(consoleErrors);
  });

  test("embed mode is a read-only viewer", async ({ page, consoleErrors }) => {
    const ex = publicExamples[0];
    await page.goto(`./?embed=1&example=${ex.slug}`);
    await expect(page.getByTestId("embed-view")).toBeVisible();
    await expect(page.getByTestId("live-controls")).toHaveCount(0);
    await expect(page.getByTestId("live-canvas")).toHaveCount(0);
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
    await expect(page.getByTestId("live-controls")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("embed dialog previews the viewer and copies an iframe", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    await shareVia(page, "embed-public");
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
    await expect(page.getByTestId("drop-overlay")).toContainText("Terraform plan");
    await expect(page.getByTestId("drop-overlay")).not.toContainText("Terraform plan or state");
    await page.getByTestId("drop-overlay").dispatchEvent("drop", { dataTransfer: dt });
    await expect(page.getByTestId("drop-overlay")).toHaveCount(0);
    await expect(page.getByTestId("toast")).toContainText("Imported");
    await expect(page.getByTestId("diagram-title")).toHaveText("flow");
    await expect(page.getByTestId("node-api")).toBeVisible();
  });

  test("an invalid import never replaces your diagram; malformed groups are repaired", async ({ page }) => {
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
    await gotoLive(page, `./?view=canvas&example=${slug}&sim=${sim}&live=1&speed=2&paused=1`);
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
    await openExample(page, other.slug);
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
    await page.keyboard.press("ControlOrMeta+s");
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
    await page.keyboard.press("ControlOrMeta+s");
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
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByTestId("toast")).toHaveAttribute("data-kind", "error");
    await expect(page.getByTestId("toast")).toContainText("write failed");
    await page.evaluate(() => {
      window.__fs.rejectWrite = false;
      window.__fs.denyPermission = true;
    });
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByTestId("toast")).toHaveAttribute("data-kind", "error");
    await expect(page.getByTestId("toast")).toContainText("wasn't granted");
    expect(await page.evaluate(() => window.__fs.writes.length)).toBe(1);
  });

  test("a gallery New diagram never writes to A's handle", async ({ page }) => {
    await fakeFileSystem(page);
    await gotoCanvas(page, publicExamples[0].slug);
    await openFile(page);
    await page.getByTestId("file-open").click();
    await expect(page.getByTestId("diagram-title")).toHaveText(NATIVE.title);
    await saveFile(page);
    await page.getByTestId("view-gallery").click();
    await page.getByTestId("stencil-tile-generic.service").click();
    await page.getByTestId("drawer-new").click();
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

  test("late Save As binds to the diagram that started it, never to the one opened since", async ({ page }) => {
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
    await expect(page.getByTestId("toast")).toContainText(`Saved “${NATIVE.title}” to saved-1.json`);
    // B is a separate diagram with no destination yet...
    const b = await currentDiagram(page);
    await saveFile(page);
    expect(await page.evaluate(() => window.__fs.pickerCalls)).toBe(2);
    // ...and A kept the one its own save chose.
    await page.getByTestId("example-picker").click();
    const a = await page
      .getByTestId("diagram-menu")
      .getByTestId(/^picker-option-.*(?<!-title)$/)
      .filter({ hasText: NATIVE.title })
      .getAttribute("data-testid")
      .then((id) => id?.slice("picker-option-".length));
    if (!a) throw new Error("A is missing from Your diagrams");
    expect(a).not.toBe(b);
    await page.keyboard.press("Escape");
    await openExample(page, a);
    await expect(page.getByTestId("diagram-title")).toHaveText(NATIVE.title);
    await page.keyboard.press("ControlOrMeta+s");
    await expect.poll(() => page.evaluate(() => window.__fs.writes.length)).toBe(3);
    const state = await page.evaluate(() => window.__fs);
    expect(state.pickerCalls).toBe(2);
    expect(state.writes.map((w) => w.name)).toEqual(["saved-1.json", "saved-2.json", "saved-1.json"]);
  });

  test("unrelated slot changes preserve the canvas, undo history and pending edits", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    await page.getByTestId("inspector-toggle").click();
    await page.getByTestId("inspector-field-title").fill("Unsaved edit");
    await page.getByTestId("canvas-view").evaluate((el) => el.setAttribute("data-test-instance", "kept"));
    // Another tab opens a share link (the shared slot) while this one has unsaved edits.
    await page.evaluate((diagram) => {
      localStorage.setItem("diagrams.shared.v1", JSON.stringify(diagram));
      window.dispatchEvent(new StorageEvent("storage", { key: "diagrams.shared.v1" }));
    }, NATIVE);
    await page.getByTestId("example-picker").click();
    await expect(page.getByTestId("picker-option-shared")).toContainText(`${NATIVE.title} (shared)`);
    await page.keyboard.press("Escape");
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

test("image export wraps an unbroken title and URL within the measured one-node bounds @dev", async ({ page }) => {
  test.slow();
  await gotoLab(page, "header-overflow");
  await page.getByTestId("lab-open-editor").click();
  await expect(page.getByTestId("canvas-view")).toBeVisible();
  await expect(page.getByTestId("node-service")).toBeVisible();
  const result = await page.getByTestId("canvas-wrap").evaluate(async (root) => {
    const url = "/src/interop/image.ts";
    const { renderDiagramImage } = (await import(url)) as typeof import("../../src/interop/image");
    const title = "identifier".repeat(80);
    const description = "https://example.test/" + "path".repeat(120);
    const rendering = renderDiagramImage("svg", { header: { title, description } });
    const header = root.querySelector<HTMLElement>('[data-testid="export-header"]');
    if (!header) throw new Error("Export header was not added");
    const size = {
      width: header.offsetWidth,
      contentWidth: header.scrollWidth,
      height: header.offsetHeight,
      contentHeight: header.scrollHeight,
    };
    const image = await rendering;
    const svg = new DOMParser().parseFromString(await image.text(), "image/svg+xml");
    return {
      ...size,
      exportedTitle: svg.querySelector('[data-testid="export-header"] h1')?.textContent,
      exportedDescription: svg.querySelector('[data-testid="export-header"] p')?.textContent,
    };
  });
  expect(result.contentWidth).toBeLessThanOrEqual(result.width);
  expect(result.contentHeight).toBeLessThanOrEqual(result.height);
  expect(result.width).toBeLessThanOrEqual(420);
  expect(result.exportedTitle).toBe("identifier".repeat(80));
  expect(result.exportedDescription).toBe("https://example.test/" + "path".repeat(120));
  await expect(page.getByTestId("export-header")).toHaveCount(0);
});

test("pending Save follows the first promoted copy (device)", async ({ page }) => {
  await fakeFileSystem(page);
  await gotoCanvas(page, "kafka-order-pipeline");
  await page.evaluate(() => {
    window.__fs.defer = true;
  });
  await openFile(page);
  await page.getByTestId("file-save").click();
  await expect.poll(() => page.evaluate(() => !!window.__fs.release)).toBe(true);
  await page.getByTestId("node-shopper").click();
  await page.getByTestId("inspector-field-label").fill("Promoted storefront");
  await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
  await page.evaluate(() => {
    window.__fs.defer = false;
    window.__fs.release?.();
  });
  await expect.poll(() => page.evaluate(() => window.__fs.writes.length)).toBe(1);
  await expect(page.getByTestId("save-status")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => page.evaluate(() => window.__fs.writes.length)).toBe(2);
  expect(await page.evaluate(() => window.__fs.pickerCalls)).toBe(1);
  expect(
    await page.evaluate(
      () => JSON.parse(window.__fs.writes[1].text).nodes.find((n: { id: string }) => n.id === "shopper").label,
    ),
  ).toBe("Promoted storefront");
});

test("reopening an example never overwrites its Private copy's destination", async ({ page }) => {
  await fakeFileSystem(page);
  await gotoCanvas(page, "kafka-order-pipeline");
  await saveFile(page);
  await page.getByTestId("node-shopper").click();
  await page.getByTestId("inspector-field-label").fill("Private storefront");
  await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-privacy").click();
  await page.getByTestId("privacy-diagram").click();
  await expect(page.getByTestId("private-badge")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => page.evaluate(() => window.__fs.writes.length)).toBe(2);
  const privateFile = await page.evaluate(() => window.__fs.writes[1]);
  expect(JSON.parse(privateFile.text).private).toBe(true);
  await openExample(page, "kafka-order-pipeline");
  await expect(page.getByTestId("example-badge")).toBeVisible();
  await expect(page.getByTestId("node-shopper")).not.toContainText("Private storefront");
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => page.evaluate(() => window.__fs.writes.length)).toBe(3);
  expect(await page.evaluate(() => window.__fs.pickerCalls)).toBe(2);
  // Bring the reopened drawing into the current pane before the next pointer action.
  await fitDiagram(page);
  await page.getByTestId("node-shopper").click();
  await page.getByTestId("inspector-field-label").fill("Second storefront");
  await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => page.evaluate(() => window.__fs.writes.length)).toBe(4);
  expect(await page.evaluate(() => window.__fs.writes.filter((w) => w.name === "saved-1.json"))).toEqual([
    expect.anything(),
    privateFile,
  ]);
  expect(await page.evaluate(() => window.__fs.writes[3].name)).toBe("saved-2.json");
});

for (const deferred of [false, true]) {
  test(`leaving an unedited example releases its ${deferred ? "pending" : "completed"} Save destination`, async ({
    page,
  }) => {
    await fakeFileSystem(page);
    await gotoCanvas(page, "kafka-order-pipeline");
    await page.evaluate((defer) => {
      window.__fs.defer = defer;
    }, deferred);
    await openFile(page);
    await page.getByTestId("file-save").click();
    if (deferred) await expect.poll(() => page.evaluate(() => !!window.__fs.release)).toBe(true);
    else await expect.poll(() => page.evaluate(() => window.__fs.writes.length)).toBe(1);
    await openExample(page, "notification-fanout");
    // openExample deliberately returns before the download. Actually leave the initiating
    // canvas before returning: cancelling a pending navigation keeps that session alive.
    await expect(page.getByTestId("node-carrier")).toBeVisible();
    await openExample(page, "kafka-order-pipeline");
    await expect(page.getByTestId("node-shopper")).toBeVisible();
    if (deferred) {
      await page.evaluate(() => {
        window.__fs.defer = false;
        window.__fs.release?.();
      });
      await expect.poll(() => page.evaluate(() => window.__fs.writes.length)).toBe(1);
    }
    await page.keyboard.press("ControlOrMeta+s");
    await expect.poll(() => page.evaluate(() => window.__fs.writes.length)).toBe(2);
    expect(await page.evaluate(() => window.__fs.pickerCalls)).toBe(2);
    await page.getByTestId("node-shopper").click();
    await page.getByTestId("inspector-field-label").fill("Reopened storefront");
    await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
    await page.keyboard.press("ControlOrMeta+s");
    await expect.poll(() => page.evaluate(() => window.__fs.writes.length)).toBe(3);
    expect(await page.evaluate(() => window.__fs.writes[2].name)).toBe("saved-2.json");
  });
}

for (const format of ["json", "svg", "png"] as const) {
  test(`${format} downloads while example discovery is held`, async ({ page }) => {
    const held = await holdChunk(page, chunk("ExampleDetails", "src/examples/ExampleDetails.tsx"));
    try {
      await page.goto("./");
      await expect.poll(held.requested).toBe(true);
      await page.getByTestId("start-example-rag-assistant").click();
      await expect(page.getByTestId("diagram-title")).toHaveText("RAG support assistant");
      const downloading = page.waitForEvent("download");
      await page.getByTestId("file-button").click();
      await page.getByTestId("file-more-formats").click();
      if (format === "json") await page.getByTestId("export-json").click();
      else {
        await page.getByTestId("export-image").click();
        await page.getByTestId("image-options-toggle").click();
        await page.getByTestId(`image-format-${format}`).click();
        await page.getByTestId("image-export").click();
      }
      const file = await downloading;
      expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
      const bytes = readFileSync(await file.path());
      expect(bytes.length).toBeGreaterThan(0);
      if (format !== "png") expect(bytes.toString()).not.toContain('data-testid="start-card"');
      expect(await page.evaluate(() => window.__lazySurfaces?.states()["examples.discovery"]?.state)).toBe("loading");
    } finally {
      held.release();
    }
  });
}

test("SVG downloads with mounted, held gallery discovery and excludes discovery chrome", async ({ page }) => {
  const held = await holdChunk(page, chunk("ExampleDetails", "src/examples/ExampleDetails.tsx"));
  try {
    await gotoCanvas(page, "rag-assistant");
    // Open the export dialog first, then mount the gallery concurrently. Dispatching its entry
    // actions intentionally bypasses the modal pointer trap to exercise export readiness itself.
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    await page.getByTestId("export-image").click();
    await page.getByTestId("image-options-toggle").click();
    await page.getByTestId("image-format-svg").click();
    await page.getByTestId("example-picker").dispatchEvent("click");
    await page.getByTestId("picker-browse-examples").dispatchEvent("click");
    await expect.poll(held.requested).toBe(true);
    await expect(page.getByTestId("examples-loading")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__lazySurfaces?.states()["examples.discovery"]))
      .toEqual({ state: "loading", active: true });
    const downloading = page.waitForEvent("download");
    await page.getByTestId("image-export").dispatchEvent("click");
    const file = await downloading;
    const svg = readFileSync(await file.path(), "utf8");
    expect(await file.failure()).toBeNull();
    expect(svg).toContain("RAG support assistant");
    for (const chrome of ["examples-dialog", "examples-loading", "examples-search", "start-card", "ExampleDetails-"])
      expect(svg).not.toContain(chrome);
    await expect(page.getByTestId("examples-loading")).toBeVisible();
    expect(await page.evaluate(() => window.__lazySurfaces?.states()["examples.discovery"])).toEqual({
      state: "loading",
      active: true,
    });
  } finally {
    held.release();
  }
});
