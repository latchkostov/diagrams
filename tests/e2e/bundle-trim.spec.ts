import { openLibrary, waitForQuickAddResults } from "./fixtures";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, gotoLive, waitForStableViewport, savedDiagram, STORAGE_KEYS } from "./fixtures";
import { lazySurfacesFixture } from "../../src/lab/lazySurfacesFixture";
import { chunk } from "./chunk";
import { messageTypesFixture } from "../../src/lab/messageTypesFixture";
import { messageRules } from "../../src/model/messageRules";

async function seed(page: Page) {
  await page.addInitScript(({ diagram, key }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    diagram: lazySurfacesFixture(),
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
  });
}
async function hold(page: Page, name: string, source: string) {
  let release!: () => void;
  let requested = false;
  let fail = false;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(chunk(name, source), async (route) => {
    requested = true;
    await pending;
    if (fail) await route.abort("failed");
    else await route.continue();
  });
  return {
    release,
    requested: () => requested,
    fail: () => {
      fail = true;
      release();
    },
    pass: () => {
      fail = false;
    },
  };
}

for (const delayed of [false, true])
  test(`new boundary keeps immediate naming with ${delayed ? "delayed" : "loaded"} GroupPanel`, async ({ page }) => {
    await seed(page);
    const panel = await hold(page, "GroupPanel", "src/canvas/inspector/GroupPanel.tsx");
    try {
      await gotoCanvas(page, "blocking-call");
      await waitForStableViewport(page);
      if (!delayed) {
        panel.release();
        await page.getByTestId("group-label-commerce").click();
        await expect(page.getByTestId("inspector-field-label")).toHaveValue("Commerce");
      }
      await page.getByTestId("node-caller").click();
      await page.keyboard.press("ControlOrMeta+g");
      // Type before a cold panel can mount: these keys belong to its pending rename.
      await page.keyboard.type("tx.audit");
      if (delayed) {
        await expect.poll(panel.requested).toBe(true);
        panel.release();
      }
      await expect(page.getByTestId("inspector-field-label")).toBeFocused();
      await expect(page.getByTestId("inspector-field-label")).toHaveValue("tx.audit");
      await page.keyboard.press("Enter");
      await expect
        .poll(async () =>
          (await savedDiagram(page)).groups?.filter((group) => group.id !== "commerce").map((group) => group.label),
        )
        .toEqual(["tx.audit"]);
      await expect(page.getByTestId("annotation-editor")).toHaveCount(0);
    } finally {
      panel.release();
    }
  });

for (const editAfterArrow of [false, true])
  test(`searchable menu navigation${editAfterArrow ? " and later edits" : ""} picks the highlighted row`, async ({
    browser,
  }) => {
    const picks: string[] = [];
    for (const keyboardPick of [false, true]) {
      const page = await browser.newPage();
      try {
        await seed(page);
        await gotoCanvas(page, "blocking-call");
        await waitForStableViewport(page);
        await page.getByTestId("node-caller").click();
        await page.getByTestId("canvas-wrap").focus();
        const before = await savedDiagram(page);
        await page.keyboard.press("Alt+ArrowRight");
        await expect(page.getByTestId("quick-add-search")).toBeFocused();
        await page.keyboard.type(editAfterArrow ? "ca" : "cache");
        await waitForQuickAddResults(page);
        await page.keyboard.press("ArrowDown");
        if (editAfterArrow) {
          await page.keyboard.type("che");
          await waitForQuickAddResults(page);
          await page.keyboard.press("ArrowDown");
        }
        if (keyboardPick) await page.keyboard.press("Enter");
        else {
          const active = await page
            .getByTestId(/^context-menu-item-/)
            .evaluateAll((rows) =>
              rows.find((row) => row.getAttribute("data-active") === "true")?.getAttribute("data-testid"),
            );
          if (!active) throw new Error("Quick-add has no highlighted row");
          await page.getByTestId(active).click();
        }
        await expect(page.getByTestId("quick-add")).toHaveCount(0);
        await expect.poll(async () => (await savedDiagram(page)).nodes.length).toBe(before.nodes.length + 1);
        const added = (await savedDiagram(page)).nodes.find((node) => !before.nodes.some((old) => old.id === node.id));
        if (!added) throw new Error("Quick-add did not create a node");
        picks.push(added.stencil);
      } finally {
        await page.close();
      }
    }
    expect(picks[1]).toBe(picks[0]);
  });

for (const failed of [false, true])
  test(`Live overflow owns Escape while its rows are ${failed ? "failed" : "held"}`, async ({ page }) => {
    await seed(page);
    const menu = await hold(page, "LiveMoreItems", "src/live/LiveMoreItems.tsx");
    try {
      await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
      await page.getByTestId("live-more").click();
      await expect.poll(menu.requested).toBe(true);
      if (failed) {
        menu.fail();
        await expect(page.getByTestId("lazy-load-retry")).toBeVisible();
      }
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("live-more")).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByTestId("live-controls")).toBeVisible();
      await expect(page.getByTestId("live-more")).toBeFocused();
    } finally {
      menu.release();
    }
  });

test("capacity analysis keeps its original opener after focus enters the held shell", async ({ page }) => {
  await seed(page);
  const analysis = await hold(page, "CapacityAnalysis", "src/live/CapacityAnalysis.tsx");
  const panel = await hold(page, "CapacityPanel", "src/live/CapacityPanel.tsx");
  try {
    await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
    await page.getByTestId("live-capacity").click();
    await expect.poll(analysis.requested).toBe(true);
    await expect.poll(panel.requested).toBe(true);
    await page.getByTestId("capacity-close").focus();
    panel.release();
    analysis.release();
    await expect(page.getByTestId("capacity-traffic-mult")).toBeVisible();
    await page.getByTestId("capacity-close").focus();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("capacity-panel")).toHaveCount(0);
    await expect(page.getByTestId("live-capacity")).toBeFocused();
    await expect(page.getByTestId("live-controls")).toBeVisible();
  } finally {
    analysis.release();
    panel.release();
  }
});

