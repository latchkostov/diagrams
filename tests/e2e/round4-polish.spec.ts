import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { test, expect, gotoCanvas, gotoGallery, gotoLab } from "./fixtures";

// UX gate 4 follow-ups (docs/DESIGN-REVIEW.md, round 4, "P2 moved to the backlog"). Selectors are
// data-testid only.

type Box = { x: number; y: number; width: number; height: number };

const box = async (l: Locator): Promise<Box> => {
  const b = await l.boundingBox();
  if (!b) throw new Error("Expected a visible element");
  return b;
};

/** Opens a diagram from a native file, as File > Open would. */
async function openNative(page: Page, diagram: Record<string, unknown>) {
  await gotoCanvas(page, "kafka-order-pipeline");
  await page.getByTestId("import-input").setInputFiles({
    name: "test.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "diagrams/v1", ...diagram })),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText(String(diagram.title));
}

/** Waits until an element holds still (the opening fit, or a pan clear of the inspector, has finished). */
async function holdStill(l: Locator) {
  let last = "";
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await l.boundingBox());
        const still = now === last;
        last = now;
        return still;
      },
      { intervals: [100, 150, 150, 250] },
    )
    .toBe(true);
}

/** Someone who keeps the inspector on: below 1680px it waits for a selection, then narrows the canvas. */
async function keepInspectorOn(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem(
      "diagrams.editor.v1",
      JSON.stringify({ snap: true, grid: true, minimap: true, inspector: true }),
    ),
  );
}

const contains = (outer: Box, inner: Box) =>
  outer.x <= inner.x &&
  outer.y <= inner.y &&
  outer.x + outer.width >= inner.x + inner.width &&
  outer.y + outer.height >= inner.y + inner.height;

/** Right-clicks the empty top-centre strip of the pane (fit view keeps it clear) until the menu opens. */
async function openCanvasMenu(page: Page) {
  const wrap = await box(page.getByTestId("canvas-wrap"));
  // Retried: a fit animation still running when the page opens closes a menu as it appears.
  await expect(async () => {
    await page.getByTestId("canvas-wrap").click({ button: "right", position: { x: wrap.width / 2, y: 90 } });
    await expect(page.getByTestId("context-menu")).toBeVisible({ timeout: 1000 });
  }).toPass();
}

/** Exports from the image dialog (title on or off) and returns the downloaded file's bytes. */
async function exportImage(page: Page, kind: "png" | "svg", title: boolean, file: string) {
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  await page.getByTestId("export-image").click();
  await expect(page.getByTestId("image-dialog")).toBeVisible();
  await page.getByTestId("image-options-toggle").click();
  await expect(page.getByTestId("image-title")).toBeChecked();
  if (!title) {
    await page.getByTestId("image-title").uncheck();
    await expect(page.getByTestId("image-summary")).toContainText("without the title");
  }
  await page.getByTestId(`image-format-${kind}`).click();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 45_000 }),
    page.getByTestId("image-export").click(),
  ]);
  await download.saveAs(file);
  return readFileSync(file);
}

