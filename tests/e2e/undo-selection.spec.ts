import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors, waitForStableViewport, STORAGE_KEYS } from "./fixtures";
import { nodeCount, openAdvanced } from "./ai-helpers";

// Undo and the selection (docs/UX-PRINCIPLES.md): Undo selects what the undone step changed, as it was
// before; Redo what it changed, as it is after; undoing an add keeps the selection it can. The inspector
// follows, so a bulk edit can be undone, tweaked and retried. Selectors are data-testid only.

const SLUG = "kafka-order-pipeline";
const KEY = STORAGE_KEYS.autosavePrefix + SLUG;
const MOD = process.platform === "darwin" ? "Meta" : "Control";

/** Payments holds Orders API, Payment worker and Ledger; Shipping holds Carrier API; Cache and Billing below. */
const SEED = {
  format: "diagrams/v1",
  title: "Undo and the selection",
  groups: [
    { id: "pay", label: "Payments", tone: "azure", x: 0, y: 0, width: 640, height: 400 },
    { id: "ship", label: "Shipping", tone: "aws", x: 1000, y: 0, width: 600, height: 400 },
  ],
  nodes: [
    { id: "api", stencil: "service.node", label: "Orders API", x: 40, y: 80, group: "pay" },
    { id: "worker", stencil: "service.go", label: "Payment worker", x: 380, y: 80, group: "pay" },
    { id: "ledger", stencil: "postgres", label: "Ledger", x: 40, y: 260, group: "pay" },
    { id: "carrier", stencil: "service.node", label: "Carrier API", x: 1060, y: 80, group: "ship" },
    { id: "cache", stencil: "redis.cache", label: "Cache", x: 700, y: 560 },
    { id: "billing", stencil: "service.go", label: "Billing", x: 1300, y: 560 },
  ],
  edges: [
    { id: "a-w", from: "api", to: "worker", label: "Authorize" },
    { id: "w-l", from: "worker", to: "ledger", kind: "sync" },
    { id: "a-c", from: "api", to: "carrier", label: "Ship order" },
  ],
};

type Saved = {
  groups?: { id: string; x: number; y: number; width: number; height: number }[];
  nodes: { id: string; stencil: string; label: string; x: number; y: number; group?: string }[];
  edges: { id: string; from: string; to: string }[];
};

async function seed(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("seeded", "1");
      }
    },
    [KEY, JSON.stringify(SEED)] as const,
  );
  await gotoCanvas(page, SLUG);
  await expect(page.getByTestId("node-billing")).toBeVisible();
  await waitForStableViewport(page);
}

const saved = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null") as Saved | null, KEY);

/** Polls the autosave until `check` holds, and returns it. */
async function savedWhen(page: Page, check: (d: Saved) => boolean): Promise<Saved> {
  let last: Saved | null = null;
  await expect
    .poll(async () => {
      last = await saved(page);
      return !!last && check(last);
    })
    .toBe(true);
  if (!last) throw new Error("Expected the autosave");
  return last;
}
const node = (d: Saved, id: string) => {
  const n = d.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`Expected node ${id}`);
  return n;
};

/** The selected nodes, boundaries and edges, by test id. */
function selectedIds(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("[data-testid]")) {
      const id = el.dataset.testid ?? "";
      if (
        /^(node|group)-(?!tooltip$|editor)/.test(id) &&
        el.closest(".react-flow__node")?.classList.contains("selected")
      )
        out.push(id);
      if (/^edge-(?!label-|glyph-|settings?-)/.test(id) && el.classList.contains("is-selected")) out.push(id);
    }
    return out.sort();
  });
}
const expectSelected = (page: Page, ids: string[]) => expect.poll(() => selectedIds(page)).toEqual([...ids].sort());

async function selectNodes(page: Page, ids: string[]) {
  await page.getByTestId(`node-${ids[0]}`).click();
  for (const id of ids.slice(1)) await page.getByTestId(`node-${id}`).click({ modifiers: [MOD] });
  await expect(page.getByTestId("inspector-title")).toHaveText(ids.length > 1 ? `${ids.length} selected` : /.+/);
}

/** Lets the history record the last edit as its own step (it settles after 350 ms). */
const settleStep = (page: Page) => page.waitForTimeout(500);

