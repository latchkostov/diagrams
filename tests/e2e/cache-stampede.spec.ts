import {
  test,
  expect,
  gotoLive,
  gotoCanvas,
  pauseClock,
  savedDiagram,
  waitForSelectionSettled,
  STORAGE_KEYS,
} from "./fixtures";
import stampede from "../../src/examples/cache-stampede.json" with { type: "json" };
import { installThreadVerification, waitForThreadVerification } from "./thread-verification";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

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
