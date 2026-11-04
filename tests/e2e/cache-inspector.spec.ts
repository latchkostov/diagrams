import { test, expect, gotoCanvas, savedDiagram, STORAGE_KEYS, waitForSelectionSettled } from "./fixtures";
import { cacheFixture } from "../../src/lab/cacheFixture";
import { chunk, holdChunk } from "./chunk";
import type { Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

async function setup(page: Page) {
  const d = cacheFixture();
  d.planning = { revision: "p3-w2", requestRoutes: [{ id: "page", address: { method: "GET", path: "/products/1" } }] };
  d.nodes[0].props = { ...d.nodes[0].props, trafficMix: { mode: "shares", entries: [{ routeId: "page", share: 1 }] } };
  delete d.nodes[1].props?.cache;
  await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    diagram: d,
  });
  await gotoCanvas(page, "blocking-call");
}
async function add(page: Page) {
  await page.getByTestId("node-cache").click({ button: "right" });
  await page.getByTestId("context-menu-item-node.simulation").click();
  await page.getByTestId("context-menu-item-node.add-cache-rules").click();
  await waitForSelectionSettled(page);
}

test("Properties keeps selection and focuses the cache editor after its held chunk loads", async ({ page }) => {
  await setup(page);
  await page.getByTestId("node-cache").click();
  await waitForSelectionSettled(page);
  await page.getByTestId("inspector-section-node-simulation").focus();
  await page.keyboard.press("Enter");
  const held = await holdChunk(page, chunk("cacheRuntime", "src/sim/cache/cacheRuntime.ts"));
  try {
    await page.getByTestId("cache-add").focus();
    await page.keyboard.press("Enter");
    await expect.poll(held.requested).toBe(true);
    await expect(page.getByTestId("inspector.cache-loading")).toHaveAttribute("aria-busy", "true");
    held.release();
    await expect(page.getByTestId("cache-add-rule")).toBeFocused();
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("Edge cache");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("cache-rule-cache-2")).toBeFocused();
  } finally {
    held.release();
  }
});

test("message patterns preserve separators during keyboard entry and follow Undo", async ({ page }) => {
  await setup(page);
  await add(page);
  await page.getByTestId("cache-rule-cache-1-edit-match-toggle").click();
  await page.getByTestId("cache-rule-cache-1-types-toggle").click();
  const field = page.getByTestId("cache-rule-cache-1-types-input");
  await field.focus();
  await page.keyboard.type("Page, Invoice");
  await expect(field).toHaveValue("Page, Invoice");
  await expect
    .poll(async () => (await savedDiagram(page)).nodes[1].props?.cache)
    .toMatchObject({ rules: [{ match: { types: ["Page", "Invoice"] } }] });
  await page.getByTestId("undo-button").click();
  await expect(field).toHaveValue("");
});

test("Black Friday exposes the four ordered edge rules in Properties", async ({ page }) => {
  await gotoCanvas(page, "black-friday-commerce");
  await page.getByTestId("node-cdn").click();
  await page.getByTestId("inspector-section-node-cache").click();
  await expect(page.getByTestId("inspector-cache")).toBeVisible();
  await waitForSelectionSettled(page);
  for (const id of ["doorbuster", "products", "search", "orders"])
    await expect(page.getByTestId(`cache-rule-${id}`)).toBeVisible();
  await expect(page.getByTestId("cache-rule-products")).toContainText("GET /products/{id}");
  const right = await page.getByTestId("cache-order-heading").evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().right;
  });
  const match = await page.getByTestId("cache-match-heading").boundingBox();
  if (!match) throw new Error("Match heading has no rendered box");
  expect(right).toBeLessThanOrEqual(match.x);
  await page.getByTestId("cache-rule-products").click();
  await expect(page.getByTestId("cache-rule-products-expected")).toContainText(
    "Expected hits aren't available for this large diagram. Run Live to measure this rule.",
  );
  await page.getByTestId("cache-rule-products").click();
  if (process.env.CDN_SHOTS) {
    mkdirSync(process.env.CDN_SHOTS, { recursive: true });
    await page.getByTestId("inspector-cache").screenshot({ path: join(process.env.CDN_SHOTS, "inspector-rules.png") });
  }
});

