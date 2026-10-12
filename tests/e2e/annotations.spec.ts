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
async function settle(page: Page, nodeId = "payments") {
  const node = page.getByTestId(`node-${nodeId}`);
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
  for (const control of ["top-left", "line-left"] as const) {
    test(`${control} resize stops at the persistence limit and a connected shape reopens`, async ({
      page,
      consoleErrors,
    }) => {
      await seed(page, {
        format: "diagrams/v1",
        title: "Resize budget",
        nodes: [{ id: "web", stencil: "client.browser", label: "Web", x: 0, y: 0 }],
        annotations: [{ id: "shape", kind: "shape", text: "Shape", x: 400, y: 0, width: 160, height: 90 }],
        edges: [{ id: "edge", from: "web", to: "shape" }],
      });
      await gotoCanvas(page, SLUG);
      await annotation(page, "shape").click();
      await page.getByTestId("inspector-field-width").fill("19990");
      await page.getByTestId("inspector-field-width").press("Enter");
      if (control === "top-left") {
        await page.getByTestId("inspector-field-height").fill("19990");
        await page.getByTestId("inspector-field-height").press("Enter");
      }
      let previous = "";
      await expect
        .poll(
          async () => {
            const current = JSON.stringify(await annotation(page, "shape").boundingBox());
            const stable = current === previous;
            previous = current;
            return stable;
          },
          { intervals: [100, 150, 250] },
        )
        .toBe(true);
      const testId = control === "line-left" ? "annotation-resize-line-shape-left" : "annotation-resize-shape-top-left";
      const handle = await box(page.getByTestId(testId));
      const startY = handle.y + handle.height * (control === "line-left" ? 0.25 : 0.5);
      const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("data-testid"), {
        x: handle.x + handle.width / 2,
        y: startY,
      });
      expect(hit).toBe(testId);
      await page.mouse.move(handle.x + handle.width / 2, startY);
      await page.mouse.down();
      await page.mouse.move(handle.x - 100, control === "line-left" ? startY : handle.y - 100, { steps: 8 });
      await page.mouse.up();
      const width = () => annotation(page, "shape").evaluate((el) => el.parentElement?.style.width);
      await expect.poll(width).toBe("20000px");
      if (control === "top-left")
        await expect
          .poll(() => annotation(page, "shape").evaluate((el) => el.parentElement?.style.height))
          .toBe("20000px");
      await page.waitForTimeout(700);
      await page.reload();
      await expect(annotation(page, "shape")).toBeAttached();
      await expect.poll(width).toBe("20000px");
      await expect(page.getByTestId("edge-edge")).toBeAttached();
      expectNoErrors(consoleErrors);
    });
  }
  test("live caption text meets AA contrast in both themes after compositing", async ({ page }) => {
    const colors = ["neutral", "yellow", "green", "blue", "purple", "red"];
    await seed(page, {
      ...kafka,
      annotations: colors.map((color, i) => ({
        id: `caption-${color}`,
        kind: "text",
        text: color,
        color,
        x: 100 + i * 150,
        y: 80,
        width: 140,
        height: 30,
      })),
    });
    await gotoCanvas(page, SLUG);
    await page.getByTestId("live-toggle").click();
    for (const theme of ["light", "dark"]) {
      await expect(page.getByTestId("theme-toggle")).toHaveAccessibleName(
        theme === "light" ? "Switch to dark theme" : "Switch to light theme",
      );
      // Measured once the live view and theme transitions (opacity, colours) have settled.
      const measure = () =>
        page.getByTestId("canvas-wrap").evaluate((wrap) => {
          const ctx = document.createElement("canvas").getContext("2d");
          if (!ctx) throw new Error("Missing color context");
          const rgb = (color: string) => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
            return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
          };
          const luminance = (channels: number[]) =>
            channels
              .map((v) => {
                const c = v / 255;
                return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
              })
              .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
          const bg = rgb(getComputedStyle(wrap).getPropertyValue("--bg"));
          return [...wrap.querySelectorAll('[data-testid^="annotation-text-caption-"]')].map((el) => {
            let opacity = 1;
            for (let parent: Element | null = el; parent; parent = parent.parentElement)
              opacity *= Number(getComputedStyle(parent).opacity);
            const ink = rgb(getComputedStyle(el).color).map((c, i) => c * opacity + bg[i] * (1 - opacity));
            const a = luminance(ink),
              b = luminance(bg);
            return { id: el.getAttribute("data-testid"), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
          });
        });
      await expect
        .poll(async () => {
          const contrasts = await measure();
          if (contrasts.length !== colors.length) return [`${contrasts.length} of ${colors.length} captions`];
          return contrasts.filter((c) => c.ratio < 4.5).map((c) => `${theme}: ${c.id} at ${c.ratio.toFixed(2)}:1`);
        })
        .toEqual([]);
      if (theme === "light") await page.getByTestId("theme-toggle").click();
    }
  });
  test("keyboard commits restore canvas focus for F2, movement and Delete; blur keeps the next control focused", async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, SLUG);
    await page.getByTestId("palette-annotate-note").click();
    await typeAndCommit(page, "Keyboard note");
    const focused = () => annotation(page, "note-1").evaluate((el) => el.parentElement === document.activeElement);
    await expect.poll(focused).toBe(true);
    const before = await box(annotation(page, "note-1"));
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await box(annotation(page, "note-1"))).x).toBeGreaterThan(before.x);
    await page.keyboard.press("F2");
    await expect(page.getByTestId("annotation-editor")).toBeFocused();
    await page.keyboard.press(`${MOD}+Enter`);
    await expect.poll(focused).toBe(true);
    await page.keyboard.press("F2");
    await expect(page.getByTestId("annotation-editor")).toBeFocused();
    await page.getByTestId("inspector-field-text").click();
    await expect(page.getByTestId("inspector-field-text")).toBeFocused();
    await expect(page.getByTestId("annotation-editor")).toHaveCount(0);
    await annotation(page, "note-1").click();
    await page.keyboard.press("F2");
    await page.keyboard.press("Escape");
    await expect.poll(focused).toBe(true);
    await page.keyboard.press("Delete");
    await expect(annotation(page, "note-1")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("inline auto-growth and inspector text stay within persistence limits on reload", async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, SLUG);
    await settle(page);
    await page.getByTestId("palette-annotate-note").click();
    await expect(page.getByTestId("annotation-editor")).toBeFocused();
    await page.keyboard.insertText("x\n".repeat(1300));
    await page.keyboard.press("Escape");
    const size = () =>
      annotation(page, "note-1").evaluate((el) => ({
        width: el.parentElement?.style.width,
        height: el.parentElement?.style.height,
      }));
    await expect.poll(async () => (await size()).height).toBe("20000px");
    const field = page.getByTestId("inspector-field-text");
    await field.fill("x".repeat(10050));
    await expect.poll(async () => (await field.inputValue()).length).toBe(10000);
    await page.waitForTimeout(700);
    await page.reload();
    await expect(annotation(page, "note-1")).toBeVisible();
    await expect.poll(async () => (await size()).height).toBe("20000px");
    await expect.poll(async () => (await page.getByTestId("annotation-text-note-1").textContent())?.length).toBe(10000);
    expectNoErrors(consoleErrors);
  });

  test("Send to back restores visible stacking through Undo, Redo and reload", async ({ page, consoleErrors }) => {
    await gotoLab(page, "overlapping-layers");
    await page.getByTestId("lab-open-editor").click();
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    // The same Lab fixture runs on the editor's real persistence/history path.
    const top = () =>
      page.getByTestId("node-service").evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return hit
          ?.closest('[data-testid="annotation-note"], [data-testid="node-service"]')
          ?.getAttribute("data-testid");
      });
    const clear = async () => {
      await page.getByTestId("canvas-wrap").click({ position: await emptySpot(page) });
      await expect
        .poll(() => annotation(page, "note").evaluate((el) => el.classList.contains("is-selected")))
        .toBe(false);
    };
    await expect.poll(top).toBe("annotation-note");
    await settle(page, "service");
    await annotation(page, "note").click({ button: "right" });
    await menuItem(page, "annotation.back").click();
    await clear();
    await expect.poll(top).toBe("node-service");
    await page.keyboard.press(`${MOD}+z`);
    await clear();
    await expect.poll(top).toBe("annotation-note");
    await page.keyboard.press(`${MOD}+Shift+z`);
    await clear();
    await expect.poll(top).toBe("node-service");
    await page.waitForTimeout(700);
    await page.reload();
    await expect(page.getByTestId("node-service")).toBeVisible();
    await expect.poll(top).toBe("node-service");
    expectNoErrors(consoleErrors);
  });
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

    // One Shape tile: a rectangle, whose outline the inspector changes.
    await page.getByTestId("palette-annotate-shape").click();
    await expect(annotation(page, "shape-1")).toHaveAttribute("data-shape", "rect");
    await page.getByTestId("inspector-shape-diamond").click();
    await expect(annotation(page, "shape-1")).toHaveAttribute("data-shape", "diamond");
    // The search finds the Annotate items too, each outline by name.
    await page.getByTestId("palette-search").fill("sticky");
    await expect(page.getByTestId("palette-annotate-note")).toBeVisible();
    await page.getByTestId("palette-search").fill("ellipse");
    await page.getByTestId("palette-annotate-shape-ellipse").click();
    await expect(annotation(page, "shape-2")).toHaveAttribute("data-shape", "ellipse");
    expectNoErrors(consoleErrors);
  });

  test("a click in the rail places each annotation in free space, never on a node or the last one", async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, SLUG);
    await settle(page);
    for (const kind of ["note", "shape", "note", "text"] as const) {
      await page.getByTestId(`palette-annotate-${kind}`).click();
      if (kind !== "shape") await page.keyboard.press("Escape");
    }
    await expect(annotation(page, "text-1")).toBeVisible();
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".react-flow__node")].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          annotation: el.classList.contains("react-flow__node-annotation"),
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
        };
      }),
    );
    const overlap = (a: (typeof boxes)[number], b: (typeof boxes)[number]) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const added = boxes.filter((b) => b.annotation);
    expect(added).toHaveLength(4);
    for (const a of added) for (const b of boxes) if (a !== b) expect(overlap(a, b)).toBe(false);
    expectNoErrors(consoleErrors);
  });

  test("T adds text at the pointer; double-click edits it, multi-line", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId("node-payments")).toBeVisible();
    const wrap = await box(page.getByTestId("canvas-wrap"));
    // Left of centre, but clear of the diagram card (top left, 380 px wide) at any canvas width.
    const spot = await emptySpot(page, -150);
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

  test("live view keeps annotation text opaque and sends no traffic to or from them", async ({ page }) => {
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
    await expect.poll(opacity).toBe(1);
    // Presenting, they're part of the story: full strength. Esc steps back out of presentation only.
    await page.getByTestId("present-toggle").click();
    await expect.poll(opacity).toBe(1);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("live-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(opacity).toBe(1);
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