test.describe("undo and the selection", () => {
  test.beforeEach(async ({ page }) => seed(page));

  test("a bulk stencil edit undone keeps the three selected, with their old values; redo too", async ({
    page,
    consoleErrors,
  }) => {
    const three = ["api", "worker", "carrier"];
    await selectNodes(page, three);
    const stencil = page.getByTestId("inspector-field-stencil");
    await expect(stencil).toContainText("Mixed");
    await stencil.click();
    await page.getByTestId("stencil-picker-search").fill("postgres");
    await page.getByTestId("context-menu-item-pick-stencil:postgres").click();
    await savedWhen(page, (s) => three.every((id) => node(s, id).stencil === "postgres"));
    await expect(stencil).not.toContainText("Mixed");
    await settleStep(page);

    await page.getByTestId("undo-button").click();
    const d = await savedWhen(page, (s) => node(s, "api").stencil === "service.node");
    expect([node(d, "worker").stencil, node(d, "carrier").stencil]).toEqual(["service.go", "service.node"]);
    await expectSelected(
      page,
      three.map((id) => `node-${id}`),
    );
    // The multi-select panel stays, with the values as they were: tweak and retry from here.
    await expect(page.getByTestId("inspector-title")).toHaveText("3 selected");
    await expect(stencil).toContainText("Mixed");

    await page.getByTestId("redo-button").click();
    await savedWhen(page, (s) => three.every((id) => node(s, id).stencil === "postgres"));
    await expectSelected(
      page,
      three.map((id) => `node-${id}`),
    );
    await expect(page.getByTestId("inspector-title")).toHaveText("3 selected");
    await expect(stencil).not.toContainText("Mixed");
    expectNoErrors(consoleErrors);
  });

  test("Tidy up undone keeps the selection (not the boundary that grew)", async ({ page, consoleErrors }) => {
    const three = ["api", "worker", "ledger"];
    await selectNodes(page, three);
    await page.getByTestId("inspector-tidy").click();
    await savedWhen(page, (s) => node(s, "ledger").y === node(s, "api").y);
    await settleStep(page);
    await page.getByTestId("undo-button").click();
    await savedWhen(page, (s) => node(s, "ledger").y === 260 && node(s, "ledger").x === 40);
    await expectSelected(
      page,
      three.map((id) => `node-${id}`),
    );
    await expect(page.getByTestId("inspector-title")).toHaveText("3 selected");
    await expect(page.getByTestId("inspector-tidy")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("a delete undone selects what came back: the node and its connection", async ({ page, consoleErrors }) => {
    await selectNodes(page, ["ledger"]);
    await page.keyboard.press("Delete");
    await savedWhen(page, (s) => !s.nodes.some((n) => n.id === "ledger") && !s.edges.some((e) => e.id === "w-l"));
    await settleStep(page);
    // Something else picked meanwhile doesn't matter: the restored elements are what Undo selects.
    await page.getByTestId("node-cache").click();
    await page.getByTestId("undo-button").click();
    await expect(page.getByTestId("node-ledger")).toBeVisible();
    await expectSelected(page, ["node-ledger", "edge-w-l"]);
    await expect(page.getByTestId("inspector-title")).toHaveText("2 selected");
    expectNoErrors(consoleErrors);
  });

  test("a quick-add undone goes back to the node it was added from", async ({ page, consoleErrors }) => {
    const before = await nodeCount(page);
    await page.getByTestId("node-cache").click();
    await expect(page.getByTestId("grow-chip-cache")).toBeVisible();
    await page.keyboard.press("Alt+ArrowRight");
    await expect(page.getByTestId("quick-add")).toBeVisible();
    await page.keyboard.type("postgres");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("node-editor-label")).toBeFocused();
    await page.keyboard.type("Audit");
    await page.keyboard.press("Enter");
    await savedWhen(page, (s) => s.nodes.some((n) => n.label === "Audit"));
    await expect.poll(() => nodeCount(page)).toBe(before + 1);
    await settleStep(page);

    // The add and its name are one step (#44): one Undo takes both, and Cache is selected again.
    await page.getByTestId("undo-button").click();
    await savedWhen(page, (s) => s.nodes.length === SEED.nodes.length && s.edges.length === SEED.edges.length);
    await expect.poll(() => nodeCount(page)).toBe(before);
    await expectSelected(page, ["node-cache"]);
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("Cache");
    // Redo selects what it added.
    await page.getByTestId("redo-button").click();
    await expect.poll(() => nodeCount(page)).toBe(before + 1);
    await expect.poll(async () => (await selectedIds(page)).filter((id) => id.startsWith("node-")).length).toBe(1);
    expect(await selectedIds(page)).not.toContain("node-cache");
    expectNoErrors(consoleErrors);
  });

  test("an AI turn's Undo still undoes just the turn, and the selection comes back", async ({
    page,
    consoleErrors,
  }) => {
    const before = await nodeCount(page);
    await page.getByTestId("node-cache").click();
    await openAdvanced(page);
    await page.getByTestId("ai-request").fill("Add a billing worker after the cache");
    await page.getByTestId("ai-reply").fill(
      JSON.stringify([
        { op: "add_node", kind: ".NET consumer", label: "billing-worker", key: "w" },
        { op: "connect", from: "Cache", to: "w" },
      ]),
    );
    await page.getByTestId("ai-apply").click();
    await expect(page.getByTestId("ai-error")).toHaveCount(0);
    await expect.poll(() => nodeCount(page)).toBe(before + 1);
    await expect(page.getByTestId("ai-turn-0-undo")).toBeVisible();

    await page.getByTestId("ai-turn-0-undo").click();
    await expect.poll(() => nodeCount(page)).toBe(before);
    await expect(page.getByTestId("ai-turn-0-undone")).toBeVisible();
    await expectSelected(page, ["node-cache"]);
    // The editor's Redo brings the turn back.
    await page.getByTestId("redo-button").click();
    await expect.poll(() => nodeCount(page)).toBe(before + 1);
    expectNoErrors(consoleErrors);
  });
});