test("add cache rules upgrades once, derives Expected, and offers TTL and popularity presets", async ({ page }) => {
  await setup(page);
  await add(page);
  await expect(page.getByTestId("inspector-cache")).toBeVisible();
  await waitForSelectionSettled(page);
  await expect(page.getByTestId("cache-rule-cache-1-expected")).toContainText("200 requests/s");
  await expect(page.getByTestId("cache-rule-cache-1-popularity-sentence")).toContainText("top 1%");
  await expect(page.getByTestId("cache-rule-cache-1-popularity")).toHaveAttribute(
    "aria-describedby",
    "cache-rule-cache-1-popularity-sentence",
  );
  await page.getByTestId("cache-rule-cache-1-ttl-60000").check();
  await expect
    .poll(async () => (await savedDiagram(page)).nodes[1].props?.cache)
    .toMatchObject({ rules: [{ policy: { ttlMs: 60000 } }] });
  await page.getByTestId("cache-rule-cache-1-keys").fill("1");
  await expect(page.getByTestId("cache-rule-cache-1-popularity")).toHaveCount(0);
  await page.getByTestId("cache-rule-cache-1-no-store").check();
  await expect(page.getByTestId("cache-rule-cache-1-expected")).toContainText("Not cached: all");
  await expect(page.getByTestId("cache-rule-cache-1-expected")).not.toContainText("0% hits");
  await expect
    .poll(async () => (await savedDiagram(page)).nodes[1].props?.cache)
    .toMatchObject({ rules: [{ policy: { noStore: true } }] });
  await page.getByTestId("cache-rule-cache-1-no-store").uncheck();
  await expect
    .poll(async () => (await savedDiagram(page)).nodes[1].props?.cache)
    .toMatchObject({ rules: [{ policy: { ttlMs: 60000, keys: 1, popularity: "typical" } }] });
  await page.getByTestId("cache-rule-cache-1-no-store").check();
  await page.getByTestId("undo-button").click();
  await expect(page.getByTestId("cache-rule-cache-1-keys")).toHaveValue("1");
});

test("rules support Enter, announced Alt+arrows, Delete, next-row focus and Undo", async ({ page }) => {
  await setup(page);
  await add(page);
  await page.getByTestId("cache-add-rule").click();
  const row = page.getByTestId("cache-rule-cache-2");
  await row.focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.getByTestId("cache-announce")).toHaveText("Moved to 1 of 2.");
  await expect(row).toBeFocused();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("cache-announce")).toHaveText("Rule 1 deleted.");
  await expect(page.getByTestId("cache-rule-cache-1")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("cache-rule-cache-1")).toHaveAttribute("aria-expanded", "true");
  await page.getByTestId("undo-button").click();
  await expect(row).toBeVisible();
});

test("Custom TTL stays consistent through presets and Undo", async ({ page }) => {
  await setup(page);
  await add(page);
  await page.getByTestId("cache-rule-cache-1-ttl-custom").check();
  await page.getByTestId("cache-rule-cache-1-ttl").fill("1234");
  await expect
    .poll(async () => (await savedDiagram(page)).nodes[1].props?.cache)
    .toMatchObject({ rules: [{ policy: { ttlMs: 1234 } }] });
  await page.getByTestId("cache-rule-cache-1-ttl-60000").check();
  await page.getByTestId("cache-rule-cache-1-ttl-custom").check();
  await expect(page.getByTestId("cache-rule-cache-1-ttl")).toHaveValue("60000");
  await page.getByTestId("undo-button").click();
  await expect(page.getByTestId("cache-rule-cache-1-ttl-custom")).toBeChecked();
  await expect(page.getByTestId("cache-rule-cache-1-ttl")).toHaveValue("1234");
});

test("the Inspector waits for the held cache runtime and recovers through Retry", async ({ page }) => {
  await setup(page);
  const held = await holdChunk(page, chunk("cacheRuntime", "src/sim/cache/cacheRuntime.ts"));
  try {
    await add(page);
    await expect.poll(held.requested).toBe(true);
    await expect(page.getByTestId("inspector.cache-loading")).toHaveAttribute("aria-busy", "true");
    await expect(page.getByTestId("cache-add-rule")).toHaveCount(0);
    await page.getByTestId("file-button").click();
    await page.keyboard.press("Escape");
    held.fail = true;
    held.release();
    await expect(page.getByTestId("lazy-load-retry")).toBeVisible();
    held.fail = false;
    await page.getByTestId("lazy-load-retry").click();
    await expect(page.getByTestId("inspector-cache")).toBeVisible();
    await expect(page.getByTestId("cache-add-rule")).toBeFocused();
    await expect
      .poll(async () => (await savedDiagram(page)).nodes[1].props?.cache)
      .toMatchObject({ rules: [{ id: "cache-1" }] });
  } finally {
    held.release();
  }
});
