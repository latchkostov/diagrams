import { savedDiagram } from "./fixtures";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors, waitForStableViewport, fitDiagram, STORAGE_KEYS } from "./fixtures";
import { callTool, installFakeModelContext, must, nodeCount, openAdvanced, toolNames } from "./ai-helpers";

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

const saved = (page: Page) => savedDiagram(page) as Promise<Saved>;

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
/** The node keyboard focus is on (its React Flow id), or null. */
const focusedNode = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest(".react-flow__node")?.getAttribute("data-id") ?? null);
/** The nodes in the page's Tab order (the canvas is one Tab stop). */
const tabStops = (page: Page) =>
  page.getByTestId(/^(node|group)-(?!tooltip$|editor)/).evaluateAll((els) =>
    els
      .map((el) => el.closest(".react-flow__node"))
      .filter((n) => n?.getAttribute("tabindex") === "0")
      .map((n) => n?.getAttribute("data-id"))
      .filter((id, i, all) => all.indexOf(id) === i),
  );
const expectSelected = (page: Page, ids: string[]) => expect.poll(() => selectedIds(page)).toEqual([...ids].sort());

async function selectNodes(page: Page, ids: string[]) {
  await page.getByTestId(`node-${ids[0]}`).click();
  await expect(page.getByTestId("inspector-title")).toBeVisible();
  await fitDiagram(page);
  for (const id of ids.slice(1)) await page.getByTestId(`node-${id}`).click({ modifiers: [MOD] });
  await expect(page.getByTestId("inspector-title")).toHaveText(ids.length > 1 ? `${ids.length} selected` : /.+/);
}

