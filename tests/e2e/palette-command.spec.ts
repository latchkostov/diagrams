import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, gotoGallery, expectNoErrors, fitDiagram, waitForStableViewport } from "./fixtures";

// Command palette (Ctrl/Cmd+K). Selectors are data-testid only. Uses the public Kafka example
// (ids from src/examples/kafka-order-pipeline.json).

const SLUG = "kafka-order-pipeline";
const MOD = "ControlOrMeta";

const palette = (page: Page) => page.getByTestId("command-palette");
const input = (page: Page) => page.getByTestId("command-input");
const items = (page: Page) => page.getByTestId(/^command-item-/);
const item = (page: Page, id: string) => page.getByTestId(`command-item-${id}`);

async function openPalette(page: Page) {
  await page.keyboard.press(`${MOD}+k`);
  await expect(palette(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
}

/** Nodes and edges on the canvas (not their labels, tooltips or inline editors). */
async function counts(page: Page): Promise<{ nodes: number; edges: number }> {
  return {
    nodes: await page.getByTestId(/^node-(?!tooltip$|editor-)/).count(),
    edges: await page.getByTestId(/^edge-(?!label-)/).count(),
  };
}

async function firstItemId(page: Page): Promise<string> {
  const id = await items(page).first().getAttribute("data-testid");
  return id?.slice("command-item-".length) ?? "";
}

test.describe("command palette", () => {
  test.beforeEach(async ({ page }) => {
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId("node-payments")).toBeVisible();
  });

  test("Ctrl+K opens it as a modal combobox, Esc closes it and focus goes back", async ({ page, consoleErrors }) => {
    const fit = page.getByTestId("fit-view-button");
    await fit.focus();
    await expect(fit).toBeFocused();

    await openPalette(page);
    await expect(palette(page)).toHaveAttribute("role", "dialog");
    await expect(palette(page)).toHaveAttribute("aria-modal", "true");
    await expect(input(page)).toHaveAttribute("role", "combobox");
    await expect(page.getByTestId("command-list")).toHaveAttribute("role", "listbox");
    await expect(input(page)).toHaveAttribute("placeholder", "Search actions, nodes and stencils…");
    // The prefixes are taught by the footer's chips, not repeated in the placeholder.
    for (const chip of ["command-prefix-actions", "command-prefix-nodes", "command-prefix-stencils"])
      await expect(page.getByTestId(chip)).toBeVisible();

    // The highlighted option is announced through aria-activedescendant and moves with the arrows.
    const activeId = async () => (await input(page).getAttribute("aria-activedescendant")) ?? "";
    const first = await activeId();
    expect(first).not.toBe("");
    await expect(items(page).first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    expect(await activeId()).not.toBe(first);
    await expect(items(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    expect(await activeId()).toBe(first);

    // Tab stays inside the dialog.
    for (let i = 0; i < 5; i++) await page.keyboard.press("Tab");
    expect(await palette(page).evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await input(page).focus();

    await page.keyboard.press("Escape");
    await expect(palette(page)).toHaveCount(0);
    await expect(fit).toBeFocused();
    // Esc in the palette doesn't also clear the canvas or leave anything.
    await expect(page.getByTestId("canvas-view")).toBeVisible();

    // Ctrl+K toggles, and a click on the scrim closes.
    await openPalette(page);
    await page.keyboard.press(`${MOD}+k`);
    await expect(palette(page)).toHaveCount(0);
    await openPalette(page);
    await page.mouse.click(10, 300);
    await expect(palette(page)).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test('typing "sb" and Enter adds a Service Bus stencil', async ({ page, consoleErrors }) => {
    const before = await counts(page);
    await openPalette(page);
    await input(page).fill("sb");
    expect(await firstItemId(page)).toMatch(/^stencil:azure\.service-bus\.(queue|topic)$/);
    await page.keyboard.press("Enter");
    await expect(palette(page)).toHaveCount(0);
    await expect.poll(() => counts(page)).toEqual({ nodes: before.nodes + 1, edges: before.edges });
    await expect(page.getByTestId("inspector-field-label")).toHaveValue(/Service Bus (Queue|Topic)/);
    expectNoErrors(consoleErrors);
  });

  test("with one node selected, a stencil is added next to it and connected, as one undo step", async ({
    page,
    consoleErrors,
  }) => {
    const before = await counts(page);
    await page.getByTestId("node-payments").click();
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("Payments service");
    await openPalette(page);
    await input(page).fill("pg");
    await expect(item(page, "stencil:postgres")).toContainText("after Payments service");
    expect(await firstItemId(page)).toBe("stencil:postgres");
    await page.keyboard.press("Enter");
    await expect.poll(() => counts(page)).toEqual({ nodes: before.nodes + 1, edges: before.edges + 1 });
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("PostgreSQL");

    // It lands to the right of the source node. The view pans to show it: wait for the pan to settle, then read
    // both cards in one frame (two reads in a row could straddle a frame of the pan).
    await waitForStableViewport(page);
    const [source, added] = await page.evaluate(() =>
      ['[data-testid="node-payments"]', '[data-testid^="node-postgres"]'].map((sel) => {
        const r = document.querySelector(sel)?.getBoundingClientRect();
        return r ? { x: r.x, width: r.width } : null;
      }),
    );
    if (!source || !added) throw new Error("Expected both nodes on screen");
    expect(added.x).toBeGreaterThan(source.x + source.width);

    // Node and edge undo together.
    await page.getByTestId("undo-button").click();
    await expect.poll(() => counts(page)).toEqual(before);
    expectNoErrors(consoleErrors);
  });

  test("goes to a node by label, selecting it", async ({ page, consoleErrors }) => {
    await page.getByTestId("example-picker").focus();
    await openPalette(page);
    await input(page).fill("@inventory");
    expect(await firstItemId(page)).toBe("node:inventory");
    await page.keyboard.press("Enter");
    await expect(palette(page)).toHaveCount(0);
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("Inventory service");
    await expect(page.getByTestId("node-inventory")).toBeInViewport();
    expect(await page.getByTestId("node-inventory").evaluate((el) => document.activeElement?.contains(el))).toBe(true);
    await page.keyboard.press("F2");
    await expect(page.getByTestId("inspector-field-label")).toBeFocused();
    await page.keyboard.press("Escape");

    // With a node selected, its actions are offered with their noun.
    await openPalette(page);
    await input(page).fill("rename");
    await expect(item(page, "action:node.rename")).toHaveText(/Rename node/);
    await page.keyboard.press("Escape");
    expectNoErrors(consoleErrors);
  });

  test('runs "Go live", then offers live actions and saved simulations', async ({ page, consoleErrors }) => {
    const toggle = page.getByTestId("live-toggle");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await openPalette(page);
    await input(page).fill("go live");
    expect(await firstItemId(page)).toBe("live:toggle");
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    // Live mode: live verbs appear, edit-only ones (and stencils) don't.
    await openPalette(page);
    await input(page).fill(">");
    await expect(item(page, "action:sim.reset")).toBeVisible();
    await expect(item(page, "action:canvas.auto-layout")).toHaveCount(0);
    await input(page).fill("+");
    await expect(items(page)).toHaveCount(0);
    await page.keyboard.press("Escape");

    // A saved simulation runs in the session.
    await openPalette(page);
    await input(page).fill("payments goes down");
    expect(await firstItemId(page)).toBe("sim:payments-outage");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("live-sim-picker")).toHaveValue("payments-outage");

    // And back to editing.
    await openPalette(page);
    await input(page).fill("back to editing");
    expect(await firstItemId(page)).toBe("live:toggle");
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    expectNoErrors(consoleErrors);
  });

  test("a simulation from edit mode goes live and runs it", async ({ page, consoleErrors }) => {
    await openPalette(page);
    // "Black Friday" alone also names another example; this query names only the Kafka example's simulation.
    await input(page).fill("black friday 2,000 orders");
    expect(await firstItemId(page)).toBe("sim:black-friday");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("live-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("live-sim-picker")).toHaveValue("black-friday");
    expectNoErrors(consoleErrors);
  });

  test("go to node honours reduced motion for JavaScript viewport navigation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByTestId("node-payments").click();
    await openPalette(page);
    await input(page).fill("@inventory");
    const changes = await page.getByTestId("canvas-wrap").evaluate(async (wrap) => {
      const viewport = wrap.querySelector<HTMLElement>(".react-flow__viewport");
      const command = document.querySelector<HTMLElement>('[data-testid="command-item-node:inventory"]');
      if (!viewport || !command) throw new Error("Missing viewport or command");
      // From the first frame the view moves, the 20 frames after it: counted in frames, not over a span of wall
      // time, so a busy machine (fewer frames a second, a late first move) doesn't change the answer.
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const before = viewport.style.transform;
      const seen = new Set([before]);
      command.click();
      for (let i = 0; i < 300 && viewport.style.transform === before; i++) await frame();
      for (let i = 0; i < 20; i++) {
        seen.add(viewport.style.transform);
        await frame();
      }
      seen.add(viewport.style.transform);
      return seen.size;
    });
    // It moved, in one jump: the transform before and the one after.
    expect(changes).toBe(2);
  });

  test("prefixes narrow to actions, nodes or stencils, and the footer buttons type them", async ({
    page,
    consoleErrors,
  }) => {
    await openPalette(page);
    const groups = async () =>
      new Set(await items(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-group"))));

    await input(page).fill(">");
    expect(await groups()).toEqual(new Set(["actions"]));
    await input(page).fill("@");
    expect(await groups()).toEqual(new Set(["nodes"]));
    await input(page).fill("@payments s");
    expect(await firstItemId(page)).toBe("node:payments");
    await input(page).fill("+");
    expect(await groups()).toEqual(new Set(["stencils"]));
    await input(page).fill("+kafka topic");
    expect(await firstItemId(page)).toBe("stencil:kafka.topic");

    await input(page).fill("fit");
    await page.getByTestId("command-prefix-actions").click();
    await expect(input(page)).toHaveValue(">fit");
    await expect(input(page)).toBeFocused();
    await page.getByTestId("command-prefix-nodes").click();
    await expect(input(page)).toHaveValue("@fit");

    // Submenus drill in: Enter on "Export" lists its entries.
    await input(page).fill(">export");
    await expect(items(page).first()).toHaveAttribute("data-testid", "command-item-action:canvas.export");
    await page.keyboard.press("Enter");
    await expect(palette(page)).toBeVisible();
    await expect(item(page, "action:export:drawio")).toBeVisible();
    await expect(item(page, "action:canvas.export")).toHaveCount(0);
    await expect(items(page).first()).toHaveAttribute("aria-selected", "true");
    // The second Enter runs a leaf instead of repeatedly selecting the parent.
    // Use the native file leaf: image rendering/cancellation has its own full-size suite.
    await input(page).fill("Diagram file");
    await expect(item(page, "action:export:json")).toHaveAttribute("aria-selected", "true");
    const [download] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Enter")]);
    expect(await download.failure()).toBeNull();
    await expect(palette(page)).toHaveCount(0);
    await openPalette(page);

    await input(page).fill("zzzzqqq");
    await expect(page.getByTestId("command-empty")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("recently used commands float to the top", async ({ page, consoleErrors }) => {
    const run = async (query: string, id: string) => {
      await openPalette(page);
      await input(page).fill(query);
      await item(page, id).click();
      await expect(palette(page)).toHaveCount(0);
    };
    await run("fit view", "action:canvas.fit");
    await openPalette(page);
    await expect(page.getByTestId("command-group-recent")).toBeVisible();
    expect(await firstItemId(page)).toBe("action:canvas.fit");
    await page.keyboard.press("Escape");

    await run("select all", "action:canvas.select-all");
    await page.getByTestId("canvas-wrap").click({ position: { x: 600, y: 90 } });
    await openPalette(page);
    const recent = page.getByTestId("command-group-recent").getByTestId(/^command-item-/);
    await expect(recent).toHaveCount(2);
    await expect(recent.nth(0)).toHaveAttribute("data-testid", "command-item-action:canvas.select-all");
    await expect(recent.nth(1)).toHaveAttribute("data-testid", "command-item-action:canvas.fit");

    // Remembered across reloads; a recent command also wins a tie while typing.
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.getByTestId("node-payments")).toBeVisible();
    await openPalette(page);
    expect(await firstItemId(page)).toBe("action:canvas.select-all");
    expectNoErrors(consoleErrors);
  });

  test("fits a 1024px window without overlap, and works from the gallery", async ({ page, consoleErrors }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    // A smaller window doesn't refit a diagram fitted to the larger one: Payments can be under the AI rail. A fit
    // made before the canvas has taken the new width fits the old one, so fit until Payments is clear of the rail
    // (a layout race, not a matter of time).
    const payments = page.getByTestId("node-payments");
    await expect(async () => {
      await fitDiagram(page);
      const [node, rail] = await Promise.all([payments.boundingBox(), page.getByTestId("ai-rail").boundingBox()]);
      expect(node && (!rail || node.x + node.width <= rail.x)).toBeTruthy();
    }).toPass({ timeout: 10_000 });
    await payments.click();
    await openPalette(page);
    await input(page).fill("a");
    const box = await palette(page).boundingBox();
    if (!box) throw new Error("Expected a visible palette");
    expect(box.width).toBeLessThanOrEqual(640);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1024);
    expect(box.y + box.height).toBeLessThanOrEqual(700);
    // No row spills out of its box (labels ellipsize, hints shrink).
    const overflowing = await items(page).evaluateAll((els) =>
      els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.getAttribute("data-testid")),
    );
    expect(overflowing).toEqual([]);
    await page.keyboard.press("Escape");

    await gotoGallery(page);
    await openPalette(page);
    await input(page).fill("aws serverless orders");
    expect(await firstItemId(page)).toBe("diagram:aws-serverless-orders");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    await expect(page).toHaveURL(/example=aws-serverless-orders/);
    expectNoErrors(consoleErrors);
  });
});
