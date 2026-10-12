import { test, expect, gotoCanvas, expectNoErrors, STORAGE_KEYS } from "./fixtures";
import { MOD, SLUG, must, nodeCount, openAdvanced, savedDiagram } from "./ai-helpers";
import { readFileSync } from "node:fs";
import { join } from "node:path";
/** Where "payments" is in flow coordinates: the saved edits, or the example as shipped when there are none. */
async function paymentsX(page: import("@playwright/test").Page) {
  const saved = (await savedDiagram(page))?.nodes.find((n) => n.id === "payments");
  if (saved) return (saved as unknown as { x: number }).x;
  const original = JSON.parse(readFileSync(join(process.cwd(), "src/examples/kafka-order-pipeline.json"), "utf8")) as {
    nodes: { id: string; x: number }[];
  };
  return must(
    original.nodes.find((n) => n.id === "payments"),
    "payments",
  ).x;
}

// The docked AI panel: part of the tooling beside the canvas, with a thread per diagram (Undo this
// change, Revert to here, a highlight of what each turn touched) kept in this browser only.

const ADD_WORKER = JSON.stringify([
  { op: "add_node", kind: ".NET consumer", label: "billing-worker", key: "w" },
  { op: "connect", from: "orders.created.v1", to: "w" },
]);
const ADD_DLQ = JSON.stringify([
  { op: "add_node", kind: "Service Bus queue", label: "billing-dlq", key: "q" },
  { op: "connect", from: "billing-worker", to: "q" },
]);

async function applyTurn(page: import("@playwright/test").Page, request: string, reply: string) {
  await page.getByTestId("ai-request").fill(request);
  await page.getByTestId("ai-reply").fill(reply);
  await page.getByTestId("ai-apply").click();
  await expect(page.getByTestId("ai-error")).toHaveCount(0);
}

/** A node's id by its label, once the autosave has it. */
async function nodeIdByLabel(page: import("@playwright/test").Page, label: string) {
  await expect.poll(async () => (await savedDiagram(page))?.nodes.some((n) => n.label === label)).toBe(true);
  return must(
    must(await savedDiagram(page), "saved edits").nodes.find((n) => n.label === label),
    label,
  ).id;
}

