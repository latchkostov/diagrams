import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test, expect, gotoCanvas, gotoLab, expectNoErrors, STORAGE_KEYS } from "./fixtures";

// Annotations: free text, sticky notes, zones and shapes. Documentation only, never simulated.
// Selectors are data-testid only.

const SLUG = "kafka-order-pipeline";
const MOD = process.platform === "darwin" ? "Meta" : "Control";
const menuItem = (page: Page, id: string) => page.getByTestId(`context-menu-item-${id}`);
const annotation = (page: Page, id: string) => page.getByTestId(`annotation-${id}`);

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("Expected a visible element");
  return b;
}

/** An empty spot on the pane: top-centre of the canvas (fit view keeps it clear). */
async function emptySpot(page: Page, dx = 0) {
  const b = await box(page.getByTestId("canvas-wrap"));
  return { x: b.width / 2 + dx, y: 90 };
}

/** Waits for the opening fit to finish (a viewport move closes any open menu). */
async function settle(page: Page) {
  const node = page.getByTestId("node-payments");
  let last = "";
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await node.boundingBox());
        const still = now === last;
        last = now;
        return still;
      },
      { intervals: [100, 150, 150, 250] },
    )
    .toBe(true);
}

async function openCanvasMenu(page: Page, dx = 0) {
  // Retried: a fit animation still running when the page opens closes a menu as it appears.
  await expect(async () => {
    await page.getByTestId("canvas-wrap").click({ button: "right", position: await emptySpot(page, dx) });
    await expect(page.getByTestId("context-menu")).toBeVisible({ timeout: 1000 });
  }).toPass();
}

/** Types into the inline editor that just opened, then commits with Esc. */
async function typeAndCommit(page: Page, text: string) {
  const editor = page.getByTestId("annotation-editor");
  await expect(editor).toBeFocused();
  await page.keyboard.press(`${MOD}+a`);
  const lines = text.split("\n");
  for (const [i, line] of lines.entries()) {
    if (i) await page.keyboard.press("Enter");
    await page.keyboard.type(line);
  }
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
}

const kafka = JSON.parse(readFileSync(join(process.cwd(), "src/examples", `${SLUG}.json`), "utf8"));

/** The Kafka example with a zone, two notes, a title and a shape, seeded as its autosave. */
const annotatedKafka = {
  ...kafka,
  annotations: [
    { id: "zone-edge", kind: "zone", text: "Public edge", x: 10, y: 210, width: 690, height: 200, color: "purple" },
    { id: "title", kind: "text", text: "How an order flows", x: 40, y: 60, width: 520, height: 44, textSize: "xl" },
    { id: "note-retry", kind: "note", text: "Gateway retries 3x,\nthen 503.", x: 420, y: 440, width: 230, height: 96 },
    {
      id: "note-replay",
      kind: "note",
      text: "Compacted topic.",
      x: 1150,
      y: 640,
      width: 260,
      height: 96,
      color: "blue",
    },
    { id: "legacy", kind: "shape", shape: "cylinder", text: "Legacy FTP", x: 2240, y: 270, width: 160, height: 90 },
  ],
  edges: [...kafka.edges, { id: "to-legacy", from: "payment-db", to: "legacy", kind: "async" }],
};

async function seed(page: Page, diagram: unknown) {
  await page.addInitScript(
    ([key, value]) => {
      // Only on the first load: later reloads keep what the test did.
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("seeded", "1");
      }
    },
    [STORAGE_KEYS.autosavePrefix + SLUG, JSON.stringify(diagram)] as const,
  );
}

