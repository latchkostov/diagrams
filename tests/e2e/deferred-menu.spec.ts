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
  "word deletion",
  "select all",
  "selected line",
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
        await page.keyboard.type(scenario === "edits" ? "ca" : scenario === "selection edits" ? "xedis" : "cache");
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
          await page.keyboard.type("r");
          await page.keyboard.press("End");
          await page.keyboard.press("ArrowDown");
        }
        if (scenario === "word deletion") {
          await page.keyboard.press("ControlOrMeta+Backspace");
          await page.keyboard.type("redis");
          await page.keyboard.press("ArrowDown");
        }
        if (scenario === "select all") {
          await page.keyboard.press("ControlOrMeta+a");
          await page.keyboard.type("redis");
        }
        if (scenario === "selected line") {
          await page.keyboard.press("Home");
          await page.keyboard.press("Shift+End");
          await page.keyboard.type("redis");
        }
        if (["selection edits", "word deletion", "select all", "selected line"].includes(scenario)) {
          release();
          await expect(page.getByTestId("quick-add-search")).toHaveValue("redis");
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

async function seed(page: import("@playwright/test").Page) {
  await page.addInitScript(({ diagram, key }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    diagram: lazySurfacesFixture(),
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
  });
  await gotoCanvas(page, "blocking-call");
  await waitForStableViewport(page);
}

test("failed menu retains ordered input through keyboard Retry, matching eager pick", async ({ browser }) => {
  const results = [];
  for (const held of [false, true]) {
    const page = await browser.newPage();
    let release = () => {};
    const download = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested = false;
    let fail = true;
    if (held)
      await page.route(chunk("MenuList", "src/components/MenuList.tsx"), async (route) => {
        requested = true;
        if (fail) {
          await download;
          await route.abort("failed");
        } else await route.continue();
      });
    try {
      await seed(page);
      await page.getByTestId("node-caller").click();
      await page.getByTestId("canvas-wrap").focus();
      const before = await savedDiagram(page);
      await page.keyboard.press("Alt+ArrowRight");
      if (held) await expect.poll(() => requested).toBe(true);
      else await expect(page.getByTestId("quick-add-search")).toBeFocused();
      await page.keyboard.type("cache");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await page.keyboard.type("Recovered cache");
      if (held) {
        release();
        await expect(page.getByTestId("menu-load-retry")).toBeVisible();
        await page.keyboard.press("Tab");
        await expect(page.getByTestId("menu-load-retry")).toBeFocused();
        fail = false;
        await page.keyboard.press("Enter");
      }
      await expect(page.getByTestId("inspector-field-label")).toHaveValue("Recovered cache");
      await page.keyboard.press("Enter");
      await expect.poll(async () => (await savedDiagram(page)).nodes.length).toBe(before.nodes.length + 1);
      const added = (await savedDiagram(page)).nodes.find((node) => !before.nodes.some((old) => old.id === node.id));
      results.push({ label: added?.label, stencil: added?.stencil });
    } finally {
      release();
      await page.close();
    }
  }
  expect(results[1]).toEqual(results[0]);
});

for (const surface of ["NodePanel", "NodeIdentity"] as const)
  for (const finish of ["Enter", "Escape"] as const)
    test(`pending inspector naming saves and finishes before download: ${surface} ${finish}`, async ({ page }) => {
      let release = () => {};
      const download = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(chunk(surface, `src/canvas/inspector/${surface}.tsx`), async (route) => {
        await download;
        await route.continue();
      });
      try {
        await seed(page);
        const before = await savedDiagram(page);
        await page.getByTestId("node-caller").click();
        await page.getByTestId("canvas-wrap").focus();
        await page.keyboard.press("Alt+ArrowRight");
        await expect(page.getByTestId("quick-add-search")).toBeFocused();
        await page.keyboard.type("redis");
        await page.keyboard.press("Enter");
        await page.keyboard.type("Cache");
        await expect
          .poll(() => page.evaluate(() => window.__interactionJournal?.some((entry) => entry.event === "rename.hold")))
          .toBe(true);
        await page.keyboard.type(" suffix");
        await page.keyboard.press(finish);
        await expect
          .poll(
            async () =>
              (await savedDiagram(page)).nodes.find((node) => !before.nodes.some((old) => old.id === node.id))?.label,
          )
          .toBe("Cache suffix");
        const added = (await savedDiagram(page)).nodes.find((node) => !before.nodes.some((old) => old.id === node.id));
        if (!added) throw new Error("Expected a new node");
        await expect(page.getByTestId(`rf__node-${added.id}`)).toBeFocused();
        release();
        await expect(page.getByTestId("inspector-field-label")).toHaveValue("Cache suffix");
        await expect(page.getByTestId(`rf__node-${added.id}`)).toBeFocused();
        await page.keyboard.press("ControlOrMeta+z");
        await expect.poll(async () => (await savedDiagram(page)).nodes.length).toBe(before.nodes.length);
        expect((await savedDiagram(page)).edges.map((edge) => ({ ...edge, kind: edge.kind ?? "async" }))).toEqual(
          before.edges.map((edge) => ({ ...edge, kind: edge.kind ?? "async" })),
        );
      } finally {
        release();
      }
    });

test("held subtitle naming persists the requested field, matching eager inspector", async ({ browser }) => {
  const results = [];
  for (const held of [false, true]) {
    const page = await browser.newPage();
    let release = () => {};
    const download = new Promise<void>((resolve) => {
      release = resolve;
    });
    if (held)
      await page.route(chunk("NodeIdentity", "src/canvas/inspector/NodeIdentity.tsx"), async (route) => {
        await download;
        await route.continue();
      });
    try {
      await seed(page);
      const before = await savedDiagram(page);
      await page.getByTestId("palette-search").fill("redis");
      await page.getByTestId("palette-item-redis.cache").click();
      await expect.poll(async () => (await savedDiagram(page)).nodes.length).toBe(before.nodes.length + 1);
      const added = (await savedDiagram(page)).nodes.find((node) => !before.nodes.some((old) => old.id === node.id));
      if (!added) throw new Error("Expected a new node");
      await page.getByTestId(`node-${added.id}`).click({ button: "right" });
      await page.getByTestId("context-menu-item-node.edit-sublabel").click();
      if (held)
        await expect
          .poll(() => page.evaluate(() => window.__interactionJournal?.some((entry) => entry.event === "rename.hold")))
          .toBe(true);
      else await expect(page.getByTestId("inspector-field-sublabel")).toBeFocused();
      await page.keyboard.type("Cache details");
      await page.keyboard.press("Enter");
      await expect
        .poll(async () => (await savedDiagram(page)).nodes.find((node) => node.id === added.id)?.sublabel)
        .toBe("Cache details");
      await expect(page.getByTestId(`rf__node-${added.id}`)).toBeFocused();
      release();
      await expect(page.getByTestId("inspector-field-sublabel")).toHaveValue("Cache details");
      const after = (await savedDiagram(page)).nodes.find((node) => node.id === added.id);
      if (!after) throw new Error("Expected the named node");
      results.push({ label: after.label, sublabel: after.sublabel });
      expect(after.label).toBe(added.label);
    } finally {
      release();
      await page.close();
    }
  }
  expect(results[1]).toEqual(results[0]);
});
