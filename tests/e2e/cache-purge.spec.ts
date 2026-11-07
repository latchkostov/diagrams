import {
  test,
  expect,
  gotoLive,
  gotoCanvas,
  waitForSelectionSettled,
  waitForStableViewport,
  savedDiagram,
  STORAGE_KEYS,
  fitDiagram,
} from "./fixtures";
import { purgeEditorFixture } from "../../src/lab/cachePurgeFixture";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import stampede from "../../src/examples/cache-stampede.json" with { type: "json" };

test("stale serving stays in the expiry fold and changes in one undo step", async ({ page }) => {
  await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    key: STORAGE_KEYS.autosavePrefix + "cache-stampede",
    diagram: stampede,
  });
  await gotoCanvas(page, "cache-stampede");
  await page.getByTestId("node-cdn").click();
  await waitForSelectionSettled(page);
  await page.getByTestId("inspector-section-node-cache").click();
  await page.getByTestId("cache-rule-launch").click();
  const select = page.getByTestId("cache-rule-launch-stale-window");
  await expect(select).toBeHidden();
  await page.getByTestId("cache-rule-launch-expires-toggle").click();
  await expect(select).toHaveValue("0");
  const before = await savedDiagram(page);
  await select.selectOption("10000");
  await expect
    .poll(async () => (await savedDiagram(page)).nodes.find((n) => n.id === "cdn")?.props?.cache)
    .toMatchObject({ rules: [{ policy: { ttlMs: 5000, staleWhileRevalidateMs: 10000 } }, { id: "products" }] });
  await page.getByTestId("undo-button").click();
  await expect(select).toHaveValue("0");
  await expect.poll(async () => (await savedDiagram(page)).nodes).toEqual(before.nodes);
});

test("Cold cache finds setup-only rules; rule IDs cannot select All rules accidentally", async ({ page }) => {
  await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    key: STORAGE_KEYS.autosavePrefix + "cache-stampede",
    diagram: purgeEditorFixture(),
  });
  await gotoLive(page, "./?view=canvas&example=cache-stampede&live=1&paused=1&sim=purge-rules");
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-edit-sims").click();
  await page.getByTestId("sim-panel-section-timeline-toggle").click();
  await expect(page.getByTestId("sim-panel-preset-cold-cache")).toBeEnabled();
  await page.getByTestId("sim-panel-add-step").selectOption("cold-cache");
  const rule = page.getByTestId("sim-panel-step-0-fault-rule");
  await rule.selectOption("rule:__all");
  await page.getByTestId("sim-panel-step-0-fault-value").selectOption("soft");
  await page.getByTestId("sim-panel-save").click();
  await expect
    .poll(async () => (await savedDiagram(page)).simulations?.[0].timeline?.[0].action)
    .toMatchObject({
      do: "fault",
      drill: "cold-cache",
      fault: { kind: "purge", node: "cdn", rule: "__all", mode: "soft" },
    });
  if (process.env.CDN_SHOTS) {
    mkdirSync(process.env.CDN_SHOTS, { recursive: true });
    await page.getByTestId("sim-panel").screenshot({ path: join(process.env.CDN_SHOTS, "purge-step.png") });
  }
});

test("a saved purge with a removed rule explains disabled actions while Timeline is collapsed", async ({ page }) => {
  const diagram = purgeEditorFixture();
  const simulation = diagram.simulations?.[0];
  if (!simulation) throw new Error("Expected the public purge editor fixture");
  simulation.timeline = [{ atMs: 0, action: { do: "fault", fault: { kind: "purge", node: "cdn", rule: "removed" } } }];
  await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    key: STORAGE_KEYS.autosavePrefix + "cache-stampede",
    diagram,
  });
  await gotoLive(page, "./?view=canvas&example=cache-stampede&live=1&paused=1");
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-edit-sims").click();
  await page.getByTestId("sim-panel-edit-purge-rules").click();
  const timeline = page.getByTestId("sim-panel-section-timeline");
  const rule = page.getByTestId("sim-panel-step-0-fault-rule");
  await expect(timeline).not.toHaveAttribute("open");
  await expect(rule).toBeHidden();
  const explanation =
    "Timeline step 1: cache rule “removed” is unavailable. Choose an available rule or remove this step.";
  await expect(page.getByTestId("sim-panel-invalid")).toBeVisible();
  await expect(page.getByTestId("sim-panel-invalid")).toHaveText(explanation);
  await expect(timeline).toHaveAttribute("data-warning", "true");
  for (const action of ["run", "save"]) {
    await expect(page.getByTestId(`sim-panel-${action}`)).toBeDisabled();
    await expect(page.getByTestId(`sim-panel-${action}`)).toHaveAccessibleDescription(explanation);
  }
  await page.getByTestId("sim-panel-step-0-fault-rule-repair").click();
  await expect(timeline).toHaveAttribute("open", "");
  await expect(rule).toBeFocused();
  await expect(rule).toHaveValue("rule:removed");
  await expect(rule).toHaveAttribute("aria-invalid", "true");
  await expect(rule).toHaveAccessibleDescription("Rule: choose an existing target in this diagram.");
  await rule.selectOption("rule:__all");
  await expect(page.getByTestId("sim-panel-invalid")).toBeEmpty();
  await expect(timeline).not.toHaveAttribute("data-warning");
  for (const action of ["run", "save"]) {
    await expect(page.getByTestId(`sim-panel-${action}`)).toBeEnabled();
    await expect(page.getByTestId(`sim-panel-${action}`)).not.toHaveAttribute("aria-describedby");
  }
});