test("Live overflow keeps its trace fold across dismissal", async ({ page }) => {
  await seed(page);
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-trace-message").click();
  await page.keyboard.press("Escape");
  await page.getByTestId("live-more").click();
  await expect(page.getByTestId("live-trace-message")).toHaveAttribute("aria-expanded", "true");
});

for (const name of [undefined, "Cache audit"])
  test(`quick-add navigation picks before ${name ? "typing hands over to naming" : "Escape finishes naming"}`, async ({
    page,
  }) => {
    await seed(page);
    await gotoCanvas(page, "blocking-call");
    await waitForStableViewport(page);
    await page.getByTestId("node-caller").click();
    await page.getByTestId("canvas-wrap").focus();
    const before = await savedDiagram(page);
    await page.keyboard.press("Alt+ArrowRight");
    await expect(page.getByTestId("quick-add-search")).toBeFocused();
    await page.keyboard.type("cache");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    if (name) await page.keyboard.type(name);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("quick-add")).toHaveCount(0);
    await expect.poll(async () => (await savedDiagram(page)).edges.length).toBe(before.edges.length + 1);
    const after = await savedDiagram(page);
    expect(after.nodes).toHaveLength(before.nodes.length + 1);
    const added = after.nodes.find((node) => !before.nodes.some((old) => old.id === node.id));
    expect(added).toBeDefined();
    if (name) expect(added?.label).toBe(name);
  });

test("quick-add leaves another control's Enter available", async ({ page }) => {
  await seed(page);
  await gotoCanvas(page, "blocking-call");
  await waitForStableViewport(page);
  await page.getByTestId("node-caller").click();
  await page.getByTestId("canvas-wrap").focus();
  const before = await savedDiagram(page);
  await page.keyboard.press("Alt+ArrowRight");
  await page.keyboard.type("redis");
  await page.getByTestId("file-button").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("file-more-formats")).toBeVisible();
  expect(await savedDiagram(page)).toEqual(before);
});

test("typing before the node identity fields arrive preserves the first character", async ({ page }) => {
  await seed(page);
  const panel = await hold(page, "NodeIdentity", "src/canvas/inspector/NodeIdentity.tsx");
  try {
    await gotoCanvas(page, "blocking-call");
    await waitForStableViewport(page);
    await page.getByTestId("node-caller").dblclick();
    await expect.poll(panel.requested).toBe(true);
    await page.keyboard.type("t");
    panel.release();
    await expect(page.getByTestId("inspector-field-label")).toBeFocused();
    await page.keyboard.type("x.audit");
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("tx.audit");
  } finally {
    panel.release();
  }
});

test("a plain menu keeps Home, arrows and Enter in order", async ({ page }) => {
  const diagram = messageTypesFixture();
  const emits = { Send: "Send", Callback: "Callback" };
  diagram.nodes[1].props = { emits };
  await page.addInitScript(({ diagram, key }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    diagram,
    key: STORAGE_KEYS.autosavePrefix + "webhook-ingestion",
  });
  await gotoCanvas(page, "webhook-ingestion");
  await page.getByTestId("node-api").click();
  await page.getByTestId("inspector-section-node-simulation").click();
  const receives = page.getByTestId("inspector-field-receives-0");
  await receives.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await savedDiagram(page)).nodes.find((node) => node.id === "api")?.props?.emits)
    .toEqual([
      // Only the edited rule gains an explicit ID (its derived one); the untouched rule keeps its authored form.
      { id: messageRules(emits)[0].id, receives: "*", sends: "Send" },
      { receives: "Callback", sends: "Callback" },
    ]);
  await expect(receives).toBeFocused();
});

for (const leave of [false, true])
  test(`P2 cold rename paste ${leave ? "respects another field" : "stays ordered with keys"}`, async ({ page }) => {
    await seed(page);
    const panel = await hold(page, "NodeIdentity", "src/canvas/inspector/NodeIdentity.tsx");
    try {
      await gotoCanvas(page, "blocking-call");
      await waitForStableViewport(page);
      if (leave) {
        await openLibrary(page);
        await page.getByTestId("palette-toggle").click();
      }
      await page.getByTestId("node-caller").dblclick();
      await expect.poll(panel.requested).toBe(true);
      await page.keyboard.type("Orders ");
      await page.getByTestId("canvas-wrap").evaluate((el) => {
        const data = new DataTransfer();
        data.setData("text/plain", "API");
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      });
      await page.keyboard.type("!");
      if (leave) {
        await openLibrary(page);
        const search = page.getByTestId("palette-search");
        await search.focus();
        await search.fill("cache");
        panel.release();
        await expect(page.getByTestId("inspector-field-label")).toBeVisible();
        await expect(search).toBeFocused();
        await expect(page.getByTestId("inspector-field-label")).toHaveValue(
          lazySurfacesFixture().nodes.find((n) => n.id === "caller")?.label ?? "",
        );
      } else {
        panel.release();
        await expect(page.getByTestId("inspector-field-label")).toBeFocused();
        await expect(page.getByTestId("inspector-field-label")).toHaveValue("Orders API!");
        await expect
          .poll(async () => (await savedDiagram(page)).annotations)
          .toEqual(lazySurfacesFixture().annotations);
      }
    } finally {
      panel.release();
    }
  });
