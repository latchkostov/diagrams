import {
  test,
  expect,
  gotoLive,
  gotoCanvas,
  pauseClock,
  savedDiagram,
  waitForSelectionSettled,
  waitForStableViewport,
  edgePoint,
  STORAGE_KEYS,
} from "./fixtures";
import stampede from "../../src/examples/cache-stampede.json" with { type: "json" };
import { installThreadVerification, waitForThreadVerification } from "./thread-verification";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { CacheTable } from "../../src/model/caching";

async function originMenu(page: Page) {
  const at = await edgePoint(page, "fetch");
  await page.mouse.click(at.x, at.y, { button: "right" });
  await page.getByTestId("context-menu-item-edge.simulation").hover();
}

test("a confirmed stampede action edits only its saved simulation; keyboard Undo restores it", async ({ page }) => {
  await installThreadVerification(page);
  await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    key: STORAGE_KEYS.autosavePrefix + "cache-stampede",
    diagram: stampede,
  });
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=cache-stampede&live=1&paused=1&sim=ttl-only");
  await pauseClock(page);
  const before = await savedDiagram(page);
  await page.getByTestId("live-play").click();
  const callout = page.getByTestId("trouble-callout"),
    action = page.getByTestId("trouble-action");
  for (let sample = 0; sample < 60; sample++) {
    await page.clock.runFor(500);
    if (!(await callout.count()) || (await callout.getAttribute("data-kind")) !== "cache-stampede") continue;
    await page.getByTestId("live-play").click();
    await waitForThreadVerification(page);
    if ((await action.getAttribute("data-action")) === "cache") break;
    await page.getByTestId("live-play").click();
  }
  await expect(callout).toHaveAttribute("data-kind", "cache-stampede");
  await expect(action).toHaveAttribute("data-action", "cache");
  await expect(action).toHaveText("One fetch per item");
  await expect(page.getByTestId("node-cache-cdn")).toContainText("Stampede");
  await expect(page.getByTestId("call-pill-fetch")).toContainText("fetches for one item");
  if (process.env.CDN_SHOTS) {
    mkdirSync(process.env.CDN_SHOTS, { recursive: true });
    await page.screenshot({ path: join(process.env.CDN_SHOTS, "stampede-callout.png") });
  }
  await action.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("toast")).toContainText("One fetch per item in “TTL only”");
  await page.clock.runFor(400);
  await expect
    .poll(async () => (await savedDiagram(page)).simulations?.[0].setup?.props?.cdn.cache)
    .toMatchObject({ rules: [{ id: "launch", policy: { coalesce: true } }, { id: "products" }] });
  expect((await savedDiagram(page)).nodes).toEqual(before.nodes);
  await page.getByTestId("thread-fix-undo").focus();
  await page.keyboard.press("Enter");
  await page.clock.runFor(400);
  await expect.poll(async () => (await savedDiagram(page)).simulations?.[0].setup).toBeUndefined();
});

test("the origin Simulation menu toggles its single storing rule in the saved run and supports Undo", async ({
  page,
}) => {
  const diagram = structuredClone(stampede);
  const cdn = diagram.nodes.find((n) => n.id === "cdn");
  if (!cdn?.props?.cache) throw new Error("Expected the public example's cache rules");
  cdn.props.cache.rules.splice(1);
  await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    key: STORAGE_KEYS.autosavePrefix + "cache-stampede",
    diagram,
  });
  await gotoLive(page, "./?view=canvas&example=cache-stampede&live=1&paused=1&sim=ttl-only");
  await waitForStableViewport(page);
  const before = await savedDiagram(page);
  await originMenu(page);
  await page.getByTestId("context-menu-item-edge.coalesce").click();
  await expect
    .poll(async () => (await savedDiagram(page)).simulations?.[0].setup?.props?.cdn.cache)
    .toMatchObject({ rules: [{ id: "launch", policy: { ttlMs: 5000, coalesce: true } }] });
  expect((await savedDiagram(page)).nodes).toEqual(before.nodes);
  await originMenu(page);
  await expect(page.getByTestId("context-menu-item-edge.coalesce")).toHaveText("Fetch per request");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedDiagram(page)).simulations?.[0].setup).toBeUndefined();
});

