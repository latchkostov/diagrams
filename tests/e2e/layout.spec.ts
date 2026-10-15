import type { Page } from "@playwright/test";
import { test, expect, expectNoErrors, publicExamples, waitForStableBox, pageLoadTimeout } from "./fixtures";

/**
 * Overlap audit on the real canvas. Only public fixtures from src/examples/*.json,
 * at the default fit view, in both themes:
 *  - no two nodes overlap,
 *  - no edge label pill covers a node or another label,
 *  - no node sits under floating chrome (title card, minimap, zoom controls, live toggle).
 * Geometry is DOM bounding boxes, selected by data-testid only.
 */

interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const TOL = 0.5;
const overlaps = (a: Box, b: Box) =>
  a.x + TOL < b.x + b.width && b.x + TOL < a.x + a.width && a.y + TOL < b.y + b.height && b.y + TOL < a.y + a.height;

/** Waits until the first node stops moving (fit-view animations done). */
async function settle(page: Page) {
  const first = page.getByTestId(/^node-(?!editor)/).first();
  await expect(first).toBeVisible();
  await waitForStableBox(first);
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element, id: string) => {
      const r = el.getBoundingClientRect();
      return { id, x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const byPrefix = (prefix: string, skip: RegExp) =>
      [...document.querySelectorAll(`[data-testid^="${prefix}"]`)]
        .map((el) => ({ el, id: el.getAttribute("data-testid") ?? "" }))
        .filter(({ id }) => !skip.test(id))
        .map(({ el, id }) => box(el, id.slice(prefix.length)))
        .filter((b) => b.width > 0 && b.height > 0);
    const panels = ["diagram-card", "canvas-minimap", "canvas-controls", "live-toggle", "live-controls"].flatMap(
      (id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return el ? [box(el, id)] : [];
      },
    );
    return {
      nodes: byPrefix("node-", /^node-editor/),
      labels: byPrefix("edge-label-", /^edge-label-input$/),
      panels: panels.filter((b) => b.width > 0 && b.height > 0),
    };
  });
}

/** Each audit runs in this many tests (every PARTS-th fixture), so the shards' workers share them. */
const PARTS = 8;
const part = (i: number) => publicExamples.filter((_, j) => j % PARTS === i);
const parts = Array.from({ length: PARTS }, (_, i) => i);

for (const theme of ["light", "dark"] as const) {
  test.describe(`layout audit (${theme})`, () => {
    test.use({ colorScheme: theme });

    for (const k of parts)
      test(`every public fixture is overlap-free at fit view (${theme}, part ${k + 1} of ${PARTS})`, async ({
        page,
        consoleErrors,
      }) => {
        expect(part(k).length).toBeGreaterThan(0);
        const problems: string[] = [];
        for (const { slug } of part(k)) {
          await page.goto(`./?view=canvas&example=${encodeURIComponent(slug)}`);
          await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
          if ((await page.getByTestId(/^node-(?!editor)/).count()) === 0) continue;
          await settle(page);
          const { nodes, labels, panels } = await measure(page);
          const tag = slug;
          for (let i = 0; i < nodes.length; i++)
            for (let j = i + 1; j < nodes.length; j++)
              if (overlaps(nodes[i], nodes[j]))
                problems.push(`${tag}: node ${nodes[i].id} overlaps node ${nodes[j].id}`);
          for (const l of labels)
            for (const n of nodes) if (overlaps(l, n)) problems.push(`${tag}: label of ${l.id} covers node ${n.id}`);
          for (let i = 0; i < labels.length; i++)
            for (let j = i + 1; j < labels.length; j++)
              if (overlaps(labels[i], labels[j]))
                problems.push(`${tag}: label of ${labels[i].id} overlaps label of ${labels[j].id}`);
          for (const p of panels)
            for (const n of nodes) if (overlaps(p, n)) problems.push(`${tag}: node ${n.id} is under ${p.id}`);
        }
        expect(problems, problems.join("\n")).toEqual([]);
        expectNoErrors(consoleErrors);
      });
  });
}