test.describe("AI panel dock", () => {
  test.beforeEach(async ({ page }) => {
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId("node-payments")).toBeVisible();
  });

  test("docks beside the canvas, shrinking it, and remembers open state and width", async ({ page }) => {
    const before = must(await page.getByTestId("canvas-wrap").boundingBox(), "canvas");
    await expect(page.getByTestId("ai-rail")).toBeVisible();
    await openAdvanced(page);
    const dock = must(await page.getByTestId("ai-dock").boundingBox(), "dock");
    const after = must(await page.getByTestId("canvas-wrap").boundingBox(), "canvas");
    expect(after.width).toBeLessThan(before.width);
    expect(after.x + after.width).toBeLessThanOrEqual(dock.x);
    expect(dock.x + dock.width).toBeLessThanOrEqual(1440);

    // Resize from the keyboard (the window-splitter pattern), then reload: open and wider.
    await page.getByTestId("ai-resize").focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect
      .poll(async () => must(await page.getByTestId("ai-dock").boundingBox(), "dock").width)
      .toBe(dock.width + 48);
    await page.reload();
    await expect(page.getByTestId("ai-panel")).toBeVisible();
    expect(must(await page.getByTestId("ai-dock").boundingBox(), "dock").width).toBe(dock.width + 48);
  });

  test("Ctrl+I opens and focuses it, and from inside hides it", async ({ page }) => {
    await page.getByTestId("canvas-wrap").click({ position: { x: 30, y: 300 } });
    await page.keyboard.press(`${MOD}+i`);
    await expect(page.getByTestId("ai-panel")).toBeFocused();
    await page.keyboard.press(`${MOD}+i`);
    await expect(page.getByTestId("ai-panel")).toHaveCount(0);
    await expect(page.getByTestId("ai-rail")).toBeVisible();
    // Open but not focused: Ctrl+I focuses it.
    await page.keyboard.press(`${MOD}+i`);
    await page.getByTestId("canvas-wrap").click({ position: { x: 30, y: 300 } });
    await page.keyboard.press(`${MOD}+i`);
    await expect(page.getByTestId("ai-panel")).toBeFocused();
  });

  test("a thread: Undo this change on the latest turn, Revert to here, and a highlight", async ({
    page,
    consoleErrors,
  }) => {
    const before = await nodeCount(page);
    await openAdvanced(page);
    await applyTurn(page, "Add a billing worker", ADD_WORKER);
    await applyTurn(page, "Add a dead-letter queue", ADD_DLQ);
    await expect(page.getByTestId("ai-turn-1-summary")).toHaveText("+1 node, +1 connection");
    expect(await nodeCount(page)).toBe(before + 2);

    // Only the latest change offers Undo; earlier ones offer Revert to here.
    await expect(page.getByTestId("ai-turn-1-undo")).toBeVisible();
    await expect(page.getByTestId("ai-turn-0-undo")).toHaveCount(0);
    await expect(page.getByTestId("ai-turn-0-revert")).toBeVisible();
    await expect(page.getByTestId("ai-turn-1-revert")).toHaveCount(0);

    // Hovering a turn highlights what it touched.
    const dlq = await nodeIdByLabel(page, "billing-dlq");
    await page.getByTestId("ai-turn-1").hover();
    await expect
      .poll(() => page.evaluate(() => document.querySelector("style[data-ai-mark]")?.textContent ?? ""))
      .toContain(dlq);
    await page.getByTestId("ai-request").hover();
    await expect.poll(() => page.evaluate(() => !!document.querySelector("style[data-ai-mark]"))).toBe(false);

    await page.getByTestId("ai-turn-1-undo").click();
    await expect.poll(() => nodeCount(page)).toBe(before + 1);
    await expect(page.getByTestId("ai-turn-1-undone")).toBeVisible();
    // Undone, the turn can come back with Revert to here, as one undo step of its own.
    await page.getByTestId("ai-turn-1-revert").click();
    await expect.poll(() => nodeCount(page)).toBe(before + 2);
    await expect(page.getByTestId("ai-turn-2")).toHaveAttribute("data-kind", "revert");
    await expect(page.getByTestId("ai-turn-2-undo")).toBeVisible();

    await page.getByTestId("ai-turn-0-revert").click();
    await expect.poll(() => nodeCount(page)).toBe(before + 1);
    await expect(page.getByTestId(`node-${dlq}`)).toHaveCount(0);
    // A revert is itself undoable, with the editor's own undo.
    await page.getByTestId("canvas-wrap").click({ position: { x: 30, y: 300 } });
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.getByTestId(`node-${dlq}`)).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("Undo this change is bound to the turn's own step: a move made since is never undone by it", async ({
    page,
  }) => {
    const before = await nodeCount(page);
    await openAdvanced(page);
    await applyTurn(page, "Add a billing worker", ADD_WORKER);
    await expect(page.getByTestId("ai-turn-0-undo")).toBeVisible();

    // A move: the next Undo would reverse the move, so the turn no longer offers it.
    const x = () => paymentsX(page);
    const start = await x();
    await page.getByTestId("node-payments").click();
    // Snapping is on: Shift+arrow moves 50 px onto the grid.
    for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight");
    await expect.poll(x).toBe(start + 150);
    await expect(page.getByTestId("ai-turn-0-undo")).toHaveCount(0);

    // Undo the move by hand: now the turn's step is next again, and its Undo reverses only the turn.
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(x).toBe(start);
    await expect(page.getByTestId("ai-turn-0-undo")).toBeVisible();
    await page.getByTestId("ai-turn-0-undo").click();
    await expect.poll(() => nodeCount(page)).toBe(before);
    await expect(page.getByTestId("ai-turn-0-undone")).toBeVisible();
    expect(await x()).toBe(start);

    // After a reload the history is new: nothing claims to undo the turn.
    await page.getByTestId("ai-turn-0-revert").click();
    await expect.poll(() => nodeCount(page)).toBe(before + 1);
    await page.reload();
    await expect(page.getByTestId("ai-turn-1")).toBeVisible();
    await expect(page.getByTestId("ai-turn-1-undo")).toHaveCount(0);
    await expect(page.getByTestId("ai-turn-0-undo")).toHaveCount(0);
  });

  test("a malformed stored conversation is dropped, not fatal", async ({ page, consoleErrors }) => {
    await openAdvanced(page);
    await applyTurn(page, "Add a billing worker", ADD_WORKER);
    // Corrupt this diagram's stored conversation: one turn with a broken snapshot, one not a turn at all.
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith("diagrams.ai-thread.v1:"));
      if (!key) throw new Error("no stored conversation");
      localStorage.setItem(
        key,
        JSON.stringify({ turns: [{ id: "t1", request: "Old", kind: "change", after: { nodes: "oops" } }, 7] }),
      );
    });
    await page.reload();
    await expect(page.getByTestId("ai-turn-0")).toContainText("Old");
    await expect(page.getByTestId("ai-turn-1")).toHaveCount(0);
    await expect(page.getByTestId("ai-turn-0-revert")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("a pasted whole file keeps its node positions and boundary boxes exactly", async ({ page, consoleErrors }) => {
    type Box = { id: string; x: number; y: number; width?: number; height?: number };
    const file = JSON.parse(readFileSync(join(process.cwd(), "src/examples/kafka-order-pipeline.json"), "utf8")) as {
      title: string;
      nodes: Box[];
      groups: Box[];
    };
    // Moved from the example as shipped, so every position on the canvas after Apply is the file's own.
    file.title = "Kafka, moved";
    for (const item of [...file.nodes, ...file.groups]) Object.assign(item, { x: item.x + 37, y: item.y + 23 });
    expect(file.groups.length).toBeGreaterThan(0);
    await openAdvanced(page);
    await page.getByTestId("ai-reply").fill(JSON.stringify(file, null, 2));
    await expect(page.getByTestId("ai-reply-status")).toContainText("replaces this one");
    await page.getByTestId("ai-apply").click();
    await expect(page.getByTestId("ai-error")).toHaveCount(0);
    await expect(page.getByTestId("ai-turn-0-summary")).toContainText("Replaced the diagram");
    const saved = async () =>
      (await savedDiagram(page)) as unknown as { title: string; nodes: Box[]; groups?: Box[] } | null;
    await expect.poll(async () => (await saved())?.title).toBe("Kafka, moved");
    const after = must(await saved(), "saved edits");
    const pick = ({ id, x, y, width, height }: Box) => ({ id, x, y, width, height });
    expect(after.nodes.map(pick)).toEqual(file.nodes.map(pick));
    expect(after.groups?.map(pick)).toEqual(file.groups.map(pick));
    expectNoErrors(consoleErrors);
  });

  test("the thread is kept per diagram in this browser, never in the file, and can be cleared", async ({ page }) => {
    await openAdvanced(page);
    await applyTurn(page, "Add a billing worker", ADD_WORKER);
    await page.reload();
    await expect(page.getByTestId("ai-turn-0")).toContainText("Add a billing worker");
    // A reload starts a new undo history: the turn no longer claims it can undo itself.
    await expect(page.getByTestId("ai-turn-0-summary")).toBeVisible();
    await expect(page.getByTestId("ai-turn-0-undo")).toHaveCount(0);

    // Not in the diagram's saved file (so not in exports or share links).
    const raw = await page.evaluate((key) => localStorage.getItem(key) ?? "", STORAGE_KEYS.autosavePrefix + SLUG);
    expect(raw).not.toContain("Add a billing worker");

    // Another diagram has its own (empty) thread.
    await page.getByTestId("example-picker").selectOption({ index: 1 });
    await expect(page.getByTestId("ai-empty")).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId("ai-turn-0")).toBeVisible();

    await page.getByTestId("ai-clear").click();
    await expect(page.getByTestId("ai-empty")).toBeVisible();
    await page.getByTestId("ai-clear-undo").click();
    await expect(page.getByTestId("ai-turn-0")).toBeVisible();
  });
});

test("Build with AI is one discreet entry: the command palette, into Advanced on a new diagram", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByTestId("start-card")).toBeVisible();
  await expect(page.getByTestId("start-build-with-ai")).toHaveCount(0);
  await page.getByTestId("file-button").click();
  await expect(page.getByTestId("file-new")).toBeVisible();
  await expect(page.getByTestId("file-build-with-ai")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await gotoCanvas(page, SLUG);
  await page.keyboard.press(`${MOD}+k`);
  await page.getByTestId("command-input").fill("build with ai");
  await page.getByTestId("command-item-action:file.build-with-ai").click();
  await expect(page.getByTestId("start-card")).toBeVisible();
  await expect(page.getByTestId("ai-request")).toBeFocused();
  await applyTurn(page, "A queue", JSON.stringify([{ op: "add_node", kind: "Service Bus queue", label: "jobs" }]));
  await expect.poll(() => nodeCount(page)).toBe(1);
  await expect(page.getByTestId("start-card")).toHaveCount(0);
});
