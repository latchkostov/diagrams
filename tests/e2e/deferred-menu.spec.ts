import { test, expect, gotoCanvas, waitForStableViewport, savedDiagram, STORAGE_KEYS } from "./fixtures";
import { lazySurfacesFixture } from "../../src/lab/lazySurfacesFixture";
import { chunk } from "./chunk";

const scenarios = [
  "navigation",
  "finish",
  "name",
  "name escape",
  "other control",
  "click away",
  "edits",
  "selection edits",
  "late identity",
  "late container",
] as const;

for (const scenario of scenarios)
  test(`held menu matches loaded menu: ${scenario}`, async ({ browser }) => {
    const results = [];
    for (const held of [false, true]) {
      const page = await browser.newPage();
      let release = () => {};
      let identityRelease = () => {};
      let requested = false;
      const download = new Promise<void>((resolve) => {
        release = resolve;
      });
      if (held)
        await page.route(chunk("MenuList", "src/components/MenuList.tsx"), async (route) => {
          requested = true;
          await download;
          await route.continue();
        });
      if (scenario === "late identity" || scenario === "late container") {
        const identity = new Promise<void>((resolve) => {
          identityRelease = resolve;
        });
        await page.route(
          chunk(
            scenario === "late identity" ? "NodeIdentity" : "NodePanel",
            scenario === "late identity"
              ? "src/canvas/inspector/NodeIdentity.tsx"
              : "src/canvas/inspector/NodePanel.tsx",
          ),
          async (route) => {
            await identity;
            await route.continue();
          },
        );
      }
      try {
        await page.addInitScript(({ diagram, key }) => localStorage.setItem(key, JSON.stringify(diagram)), {
          diagram: lazySurfacesFixture(),
          key: STORAGE_KEYS.autosavePrefix + "blocking-call",
        });
        await gotoCanvas(page, "blocking-call");
        await waitForStableViewport(page);
        await page.getByTestId("node-caller").click();
        await page.getByTestId("canvas-wrap").focus();
        const before = await savedDiagram(page);
        await page.keyboard.press("Alt+ArrowRight");
        if (held) await expect.poll(() => requested).toBe(true);
        else await expect(page.getByTestId("quick-add-search")).toBeFocused();
        await page.keyboard.type(scenario === "edits" ? "ca" : "cache");
        await page.keyboard.press("ArrowDown");
        if (scenario === "edits") {
          await page.keyboard.type("chx");
          await page.keyboard.press("Backspace");
          await page.keyboard.type("e");
          await page.keyboard.press("ArrowDown");
        }
        if (scenario === "selection edits") {
          await page.keyboard.press("Home");
          await page.keyboard.press("Shift+ArrowRight");
          await page.keyboard.press("Shift+ArrowRight");
          await page.keyboard.type("ca");
          await page.keyboard.press("End");
          await page.keyboard.press("ControlOrMeta+a");
          await page.keyboard.type("cache");
          await page.keyboard.press("ArrowDown");
        }
        if (scenario === "other control") {
          await page.getByTestId("file-button").focus();
          await page.keyboard.press("Enter");
          await expect(page.getByTestId("file-more-formats")).toBeVisible();
        } else if (scenario === "click away") {
          await page.getByTestId("file-button").click();
        } else {
          await page.keyboard.press("Enter");
          if (
            scenario === "name" ||
            scenario === "name escape" ||
            scenario === "late identity" ||
            scenario === "late container"
          )
            await page.keyboard.type("Cache audit");
          if (scenario === "finish" || scenario === "name escape") await page.keyboard.press("Escape");
        }
        release();
        if (scenario === "other control" || scenario === "click away") {
          // Observe the late completion too: a cancelled queue must never create a node or steal focus.
          await expect
            .poll(() => page.evaluate(() => window.__lazySurfaces?.states()["canvas.menu"]?.state))
            .toBe("loaded");
          expect(await savedDiagram(page)).toEqual(before);
        } else {
          await expect.poll(async () => (await savedDiagram(page)).nodes.length).toBe(before.nodes.length + 1);
          identityRelease();
          if (scenario === "name" || scenario === "late identity" || scenario === "late container") {
            await expect(page.getByTestId("inspector-field-label")).toHaveValue("Cache audit");
            await page.keyboard.press("Enter");
          }
          if (scenario === "name escape")
            await expect
              .poll(
                async () =>
                  (await savedDiagram(page)).nodes.find((node) => !before.nodes.some((old) => old.id === node.id))
                    ?.label,
              )
              .toBe("Cache audit");
          await expect(page.getByTestId("quick-add")).toHaveCount(0);
          await expect.poll(async () => (await savedDiagram(page)).edges.length).toBe(before.edges.length + 1);
        }
        const after = await savedDiagram(page);
        const added = after.nodes.find((node) => !before.nodes.some((old) => old.id === node.id));
        if (scenario === "finish") await expect(page.getByTestId(`rf__node-${added?.id}`)).toBeFocused();
        results.push({
          stencil: added?.stencil,
          label: added?.label,
          nodes: after.nodes.length,
          edges: after.edges.length,
        });
      } finally {
        release();
        identityRelease();
        await page.close();
      }
    }
    expect(results[1]).toEqual(results[0]);
  });

test("failed menu retains ordered input through Retry", async ({ page }) => {
  let fail = true;
  await page.route(chunk("MenuList", "src/components/MenuList.tsx"), async (route) => {
    if (fail) await route.abort("failed");
    else await route.continue();
  });
  await page.addInitScript(({ diagram, key }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    diagram: lazySurfacesFixture(),
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
  });
  await gotoCanvas(page, "blocking-call");
  await waitForStableViewport(page);
  await page.getByTestId("node-caller").click();
  await page.getByTestId("canvas-wrap").focus();
  const before = await savedDiagram(page);
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("lazy-load-retry")).toBeVisible();
  await page.keyboard.type("cache");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Recovered cache");
  fail = false;
  // Retry's pointer press belongs to recovery, so it must not cancel the pending pick.
  await page.getByTestId("menu-load-retry").click();
  await expect(page.getByTestId("inspector-field-label")).toHaveValue("Recovered cache");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await savedDiagram(page)).nodes.length).toBe(before.nodes.length + 1);
});