test("edges route around cards and labels never cover them after a drag", async ({ page }) => {
  // The Lab's obstacle course: edges that skip columns must bend around the cards in between.
  await page.goto("./?view=lab&preset=overlap-audit&diagram=obstacles");
  const summary = page.getByTestId("audit-summary");
  await expect(summary).toBeVisible();
  await expect(summary).toHaveAttribute("data-total", "0");
  // Drag a node into the middle of things: the audit stays clean (routes and labels re-place).
  const node = page.getByTestId("node-n1-1");
  const b = await node.boundingBox();
  if (!b) throw new Error("node not visible");
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  for (const kind of ["label-node", "label-label", "edge-node", "node-node"])
    await expect(page.getByTestId(`audit-count-${kind}`)).toHaveAttribute("data-count", "0");
});

test("the title card folds to a chip when nodes go under it", async ({ page }) => {
  await page.goto("./?view=lab&preset=edges-obstacles&cols=4&rows=3&gap=400");
  await page.getByTestId("lab-open-editor").click();
  await settle(page);
  const card = page.getByTestId("diagram-card");
  await expect(card).not.toHaveAttribute("data-collapsed", "1");
  // Zoom in around the middle (Ctrl+wheel; the wheel alone pans): the diagram spreads out under the card.
  const wrap = await page.getByTestId("canvas-wrap").boundingBox();
  if (!wrap) throw new Error("canvas not visible");
  await page.mouse.move(wrap.x + wrap.width / 2, wrap.y + wrap.height / 2);
  await page.keyboard.down(process.platform === "darwin" ? "Meta" : "Control");
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(80);
  }
  await page.keyboard.up(process.platform === "darwin" ? "Meta" : "Control");
  await expect(card).toHaveAttribute("data-collapsed", "1");
  // Fit again: the card has room and unfolds.
  await page.getByTestId("fit-view-button").click();
  await expect(card).not.toHaveAttribute("data-collapsed", "1", { timeout: 3000 });
});

for (const ex of publicExamples)
  test(`auto-layout never produces overlaps (${ex.slug})`, async ({ page, consoleErrors }) => {
    await page.goto(`./?view=canvas&example=${encodeURIComponent(ex.slug)}`);
    await settle(page);
    const wrap = await page.getByTestId("canvas-wrap").boundingBox();
    if (!wrap) throw new Error("canvas not visible");
    // Empty pane: just above the bottom edge, left of the minimap and right of the controls.
    await page.mouse.click(wrap.x + wrap.width * 0.55, wrap.y + wrap.height - 14, { button: "right" });
    await page.getByTestId("context-menu-item-canvas.auto-layout").click();
    await settle(page);
    const { nodes, labels } = await measure(page);
    const problems: string[] = [];
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++)
        if (overlaps(nodes[i], nodes[j])) problems.push(`${ex.slug}: node ${nodes[i].id} overlaps ${nodes[j].id}`);
    for (const l of labels)
      for (const n of nodes) if (overlaps(l, n)) problems.push(`${ex.slug}: label of ${l.id} covers ${n.id}`);
    expect(problems, problems.join("\n")).toEqual([]);
    expectNoErrors(consoleErrors);
  });

for (const failure of ["read", "write"] as const) {
  test(`palette stays usable when preference storage ${failure}s fail`, async ({ page, consoleErrors }) => {
    await page.addInitScript((failure) => {
      const check = (key: string) => {
        if (key.startsWith("diagrams.palette"))
          throw new DOMException(
            "Preference storage unavailable",
            failure === "read" ? "SecurityError" : "QuotaExceededError",
          );
      };
      if (failure === "read") {
        const original = Storage.prototype.getItem;
        Storage.prototype.getItem = function (key: string) {
          check(key);
          return original.call(this, key);
        };
      } else {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key: string, value: string) {
          check(key);
          original.call(this, key, value);
        };
      }
    }, failure);
    await page.goto(`./?view=canvas&example=${publicExamples[0].slug}`);
    await expect(page.getByTestId("palette-family")).toHaveValue("all");
    await page.getByTestId("palette-family").selectOption("aws");
    await expect(page.getByTestId("palette-item-aws.sqs")).toBeVisible();
    await page.getByTestId("palette-section-messaging").click();
    await expect(page.getByTestId("palette-section-messaging")).toHaveAttribute("aria-expanded", "false");
    await page.getByTestId("palette-search").fill("sqs");
    await page.getByTestId("palette-search").press("Enter");
    await expect(page.getByTestId("node-sqs-1")).toBeVisible();
    expectNoErrors(consoleErrors);
  });
}
