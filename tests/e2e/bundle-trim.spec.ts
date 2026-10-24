import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, gotoLive, waitForStableViewport, savedDiagram, STORAGE_KEYS } from "./fixtures";
import { lazySurfacesFixture } from "../../src/lab/lazySurfacesFixture";
import { chunk } from "./chunk";

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

test("pending quick-add retains search through one keyboard Retry and lets Escape cancel", async ({ page }) => {
  await seed(page);
  const menu = await hold(page, "MenuList", "src/components/MenuList.tsx");
  try {
    await gotoCanvas(page, "blocking-call");
    await waitForStableViewport(page);
    await page.getByTestId("node-caller").click();
    await page.getByTestId("canvas-wrap").focus();
    await page.keyboard.press("Alt+ArrowRight");
    await expect.poll(menu.requested).toBe(true);
    await expect(page.getByTestId("quick-add")).toBeFocused();
    await page.keyboard.type("redis");
    const before = await savedDiagram(page);
    menu.fail();
    const retry = page.getByTestId("menu-load-retry");
    await expect(retry).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(retry).toBeFocused();
    menu.pass();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("quick-add-search")).toHaveValue("redis");
    expect(await savedDiagram(page)).toEqual(before);
    await page.keyboard.press("Escape"); // Clear the search, as before.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("quick-add")).toHaveCount(0);
  } finally {
    menu.release();
  }
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
  try {
    await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
    await page.getByTestId("live-capacity").click();
    await expect.poll(analysis.requested).toBe(true);
    await page.getByTestId("capacity-close").focus();
    analysis.release();
    await expect(page.getByTestId("capacity-traffic-mult")).toBeVisible();
    await page.getByTestId("capacity-close").focus();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("capacity-panel")).toHaveCount(0);
    await expect(page.getByTestId("live-capacity")).toBeFocused();
    await expect(page.getByTestId("live-controls")).toBeVisible();
  } finally {
    analysis.release();
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

test("quick-add Enter commits before held rows arrive, and the next Escape finishes naming", async ({ page }) => {
  await seed(page);
  const menu = await hold(page, "MenuList", "src/components/MenuList.tsx");
  try {
    await gotoCanvas(page, "blocking-call");
    await waitForStableViewport(page);
    await page.getByTestId("node-caller").click();
    await page.getByTestId("canvas-wrap").focus();
    const before = await savedDiagram(page);
    await page.keyboard.press("Alt+ArrowRight");
    await expect.poll(menu.requested).toBe(true);
    await page.keyboard.type("redis cache");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("quick-add")).toHaveCount(0);
    await expect.poll(async () => (await savedDiagram(page)).edges.length).toBe(before.edges.length + 1);
    const after = await savedDiagram(page);
    expect(after.nodes).toHaveLength(before.nodes.length + 1);
    expect(after.nodes.some((node) => node.stencil === "redis.cache")).toBe(true);
  } finally {
    menu.release();
  }
});

test("a held quick-add leaves another control's Enter available", async ({ page }) => {
  await seed(page);
  const menu = await hold(page, "MenuList", "src/components/MenuList.tsx");
  try {
    await gotoCanvas(page, "blocking-call");
    await waitForStableViewport(page);
    await page.getByTestId("node-caller").click();
    await page.getByTestId("canvas-wrap").focus();
    const before = await savedDiagram(page);
    await page.keyboard.press("Alt+ArrowRight");
    await expect.poll(menu.requested).toBe(true);
    await page.keyboard.type("redis");
    await page.getByTestId("file-button").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("file-more-formats")).toBeVisible();
    expect(await savedDiagram(page)).toEqual(before);
  } finally {
    menu.release();
  }
});