test("purge menus keep every rule ID unique and fit the contextual menu budget", async ({ page }) => {
  await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    key: STORAGE_KEYS.autosavePrefix + "cache-stampede",
    diagram: purgeEditorFixture(),
  });
  await gotoLive(page, "./?view=canvas&example=cache-stampede&live=1&paused=1&sim=purge-rules");
  await waitForStableViewport(page);
  await page.getByTestId("node-cdn").click({ button: "right" });
  await page.getByTestId("context-menu-item-sim.fault").hover();
  await page.getByTestId("context-menu-item-sim.purge").hover();
  for (const id of ["all", "default"])
    await expect(page.getByTestId(`context-menu-item-sim.purge:hard:${id}`)).toHaveCount(1);
  for (const id of ["__all", "all", "default"])
    await expect(page.getByTestId(`context-menu-item-sim.purge:hard:rule:${id}`)).toHaveCount(1);
  await page.getByTestId("context-menu-item-sim.purge:hard:rule:all").click();
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await expect(page.getByTestId("canvas-announce")).toContainText("cache purged");
  await expect(page.getByTestId("canvas-announce")).toContainText(/Empty the cache: .*all/);
  for (const [parent, child, words] of [
    ["sim.purge", "sim.purge:hard:all", "Empty the cache: All rules"],
    ["sim.soft-purge", "sim.purge:soft:rule:__all", "Soft purge: __all"],
    ["sim.soft-purge", "sim.purge:soft:all", "Soft purge: All rules"],
    ["sim.deploy-purge", "", "Deploy: All rules"],
  ]) {
    await page.getByTestId("node-cdn").click({ button: "right" });
    await page.getByTestId("context-menu-item-sim.fault").hover();
    if (child) {
      await page.getByTestId(`context-menu-item-${parent}`).hover();
      await page.getByTestId(`context-menu-item-${child}`).click();
    } else await page.getByTestId(`context-menu-item-${parent}`).click();
    await expect
      .poll(async () => (await page.getByTestId("canvas-announce").textContent())?.replace(/[\u2068\u2069]/g, ""))
      .toContain(words);
    await expect(page.getByTestId("canvas-announce")).toContainText("Edge CDN");
  }
});

for (const locale of ["ar", "en-XA"])
  for (const width of [375, 1280])
    test(`stale controls fit and stay keyboard operable in ${locale} at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      await page.addInitScript(
        ({ locale, key, diagram }) => {
          localStorage.setItem("diagrams.locale", locale);
          localStorage.setItem(key, JSON.stringify(diagram));
        },
        { locale, key: STORAGE_KEYS.autosavePrefix + "cache-stampede", diagram: stampede },
      );
      await gotoCanvas(page, "cache-stampede");
      await waitForStableViewport(page);
      await fitDiagram(page);
      await page.getByTestId("node-cdn").click();
      await waitForSelectionSettled(page);
      await page.getByTestId("inspector-section-node-cache").click();
      await page.getByTestId("cache-rule-launch").click();
      await page.getByTestId("cache-rule-launch-expires-toggle").click();
      const select = page.getByTestId("cache-rule-launch-stale-window");
      await select.focus();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(select).toHaveValue("10000");
      if (locale === "ar") await expect(select).toContainText("إيقاف");
      const panel = page.getByTestId("inspector-cache");
      expect(await panel.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
      if (process.env.CDN_SHOTS) {
        mkdirSync(process.env.CDN_SHOTS, { recursive: true });
        await panel.screenshot({ path: join(process.env.CDN_SHOTS, `stale-${locale}-${width}.png`) });
      }
    });
