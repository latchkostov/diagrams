import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  pauseClock,
  openLiveNodeDetails,
  waitForSelectionSettled,
  savedDiagram,
  STORAGE_KEYS,
} from "./fixtures";
import { cacheFixture } from "../../src/lab/cacheFixture";
import { runKeyboardTutorial } from "./keyboard-tutorial-driver";

for (const id of ["property-sheet", "command-palette"]) {
  test(`${id} keyboard lesson opens the compact Description before writing`, async ({ page, consoleErrors }) => {
    await runKeyboardTutorial(page, consoleErrors, id);
  });
}

test("cache and edge cache search find the plain-language Black Friday promise", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("start-all-examples").click();
  for (const query of ["cache", "edge cache"]) {
    await page.getByTestId("examples-search").fill(query);
    await expect(page.getByTestId("example-card-black-friday-commerce")).toBeVisible();
    await expect(page.getByTestId("example-card-black-friday-commerce")).toContainText(
      "A sale surge: the edge answers repeat product requests so fewer reach the services behind it.",
    );
  }
});

test("Inspector independently discloses routes, cache policy, match and row actions from the keyboard", async ({
  page,
}) => {
  await gotoCanvas(page, "black-friday-commerce");
  await page.getByTestId("node-cdn").click();
  await waitForSelectionSettled(page);
  await expect(page.getByTestId("planning-unavailable")).toHaveText(
    "ⓘ Expected hits aren't available for this large diagram. Run Live to measure this rule.",
  );
  await expect(page.getByTestId("inspector-node-description")).not.toHaveAttribute("open", "");
  await expect(page.getByTestId("inspector-node-description-toggle")).toHaveText("Add description…");
  await expect(page.getByTestId("inspector-section-node-routes")).toHaveAttribute("aria-expanded", "false");
  const cache = page.getByTestId("inspector-section-node-cache");
  await expect(cache).toHaveAttribute("aria-expanded", "false");
  await cache.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("inspector-section-node-routes")).toHaveAttribute("aria-expanded", "false");
  const rule = page.getByTestId("cache-rule-products");
  await rule.focus();
  await page.keyboard.press("Enter");
  await expect(rule).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("cache-rule-products-label")).toBeFocused();
  await expect(page.getByTestId("cache-rule-products-match-summary")).toContainText("GET /products/{id}");
  await expect(page.getByTestId("cache-rule-products-match-path")).not.toBeVisible();
  await expect(page.getByTestId("cache-rule-products-ttl-60000")).toBeVisible();
  await expect(page.getByTestId("cache-rule-products-expected")).toHaveText(
    "Expected hits aren't available for this large diagram. Run Live to measure this rule.",
  );
  await page.getByTestId("cache-rule-products-edit-match-toggle").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("cache-rule-products-match-path")).toBeVisible();
  await page.getByTestId("cache-rule-products-actions-toggle").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("cache-rule-products-delete")).toBeVisible();
});

test("empty Description opens by keyboard and stays open while typing and clearing", async ({ page }) => {
  const diagram = cacheFixture();
  await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    diagram,
  });
  await gotoCanvas(page, "blocking-call");
  await page.getByTestId("node-cache").click();
  await waitForSelectionSettled(page);
  await page.getByTestId("inspector-node-description-toggle").focus();
  await page.keyboard.press("Enter");
  const field = page.getByTestId("inspector-field-node-description");
  await field.fill("Cache reference");
  await expect(field).toBeFocused();
  await field.fill("");
  await expect(field).toBeVisible();
  await expect(field).toBeFocused();
  await expect.poll(async () => (await savedDiagram(page)).nodes[1].description).toBeUndefined();
});