test("an origin with several storing rules opens the cache inspector instead of guessing a rule", async ({ page }) => {
  await gotoLive(page, "./?view=canvas&example=cache-stampede&live=1&paused=1");
  await waitForStableViewport(page);
  await originMenu(page);
  await expect(page.getByTestId("context-menu-item-edge.coalesce")).toHaveCount(0);
  await page.getByTestId("context-menu-item-edge.cache-rules").click();
  await expect(page.getByTestId("cache-add-rule")).toBeFocused();
  await expect(page.getByTestId("cache-rule-launch")).toBeVisible();
  await expect(page.getByTestId("cache-rule-products")).toBeVisible();
  await page.getByTestId("node-origin").click();
  await waitForSelectionSettled(page);
  await expect(page.getByTestId("dock-edit-properties")).toHaveAttribute("aria-expanded", "false");
});

test("One fetch per item is off by default, behind the expiry fold, and undoable", async ({ page }) => {
  await gotoCanvas(page, "cache-stampede");
  await page.getByTestId("node-cdn").click();
  await waitForSelectionSettled(page);
  await expect(page.getByTestId("cache-rule-launch-coalesce")).toBeHidden();
  await page.getByTestId("cache-rule-launch-expires-toggle").click();
  const toggle = page.getByTestId("cache-rule-launch-coalesce");
  await expect(toggle).not.toBeChecked();
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toBeChecked();
  await expect
    .poll(async () => (await savedDiagram(page)).nodes.find((n) => n.id === "cdn")?.props?.cache)
    .toMatchObject({ rules: [{ policy: { ttlMs: 5000, coalesce: true } }, { id: "products" }] });
  await page.getByTestId("undo-button").click();
  await expect(toggle).not.toBeChecked();
  if (process.env.CDN_SHOTS)
    await page
      .getByTestId("inspector-cache")
      .screenshot({ path: join(process.env.CDN_SHOTS, "stampede-inspector.png") });
});

test("coalescing shows one real fetch with waiting shoppers during the herd", async ({ page }) => {
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=cache-stampede&live=1&paused=1&sim=one-fetch");
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  const pill = page.getByTestId("call-pill-fetch");
  for (let frame = 0; frame < 600; frame++) {
    await page.clock.runFor(16);
    if ((await pill.count()) && (await pill.textContent())?.includes("waiting")) break;
  }
  await expect(pill).toContainText(/1 fetch · \d+ waiting/);
  await expect(page.getByTestId("node-cache-cdn")).not.toContainText("Stampede");
  await page.getByTestId("live-play").click();
  if (process.env.CDN_SHOTS) {
    mkdirSync(process.env.CDN_SHOTS, { recursive: true });
    await page.screenshot({ path: join(process.env.CDN_SHOTS, "coalesced-waiters.png") });
  }
});

test("the inspector reads the running One fetch per item policy and toggles only that simulation", async ({ page }) => {
  await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    key: STORAGE_KEYS.autosavePrefix + "cache-stampede",
    diagram: stampede,
  });
  await gotoLive(page, "./?view=canvas&example=cache-stampede&live=1&paused=1&sim=one-fetch");
  await waitForStableViewport(page);
  const before = await savedDiagram(page);
  const cache = before.simulations?.[1].setup?.props?.cdn.cache as CacheTable | undefined;
  if (!cache) throw new Error("Expected the saved comparison's cache policy");
  const expected = structuredClone(cache);
  const launch = expected.rules.find((rule) => rule.id === "launch");
  if (!launch) throw new Error("Expected the launch rule in the saved comparison");
  launch.policy.coalesce = false;
  await originMenu(page);
  await page.getByTestId("context-menu-item-edge.cache-rules").click();
  await expect(page.getByTestId("cache-add-rule")).toBeFocused();
  await page.getByTestId("cache-rule-launch-expires-toggle").click();
  const toggle = page.getByTestId("cache-rule-launch-coalesce");
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await expect.poll(async () => (await savedDiagram(page)).simulations?.[1].setup?.props?.cdn.cache).toEqual(expected);
  const after = await savedDiagram(page);
  expect(after.nodes).toEqual(before.nodes);
  expect(after.simulations?.[0]).toEqual(before.simulations?.[0]);
  await page.getByTestId("node-cdn").focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(toggle).toBeChecked();
});