test.describe("annotations", () => {
  test("adds text, a note, a zone and each shape from the canvas menu", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, SLUG);
    await settle(page);

    // One spot for all: each annotation is checked, then deleted, so the next right-click lands on the pane.
    for (const [kind, text] of [
      ["text", "A caption"],
      ["note", "A note"],
      ["zone", "A zone"],
    ] as const) {
      await openCanvasMenu(page);
      await menuItem(page, "canvas.annotate").click();
      await menuItem(page, `annotate:${kind}`).click();
      await typeAndCommit(page, text);
      await expect(annotation(page, `${kind}-1`)).toHaveAttribute("data-kind", kind);
      const shown = page.getByTestId(kind === "zone" ? "annotation-label-zone-1" : `annotation-text-${kind}-1`);
      await expect(shown).toHaveText(text);
      await shown.click();
      await expect(page.getByTestId("inspector-title")).toHaveText(kind[0].toUpperCase() + kind.slice(1));
      await page.keyboard.press("Delete");
      await expect(annotation(page, `${kind}-1`)).toHaveCount(0);
      // With nothing selected the inspector folds and the view refits: wait, or the refit closes the next menu.
      await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
      await settle(page);
    }

    for (const shape of ["rect", "rounded", "ellipse", "diamond", "cylinder"] as const) {
      await openCanvasMenu(page);
      await menuItem(page, "canvas.annotate").click();
      await menuItem(page, "annotate:shape").click();
      await menuItem(page, `annotate:shape:${shape}`).click();
      await expect(annotation(page, "shape-1")).toHaveAttribute("data-shape", shape);
      // Selected, no editor; the inspector shows the shape.
      await expect(page.getByTestId("annotation-editor")).toHaveCount(0);
      await expect(page.getByTestId("inspector-title")).toHaveText("Shape");
      await expect(page.getByTestId(`inspector-shape-${shape}`)).toHaveAttribute("aria-checked", "true");
      await annotation(page, "shape-1").click();
      await page.keyboard.press("Delete");
      await expect(annotation(page, "shape-1")).toHaveCount(0);
      // With nothing selected the inspector folds and the view refits: wait, or the refit closes the next menu.
      await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
      await settle(page);
    }
    expectNoErrors(consoleErrors);
  });

  test("adds from the stencil rail's Annotate group and edits in the inspector", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId("palette-annotate")).toBeAttached();
    await page.getByTestId("palette-annotate-note").click();
    await typeAndCommit(page, "From the rail");
    await expect(page.getByTestId("annotation-text-note-1")).toHaveText("From the rail");
    await expect(page.getByTestId("inspector-title")).toHaveText("Note");
    await page.getByTestId("inspector-color-green").click();
    await expect(annotation(page, "note-1")).toHaveAttribute("data-color", "green");
    await page.getByTestId("inspector-field-text-size-l").click();
    const before = (await box(annotation(page, "note-1"))).width;
    await page.getByTestId("inspector-field-width").fill("320");
    await page.getByTestId("inspector-field-width").press("Enter");
    // 200 -> 320 at whatever zoom the view has.
    await expect.poll(async () => (await box(annotation(page, "note-1"))).width / before).toBeGreaterThan(1.5);

    await page.getByTestId("palette-annotate-shape-diamond").click();
    await expect(annotation(page, "shape-1")).toHaveAttribute("data-shape", "diamond");
    // The search finds the Annotate items too.
    await page.getByTestId("palette-search").fill("sticky");
    await expect(page.getByTestId("palette-annotate-note")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("T adds text at the pointer; double-click edits it, multi-line", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId("node-payments")).toBeVisible();
    const wrap = await box(page.getByTestId("canvas-wrap"));
    const spot = await emptySpot(page, -200);
    await page.mouse.move(wrap.x + spot.x, wrap.y + spot.y);
    await page.keyboard.press("t");
    await typeAndCommit(page, "Order flow");
    const text = annotation(page, "text-1");
    await expect(page.getByTestId("annotation-text-text-1")).toHaveText("Order flow");
    // It starts where the pointer was.
    const b = await box(text);
    expect(Math.abs(b.x - (wrap.x + spot.x))).toBeLessThan(40);
    expect(Math.abs(b.y + b.height / 2 - (wrap.y + spot.y))).toBeLessThan(30);

    // Double-click: edit in place, Enter adds a line, clicking away commits; the box grows to fit.
    const before = b.height;
    await text.dblclick();
    await expect(page.getByTestId("annotation-editor")).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("second line");
    await page.getByTestId("canvas-wrap").click({ position: await emptySpot(page, 200) });
    await expect(page.getByTestId("annotation-editor")).toHaveCount(0);
    await expect(page.getByTestId("annotation-text-text-1")).toHaveText("Order flow\nsecond line");
    await expect.poll(async () => (await box(text)).height).toBeGreaterThan(before + 5);
    expectNoErrors(consoleErrors);
  });

  test("resize, undo / redo, copy / paste and delete", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, SLUG);
    await page.getByTestId("palette-annotate-note").click();
    await typeAndCommit(page, "Resize me");
    // Let the new note settle into its own undo step (history commits after a quiet moment).
    await page.waitForTimeout(500);
    const note = annotation(page, "note-1");
    await note.click();
    const b0 = await box(note);
    const handle = page.getByTestId("annotation-resize-note-1-bottom-right");
    await expect(handle).toBeVisible();
    const h = await box(handle);
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + 80, h.y + 50, { steps: 8 });
    await page.mouse.up();
    const b1 = await box(note);
    expect(b1.width).toBeGreaterThan(b0.width + 40);
    expect(b1.height).toBeGreaterThan(b0.height + 20);
    await page.waitForTimeout(500);

    // Undo the resize, then redo it.
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(async () => Math.round((await box(note)).width)).toBe(Math.round(b0.width));
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect.poll(async () => Math.round((await box(note)).width)).toBe(Math.round(b1.width));

    // Copy / paste makes a second note with a fresh id and the same text.
    await note.click();
    await page.keyboard.press(`${MOD}+c`);
    await page.keyboard.press(`${MOD}+v`);
    await expect(page.getByTestId("annotation-text-note-2")).toHaveText("Resize me");
    await page.waitForTimeout(500);
    // Delete it, undo brings it back.
    await page.keyboard.press("Delete");
    await expect(annotation(page, "note-2")).toHaveCount(0);
    await page.waitForTimeout(500);
    await page.keyboard.press(`${MOD}+z`);
    await expect(annotation(page, "note-2")).toBeVisible();
    // Undo the whole note away.
    for (let i = 0; i < 6 && (await annotation(page, "note-1").count()); i++) await page.keyboard.press(`${MOD}+z`);
    await expect(annotation(page, "note-1")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("align works across nodes and annotations", async ({ page }) => {
    await seed(page, annotatedKafka);
    await gotoCanvas(page, SLUG);
    await annotation(page, "note-retry").click();
    await annotation(page, "note-replay").click({ modifiers: [MOD] });
    await expect(page.getByTestId("inspector-title")).toHaveText("2 selected");
    await page.getByTestId("inspector-align-top").click();
    await expect
      .poll(async () => Math.round((await box(annotation(page, "note-retry"))).y))
      .toBe(Math.round((await box(annotation(page, "note-replay"))).y));
  });

  test("export JSON and import it back keeps every annotation", async ({ page, consoleErrors }, info) => {
    await seed(page, annotatedKafka);
    await gotoCanvas(page, SLUG);
    await expect(annotation(page, "note-retry")).toBeVisible();
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-json").click()]);
    const file = info.outputPath("annotated.diagram.json");
    await download.saveAs(file);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.annotations.map((a: { id: string }) => a.id).sort()).toEqual(
      annotatedKafka.annotations.map((a: { id: string }) => a.id).sort(),
    );

    await page.getByTestId("import-input").setInputFiles(file);
    await expect(page.getByTestId("toast")).toContainText("Imported");
    await expect(page.getByTestId("example-picker")).toHaveValue(/^my-/);
    for (const a of annotatedKafka.annotations) await expect(annotation(page, a.id)).toBeVisible();
    await expect(page.getByTestId("annotation-text-note-retry")).toHaveText("Gateway retries 3x,\nthen 503.");
    await expect(page.getByTestId("edge-to-legacy")).toBeAttached();
    expectNoErrors(consoleErrors);
  });

  test("the overlap audit stays clean: labels may cross zones, never notes or shapes", async ({ page }) => {
    await gotoLab(page, "overlap-audit", { diagram: "annotations" });
    await expect(page.getByTestId("audit-summary")).toHaveAttribute("data-total", "0");

    // On the real canvas: no edge label covers a note or a shape (zones and text may sit under one).
    await seed(page, annotatedKafka);
    await gotoCanvas(page, SLUG);
    await expect(annotation(page, "legacy")).toBeVisible();
    await page.waitForTimeout(400);
    const problems = await page.evaluate(() => {
      const rect = (el: Element) => el.getBoundingClientRect();
      const solid = [...document.querySelectorAll('[data-testid^="annotation-"][data-obstacle="1"]')];
      const labels = [...document.querySelectorAll('[data-testid^="edge-label-"]')];
      const out: string[] = [];
      for (const l of labels)
        for (const s of solid) {
          const a = rect(l),
            b = rect(s);
          if (a.x + 0.5 < b.right && b.x + 0.5 < a.right && a.y + 0.5 < b.bottom && b.y + 0.5 < a.bottom)
            out.push(`${l.getAttribute("data-testid")} on ${s.getAttribute("data-testid")}`);
        }
      return { out, solid: solid.length };
    });
    expect(problems.solid).toBe(3);
    expect(problems.out).toEqual([]);
  });

  test("live view keeps annotations, dims them, and sends no traffic to or from them", async ({ page }) => {
    const diagram = {
      format: "diagrams/v1",
      title: "Only a shape downstream",
      nodes: [{ id: "web", stencil: "client.browser", label: "Storefront", x: 40, y: 200 }],
      edges: [{ id: "to-shape", from: "web", to: "box", kind: "async" }],
      annotations: [
        { id: "box", kind: "shape", shape: "rect", text: "Somewhere", x: 400, y: 190, width: 160, height: 90 },
        { id: "memo", kind: "note", text: "Not simulated", x: 40, y: 360, width: 200, height: 90 },
      ],
    };
    await seed(page, diagram);
    await gotoCanvas(page, SLUG);
    await expect(annotation(page, "box")).toBeVisible();
    const opacity = () =>
      annotation(page, "memo").evaluate((el) => Number(getComputedStyle(el.parentElement ?? el).opacity));
    expect(await opacity()).toBe(1);
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(opacity).toBeLessThan(0.8);
    await expect(annotation(page, "box")).toBeVisible();
    // Traffic leaves the storefront, but its only edge ends on a shape: nothing is ever drawn.
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(250);
      expect(Number((await page.getByTestId("live-canvas").getAttribute("data-particles")) ?? 0)).toBe(0);
    }
    // T adds nothing while live.
    await page.keyboard.press("t");
    await expect(page.getByTestId("annotation-editor")).toHaveCount(0);
  });

  test("live control: the same diagram with a real node downstream does draw particles", async ({ page }) => {
    await seed(page, {
      format: "diagrams/v1",
      title: "Control",
      nodes: [
        { id: "web", stencil: "client.browser", label: "Storefront", x: 40, y: 200 },
        { id: "api", stencil: "service.go", label: "Checkout", x: 400, y: 200 },
      ],
      edges: [{ id: "real", from: "web", to: "api", kind: "async" }],
    });
    await gotoCanvas(page, SLUG);
    await page.getByTestId("live-toggle").click();
    await expect
      .poll(async () => Number((await page.getByTestId("live-canvas").getAttribute("data-particles")) ?? 0), {
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
  });
});