for (const stencil of [
  "generic.cdn",
  "cloudflare",
  "azure.front-door",
  "redis.cache",
  "azure.redis",
  "generic.cache",
]) {
  test(`${stencil} menu stays within twelve actions and keyboard Simulation opens cache rules`, async ({ page }) => {
    const diagram = cacheFixture();
    diagram.nodes[1].stencil = stencil;
    diagram.nodes[1].props = { ...diagram.nodes[1].props };
    delete diagram.nodes[1].props.cache;
    await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
      key: STORAGE_KEYS.autosavePrefix + "blocking-call",
      diagram,
    });
    await gotoCanvas(page, "blocking-call");
    await page.getByTestId("node-cache").click();
    await waitForSelectionSettled(page);
    await page.getByTestId("rf__node-cache").focus();
    await page.keyboard.press("Shift+F10");
    const menu = page.getByTestId("context-menu");
    await expect(menu).toBeVisible();
    const count = await menu.getByTestId(/^context-menu-item-/).count();
    expect(count).toBeLessThanOrEqual(12);
    await page.keyboard.press("Home");
    for (
      let i = 0;
      i < count && (await page.getByTestId("context-menu-item-node.simulation").getAttribute("data-active")) !== "true";
      i++
    )
      await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("context-menu-item-node.simulation")).toHaveAttribute("data-active", "true");
    await page.keyboard.press("ArrowRight");
    if ((await page.getByTestId("context-menu-item-node.add-cache-rules").getAttribute("data-active")) !== "true")
      await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("cache-add-rule")).toBeFocused();
    await expect(page.getByTestId("inspector-section-node-cache")).toHaveAttribute("aria-expanded", "true");
  });
}

test("Arabic caching policy is translated and isolates names, paths and rates", async ({ page }) => {
  const diagram = cacheFixture();
  diagram.planning = {
    ...diagram.planning,
    requestRoutes: [{ id: "page", address: { method: "GET", path: "/products/1" } }],
  };
  diagram.nodes[0].props = {
    ...diagram.nodes[0].props,
    trafficMix: { mode: "shares", entries: [{ routeId: "page", share: 1 }] },
  };
  diagram.nodes[1].props = {
    ...diagram.nodes[1].props,
    cache: {
      rules: [
        {
          id: "pages",
          label: "Product pages",
          match: { path: { value: "/products/{id}", kind: "template" } },
          policy: { ttlMs: 1000, keys: 20, popularity: "even" },
        },
      ],
    },
  };
  await page.addInitScript(
    ({ key, diagram }) => {
      localStorage.setItem(key, JSON.stringify(diagram));
      localStorage.setItem("diagrams.locale", "ar");
    },
    { key: STORAGE_KEYS.autosavePrefix + "blocking-call", diagram },
  );
  await gotoCanvas(page, "blocking-call");
  await page.getByTestId("node-cache").click();
  await page.getByTestId("inspector-section-node-cache").click();
  await page.getByTestId("cache-rule-pages").click();
  await expect(page.getByTestId("cache-rule-pages-match-summary")).toContainText("\u2068* /products/{id}\u2069");
  await expect(page.getByTestId("cache-rule-pages-details")).toContainText("الاحتفاظ لمدة");
  await expect(page.getByTestId("cache-rule-pages-popularity-sentence")).toContainText("شعبية");
  await expect(page.getByTestId("cache-rule-pages-details")).not.toContainText("Don't store");
  await expect(page.getByTestId("cache-rule-pages-expected")).toContainText(
    `\u2068${new Intl.NumberFormat("ar").format(200)} طلب/ث\u2069`,
  );
  await page.getByTestId("cache-rule-pages-ttl-10000").focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("cache-rule-pages-ttl-60000")).toBeChecked();
  await expect(page.getByTestId("inspector-cache")).toHaveJSProperty(
    "scrollWidth",
    await page.getByTestId("inspector-cache").evaluate((el) => el.clientWidth),
  );
});

test("Arabic cache hover isolates measured facts and keeps keyboard focus return", async ({ page }) => {
  const diagram = cacheFixture();
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.addInitScript(
    ({ key, diagram }) => {
      localStorage.setItem(key, JSON.stringify(diagram));
      localStorage.setItem("diagrams.locale", "ar");
    },
    { key: STORAGE_KEYS.autosavePrefix + "blocking-call", diagram },
  );
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  await page.clock.runFor(3000);
  await page.getByTestId("live-play").click();
  await page.clock.resume();
  await openLiveNodeDetails(page, "cache", "cache");
  await expect(page.getByTestId("cache-offload-counts")).toContainText("\u2068Origin\u2069");
  await expect(page.getByTestId("cache-window-counts")).toContainText("أُجيب هنا");
  await expect(page.getByTestId("cache-latency")).toContainText("عند ذاكرة التخزين المؤقت");
  await expect(page.getByTestId("cache-readout")).not.toContainText("Hits p95");
  const card = await page.getByTestId("node-detail-cache").boundingBox();
  const transport = await page.getByTestId("live-controls").boundingBox();
  if (!card || !transport) throw new Error("Missing cache card or transport");
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width).toBeLessThanOrEqual(1024);
  expect(card.y + card.height).toBeLessThanOrEqual(transport.y);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("rf__node-cache")).toBeFocused();
});