/** Edits with the same tag this close together join one undo step (src/editor/history.ts). */
const MERGE_WINDOW_MS = 1500;
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
    await expect(page.getByTestId("inspector-field-label")).toBeFocused();
    await page.keyboard.type("Audit");
    await page.keyboard.press("Enter");
    const added = await savedWhen(page, (s) => s.nodes.some((n) => n.label === "Audit"));
    const made = must(
      added.nodes.find((n) => n.label === "Audit"),
      "the added node",
    );
    const link = must(
      added.edges.find((e) => e.to === made.id),
      "its connection",
    );
    expect(link.from).toBe("cache");
    await expect.poll(() => nodeCount(page)).toBe(before + 1);
    await settleStep(page);

    // The add and its name are one step (#44): one Undo takes both, and Cache is selected again.
    await page.getByTestId("undo-button").click();
    await savedWhen(page, (s) => s.nodes.length === SEED.nodes.length && s.edges.length === SEED.edges.length);
    await expect.poll(() => nodeCount(page)).toBe(before);
    await expectSelected(page, ["node-cache"]);
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("Cache");
    // Redo selects what it added: the node, with its name, and its connection from Cache.
    await page.getByTestId("redo-button").click();
    await expect.poll(() => nodeCount(page)).toBe(before + 1);
    const back = await savedWhen(page, (s) => s.nodes.some((n) => n.id === made.id));
    expect(node(back, made.id)).toEqual(made);
    expect(back.edges.find((e) => e.id === link.id)).toEqual(link);
    await expectSelected(page, [`node-${made.id}`, `edge-${link.id}`]);
    expectNoErrors(consoleErrors);
  });

  test("quick-add after a pending edit restores its source selection", async ({ page, consoleErrors }) => {
    // Rename Orders API, then, before that edit settles into a step (350 ms, restarted by each change), pick
    // Cache and quick-add from it: the add's hint flushes the rename in the same event as the add.
    await page.getByTestId("node-api").click();
    await page.getByTestId("inspector-field-label").fill("Orders");
    await page.getByTestId("node-cache").click();
    await page.keyboard.press("Alt+ArrowRight");
    await page.keyboard.type("postgres", { delay: 0 });
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("inspector-field-label")).toBeFocused();
    await page.keyboard.press("Enter");
    await savedWhen(page, (s) => s.nodes.length === SEED.nodes.length + 1);
    await settleStep(page);

    await page.getByTestId("undo-button").click();
    const d = await savedWhen(page, (s) => s.nodes.length === SEED.nodes.length);
    expect(node(d, "api").label).toBe("Orders");
    await expectSelected(page, ["node-cache"]);
    // The rename is its own step, from Orders API.
    await page.getByTestId("undo-button").click();
    await savedWhen(page, (s) => node(s, "api").label === "Orders API");
    await expectSelected(page, ["node-api"]);
    expectNoErrors(consoleErrors);
  });

  // The test above failed on the nightly's dev server (#78): quick-add opened over the pointer left on Cache, a check
  // result re-rendered the canvas, the menu moved off the pointer (placed again against the shorter list), and the
  // pointer leaving it cleared the highlight, so Enter picked nothing. Each cause on its own:

  test("quick-add's Enter picks the top match, not the row that slid under a resting pointer", async ({ page }) => {
    await page.getByTestId("node-cache").click();
    await page.keyboard.press("Alt+ArrowRight");
    const menu = page.getByTestId("quick-add");
    await expect(menu).toBeVisible();
    await waitForStableViewport(page);
    const row = (stencil: string) => menu.getByTestId(`context-menu-item-quick-add:${stencil}`);
    const rows = menu.getByTestId(/^context-menu-item-quick-add:/);
    // "rds" lists MySQL second: point at it.
    const search = menu.getByTestId("quick-add-search");
    await search.fill("rds");
    await expect(rows.nth(1)).toHaveAttribute("data-testid", "context-menu-item-quick-add:mysql");
    await row("mysql").hover();
    await expect(row("mysql")).toHaveAttribute("data-active", "true");
    // "mysql" puts it first, and Cloud SQL slides under the pointer, which hasn't moved.
    await search.fill("mysql");
    await expect(rows.nth(1)).toHaveAttribute("data-testid", "context-menu-item-quick-add:gcp.cloud-sql");
    // Once the browser has worked out what's under the pointer now, the top match still leads.
    await expect.poll(() => row("gcp.cloud-sql").evaluate((el) => el.matches(":hover"))).toBe(true);
    await expect(row("mysql")).toHaveAttribute("data-active", "true");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("inspector-field-label")).toBeFocused();
    await page.keyboard.press("Enter");
    const d = await savedWhen(page, (s) => s.nodes.length === SEED.nodes.length + 1);
    expect(d.nodes.filter((n) => !SEED.nodes.some((s) => s.id === n.id)).map((n) => n.stencil)).toEqual(["mysql"]);
  });

  test("quick-add stays where it opened while the canvas changes, and keeps its highlight as the pointer leaves", async ({
    page,
  }) => {
    // An agent's tools (WebMCP), to change the diagram while the menu is open.
    await installFakeModelContext(page);
    await page.reload();
    await expect(page.getByTestId("node-billing")).toBeVisible();
    await expect.poll(() => toolNames(page)).toContain("edit_diagram");
    await waitForStableViewport(page);
    await page.getByTestId("node-cache").click();
    await page.keyboard.press("Alt+ArrowRight");
    const menu = page.getByTestId("quick-add");
    await expect(menu).toBeVisible();
    await waitForStableViewport(page);
    // Placed against the whole list, so it fits whatever is typed: low in the view here, so held up from the outline.
    const at = async () => {
      const { x, y } = must(await menu.boundingBox(), "quick-add");
      return { x, y };
    };
    const opened = await at();
    await page.keyboard.type("postgres");
    const top = menu.getByTestId("context-menu-item-quick-add:postgres");
    await expect(top).toHaveAttribute("data-active", "true");
    // An agent adds a node meanwhile: the canvas renders again round the open menu, which stays put.
    const before = await nodeCount(page);
    const res = await callTool(page, "edit_diagram", {
      summary: "Added a worker",
      ops: [{ op: "add_node", kind: "Go service", label: "Ledger worker", key: "w" }],
    });
    expect(res.isError).toBe(false);
    await expect.poll(() => nodeCount(page)).toBe(before + 1);
    await expect(menu).toBeVisible();
    expect(await at()).toEqual(opened);
    // The pointer leaves for the canvas's empty top-left corner: the search keeps its highlight, which Enter picks.
    const wrap = must(await page.getByTestId("canvas-wrap").boundingBox(), "the canvas");
    await page.mouse.move(wrap.x + 24, wrap.y + wrap.height / 2);
    await expect(top).toHaveAttribute("data-active", "true");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  });

  test("undo from the keyboard moves focus to what it selected; from the toolbar, focus stays", async ({
    page,
    consoleErrors,
  }) => {
    // Nudge Orders API three times, then Tab on to Payment worker: focus and selection there.
    await page.getByTestId("node-api").click();
    const xs = [40];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Shift+ArrowRight");
      const d = await savedWhen(page, (s) => node(s, "api").x > xs[i]);
      xs.push(node(d, "api").x);
      // Nudges a moment apart join one step: these are three.
      await page.waitForTimeout(MERGE_WINDOW_MS + 200);
    }
    await page.keyboard.press("Tab");
    await expect.poll(() => focusedNode(page)).toBe("worker");

    // Ctrl+Z puts Orders API back and selects it: focus, the Tab stop and the announcement follow.
    await page.keyboard.press(`${MOD}+z`);
    await savedWhen(page, (s) => node(s, "api").x === xs[2]);
    await expectSelected(page, ["node-api"]);
    await expect.poll(() => focusedNode(page)).toBe("api");
    await expect(page.getByTestId("canvas-announce")).toHaveText("Undone. Orders API selected.");
    expect(await tabStops(page)).toEqual(["api"]);
    // Enter edits Orders API, not Payment worker.
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("Orders API");
    await page.keyboard.press("Escape");

    // Undo from the toolbar: the selection follows, focus stays on the button.
    await page.getByTestId("undo-button").click();
    await savedWhen(page, (s) => node(s, "api").x === xs[1]);
    await expectSelected(page, ["node-api"]);
    await expect(page.getByTestId("undo-button")).toBeFocused();
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
