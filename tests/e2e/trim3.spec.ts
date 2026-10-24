import { test, expect, gotoCanvas, waitForStableViewport, savedDiagram, STORAGE_KEYS } from "./fixtures";
import { lazySurfacesFixture } from "../../src/lab/lazySurfacesFixture";
import { chunk } from "./chunk";

// Settings must never own the pending name or delay the eager menu's pick.
test("held node settings preserve quick-add naming, completion and one-step undo", async ({ page }) => {
  let release!: () => void;
  const download = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(chunk("NodeSettings", "src/canvas/inspector/NodeSettings.tsx"), async (route) => {
    await download;
    await route.continue();
  });
  const diagram = lazySurfacesFixture();
  // Give this editor fixture explicit kinds, as the first committed edit serializes them.
  for (const edge of diagram.edges) edge.kind ??= "async";
  await page.addInitScript(({ diagram, key }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    diagram,
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
  });
  try {
    await gotoCanvas(page, "blocking-call");
    await waitForStableViewport(page);
    const before = await savedDiagram(page);
    await page.getByTestId("node-caller").click();
    await expect
      .poll(() => page.evaluate(() => window.__lazySurfaces?.states()["inspector.node-settings"]))
      .toEqual({ state: "loading", active: true });
    await page.getByTestId("canvas-wrap").focus();
    await page.keyboard.press("Alt+ArrowRight");
    await expect(page.getByTestId("quick-add-search")).toBeFocused();
    await page.keyboard.type("cache");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Cache audit");
    await page.keyboard.press("Escape");
    await expect
      .poll(
        async () =>
          (await savedDiagram(page)).nodes.find((node) => !before.nodes.some((old) => old.id === node.id))?.label,
      )
      .toBe("Cache audit");
    const added = (await savedDiagram(page)).nodes.find((node) => !before.nodes.some((old) => old.id === node.id));
    if (!added) throw new Error("Expected the named node");
    await expect(page.getByTestId(`rf__node-${added.id}`)).toBeFocused();
    release();
    await expect
      .poll(() => page.evaluate(() => window.__lazySurfaces?.states()["inspector.node-settings"]?.state))
      .toBe("loaded");
    await expect(page.getByTestId(`rf__node-${added.id}`)).toBeFocused();
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("Cache audit");
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => (await savedDiagram(page)).nodes.length).toBe(before.nodes.length);
    expect((await savedDiagram(page)).edges).toEqual(before.edges);
  } finally {
    release();
  }
});