test.describe("round 4 polish", () => {
  test("exported images carry the diagram's title and description, unless left out", async ({ page }, info) => {
    test.slow(); // rendering + font embedding is CPU-bound
    await gotoCanvas(page, "kafka-order-pipeline");
    const svg = (await exportImage(page, "svg", true, info.outputPath("titled.svg"))).toString("utf8");
    expect(svg).toContain("Kafka order pipeline");
    expect(svg).toContain("Order placement with independent consumer groups");
    const bare = (await exportImage(page, "svg", false, info.outputPath("bare.svg"))).toString("utf8");
    expect(bare).not.toContain("Kafka order pipeline");
    // The PNG is taller by the header, same width (the diagram is wider than the title).
    const size = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
    const titled = size(await exportImage(page, "png", true, info.outputPath("titled.png")));
    const plain = size(await exportImage(page, "png", false, info.outputPath("plain.png")));
    expect(titled.width).toBe(plain.width);
    expect(titled.height - plain.height).toBeGreaterThan(2 * 60); // 2× pixels: the title, a line, the gap
    // The header was only there for the shot: the description is on screen once (the diagram card).
    const count = (el: HTMLElement) => el.innerText.split("Order placement with independent").length - 1;
    expect(await page.getByTestId("canvas-wrap").evaluate(count)).toBe(1);
  });

  test("at 1024 the gallery folds the families that don't fit into the Vendor menu", async ({ page }) => {
    await gotoGallery(page);
    // Roomy: every family has its chip.
    await expect(page.getByTestId("family-chip-generic")).toBeVisible();
    const foldedChips = () =>
      page.getByTestId(/^family-chip-/).evaluateAll((els) => els.filter((el) => el.hasAttribute("data-folded")).length);
    expect(await foldedChips()).toBe(0);
    await page.setViewportSize({ width: 1024, height: 768 });
    const generic = page.getByTestId("family-chip-generic");
    await expect(generic).toHaveAttribute("data-folded", "1");
    await expect(generic).toBeHidden();
    // What's left fits: the track no longer scrolls behind a fade.
    const fits = (el: HTMLElement) =>
      !!el.parentElement && el.parentElement.scrollWidth <= el.parentElement.clientWidth;
    expect(await page.getByTestId("family-chip-all").evaluate(fits)).toBe(true);
    // The folded families are in the Vendor menu; picking one gives it a chip again.
    await page.getByTestId("vendor-overflow").click();
    await page.getByTestId("context-menu-item-family:generic").click();
    await expect(page.getByTestId("vendor-menu")).toHaveCount(0);
    await expect(generic).toBeVisible();
    await expect(generic).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("family-chip-all")).toHaveAttribute("aria-pressed", "false");
  });

  test("the Lab's Record setup doesn't promise presentation view (the Lab has none)", async ({ page }) => {
    await gotoLab(page, "live-badge-states");
    await page.getByTestId("live-more").click();
    await page.getByTestId("live-record").click();
    await expect(page.getByTestId("record-setup")).toBeVisible();
    await expect(page.getByTestId("record-what")).toContainText("Your browser will ask to share this tab");
    await expect(page.getByTestId("record-what")).not.toContainText("presentation view");
  });

  test("Annotate › Zone with nodes selected draws the zone around them, in one undo step", async ({ page }) => {
    await gotoCanvas(page, "kafka-order-pipeline");
    const a = page.getByTestId("node-stock-db");
    const b = page.getByTestId("node-payment-db");
    await a.click();
    await b.click({ modifiers: ["ControlOrMeta"] });
    await openCanvasMenu(page);
    await page.getByTestId("context-menu-item-canvas.annotate").click();
    await page.getByTestId("context-menu-item-annotate:zone").click();
    // Its label is being named, as for any new zone.
    await expect(page.getByTestId("annotation-editor")).toBeFocused();
    await page.keyboard.press("Escape");
    const zone = page.getByTestId("annotation-zone-1");
    await expect(zone).toBeVisible();
    const z = await box(zone);
    for (const n of [a, b]) {
      const nb = await box(n);
      expect(contains(z, nb)).toBe(true);
      // Padding all round, and more above (the label). Screen px, at the fitted zoom (about 0.5).
      expect(nb.x - z.x).toBeGreaterThan(10);
      expect(z.x + z.width - (nb.x + nb.width)).toBeGreaterThan(10);
    }
    const top = Math.min((await box(a)).y, (await box(b)).y);
    expect(top - z.y).toBeGreaterThan(1.5 * ((await box(a)).x - z.x));
    // One undo step: one Undo and it's gone (the view may move as the inspector closes).
    await page.getByTestId("undo-button").click();
    await expect(zone).toHaveCount(0);
    await expect(page.getByTestId("undo-button")).toBeDisabled();
  });

  test("a text that grows over an edge moves clear, with Undo", async ({ page }) => {
    await openNative(page, {
      title: "Nudge",
      nodes: [
        { id: "a", stencil: "generic.service", label: "A", x: 0, y: 0 },
        { id: "b", stencil: "generic.service", label: "B", x: 800, y: 0 },
      ],
      edges: [{ id: "ab", from: "a", to: "b" }],
      // A caption just above the edge, clear of it.
      annotations: [{ id: "text-1", kind: "text", x: 420, y: -50, width: 200, height: 30, text: "Caption" }],
    });
    const text = page.getByTestId("annotation-text-1");
    const edge = page.getByTestId("edge-ab");
    const overlaps = (p: Box, q: Box) =>
      p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
    expect(overlaps(await box(text), await box(edge))).toBe(false);
    const placed = await box(text);
    // Four more lines: it grows down, over the edge.
    await text.dblclick();
    await expect(page.getByTestId("annotation-editor")).toBeFocused();
    await page.keyboard.press("End");
    for (const line of ["Second line", "Third line", "Fourth line", "Fifth line"]) {
      await page.keyboard.press("Enter");
      await page.keyboard.type(line);
    }
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("toast")).toContainText("Moved the text off an edge");
    await expect.poll(async () => overlaps(await box(text), await box(edge))).toBe(false);
    expect((await box(text)).height).toBeGreaterThan(placed.height * 2);
    // Undo puts it back where it was, keeping what was typed.
    await page.getByTestId("text-moved-undo").click();
    await expect.poll(async () => (await box(text)).y).toBeCloseTo(placed.y, 0);
    await expect(page.getByTestId("annotation-text-text-1")).toContainText("Fourth line");
    expect(overlaps(await box(text), await box(edge))).toBe(true);
  });

  test("a text that grows into open space stays where it is", async ({ page }) => {
    await openNative(page, {
      title: "No nudge",
      nodes: [{ id: "a", stencil: "generic.service", label: "A", x: 0, y: 0 }],
      edges: [],
      annotations: [{ id: "text-1", kind: "text", x: 0, y: 300, width: 200, height: 30, text: "Caption" }],
    });
    const text = page.getByTestId("annotation-text-1");
    await holdStill(text);
    await text.click();
    // Selecting opens the inspector, which may move the view: measure where the text settles.
    await holdStill(text);
    const placed = await box(text);
    await page.getByTestId("inspector-field-text").fill("Caption\nwith a second line\nand a third");
    await page.getByTestId("inspector-field-text-size-xl").click();
    await expect.poll(async () => (await box(text)).height).toBeGreaterThan(placed.height * 2);
    expect((await box(text)).y).toBeCloseTo(placed.y, 0);
    await expect(page.getByTestId("text-moved-undo")).toHaveCount(0);
  });

  test("typing in the inspector grows a Text's box, as typing in place does", async ({ page }) => {
    await openNative(page, {
      title: "Grow",
      nodes: [{ id: "a", stencil: "generic.service", label: "A", x: 0, y: 0 }],
      edges: [],
      annotations: [{ id: "text-1", kind: "text", x: 0, y: 200, width: 200, height: 30, text: "One line" }],
    });
    const text = page.getByTestId("annotation-text-1");
    await text.click();
    const field = page.getByTestId("inspector-field-text");
    await expect(field).toHaveValue("One line");
    const before = await box(text);
    await field.fill("One line\nTwo lines\nThree lines\nAnd a fourth that is long enough to wrap in the box");
    await expect.poll(async () => (await box(text)).height).toBeGreaterThan(before.height * 3);
    // Everything typed is inside the box (nothing spills past the selection outline).
    const words = await box(page.getByTestId("annotation-text-text-1"));
    const after = await box(text);
    expect(words.y + words.height).toBeLessThanOrEqual(after.y + after.height + 1);
  });

  test("at 1024, selecting an annotation near the right edge pans it clear of the inspector", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await keepInspectorOn(page);
    await openNative(page, {
      title: "Right edge",
      nodes: [
        { id: "a", stencil: "generic.service", label: "A", x: 0, y: 0 },
        { id: "b", stencil: "generic.service", label: "B", x: 0, y: 300 },
      ],
      edges: [],
      annotations: [{ id: "note-1", kind: "note", x: 700, y: 120, width: 200, height: 120, text: "Right" }],
    });
    const note = page.getByTestId("annotation-note-1");
    await expect(note).toBeVisible();
    await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
    const wrapBefore = await box(page.getByTestId("canvas-wrap"));
    const before = await box(note);
    // Precondition: the inspector's extra width would cover part of it.
    expect(before.x + before.width).toBeGreaterThan(wrapBefore.x + wrapBefore.width - 244);
    await note.click();
    await expect(page.getByTestId("inspector")).not.toHaveAttribute("data-collapsed", "1");
    await expect
      .poll(async () => {
        const wrap = await box(page.getByTestId("canvas-wrap"));
        const b = await box(note);
        return b.x >= wrap.x && b.x + b.width <= wrap.x + wrap.width;
      })
      .toBe(true);
  });

  test("at 1024, a note added near the right edge is panned clear of the inspector it opens", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await keepInspectorOn(page);
    await openNative(page, {
      title: "Right edge add",
      nodes: [
        { id: "a", stencil: "generic.service", label: "A", x: 0, y: 0 },
        { id: "b", stencil: "generic.service", label: "B", x: 600, y: 300 },
      ],
      edges: [],
    });
    await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
    // The opening fit closes context menus. Wait for the camera before opening one.
    await holdStill(page.getByTestId("node-a"));
    const wrap = await box(page.getByTestId("canvas-wrap"));
    const note = page.getByTestId("annotation-note-1");
    // Right-click 60px from the pane's right edge: a 200px note centred there pokes past it. Retried until
    // the note is added: a late camera move closes the menu at any step, the submenu included.
    await expect(async () => {
      await page
        .getByTestId("canvas-wrap")
        .click({ button: "right", position: { x: wrap.width - 140, y: wrap.height / 2 - 160 } });
      await page.getByTestId("context-menu-item-canvas.annotate").click({ timeout: 1000 });
      await page.getByTestId("context-menu-item-annotate:note").click({ timeout: 1000 });
      await expect(note).toBeAttached({ timeout: 1000 });
    }).toPass();
    await expect(note).toBeVisible();
    await expect(page.getByTestId("inspector")).not.toHaveAttribute("data-collapsed", "1");
    await expect
      .poll(async () => {
        const w = await box(page.getByTestId("canvas-wrap"));
        const b = await box(note);
        return b.x >= w.x && b.x + b.width <= w.x + w.width;
      })
      .toBe(true);
  });
});
