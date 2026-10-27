import { textFieldsFixture } from "../../src/lab/textFieldsFixture";
import {
  expect,
  test,
  gotoCanvas,
  gotoLive,
  STORAGE_KEYS,
  pauseClock,
  viewportTransform,
  waitForCameraIdle,
} from "./fixtures";
import { expectFittedIdentity } from "./node-identity";

for (const nodeVariant of ["card", "compact", "iconOnly"])
  for (const platform of ["Win32", "MacIntel"])
    test(`a held zoom fits long titles after zoom reversal (${nodeVariant}, ${platform})`, async ({ page }) => {
      await page.addInitScript(
        ({ diagram, key, nodeVariant, platform }) => {
          Object.defineProperty(navigator, "platform", { configurable: true, value: platform });
          Object.defineProperty(navigator, "userAgent", {
            configurable: true,
            value: navigator.userAgent.replace(
              /\([^)]*\)/,
              platform === "MacIntel" ? "(Macintosh; Intel Mac OS X 10_15_7)" : "(Windows NT 10.0; Win64; x64)",
            ),
          });
          Object.defineProperty(navigator, "userAgentData", {
            configurable: true,
            value: { platform: platform === "MacIntel" ? "macOS" : "Windows" },
          });
          localStorage.setItem(key, JSON.stringify(diagram));
          localStorage.setItem("diagrams.settings.v1", JSON.stringify({ nodeVariant }));
        },
        {
          diagram: {
            ...textFieldsFixture,
            nodes: textFieldsFixture.nodes.map((node) => ({
              ...node,
              label: `${node.label} regional processing service`,
            })),
          },
          key: STORAGE_KEYS.autosavePrefix + "kafka-order-pipeline",
          nodeVariant,
          platform,
        },
      );
      await page.clock.install();
      await gotoCanvas(page, "kafka-order-pipeline");
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-detail-zoom", /./);
      await waitForCameraIdle(page);
      await pauseClock(page);
      const wrap = page.getByTestId("canvas-wrap");
      const pane = page.getByTestId("canvas-pane");
      const bounds = await wrap.boundingBox();
      if (!bounds) throw new Error("Missing canvas");
      await pane.dispatchEvent("pointerdown", { pointerId: 42, pointerType: "touch", button: 0, bubbles: true });
      for (const target of [0.24, 0.15, 0.75]) {
        const current = Number((await viewportTransform(page)).match(/scale\(([^)]+)\)/)?.[1]);
        await pane.dispatchEvent("wheel", {
          deltaY: Math.log2(current / target) / (platform === "MacIntel" ? 0.02 : 0.002),
          ctrlKey: true,
          clientX: bounds.x + bounds.width / 2,
          clientY: bounds.y + bounds.height / 2,
          bubbles: true,
        });
        await page.clock.runFor(16);
        await expect(wrap).toHaveAttribute("data-viewport-moving", "");
        for (const node of textFieldsFixture.nodes)
          await expectFittedIdentity(page, node.id, `${node.label} regional processing service`);
      }
      await pane.dispatchEvent("pointerup", { pointerId: 42, pointerType: "touch", bubbles: true });
      await page.clock.runFor(400);
      await expect(wrap).not.toHaveAttribute("data-viewport-moving");
      expect(Number(await wrap.evaluate((el) => el.style.getPropertyValue("--rf-zoom-exact")))).toBeCloseTo(0.75, 10);
      for (const node of textFieldsFixture.nodes)
        await expectFittedIdentity(page, node.id, `${node.label} regional processing service`);
    });

for (const width of [1440, 390])
  test(`Live programmatic fit settles when a moving card's dot is clicked (${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await gotoLive(page, "./?view=canvas&example=retry-storm&live=1&sim=three-quick-retries&paused=1");
    await waitForCameraIdle(page);
    await page.getByTestId("live-view-menu").click();
    // Invoke fit without pointer/key interruption, then deliver the handle click that
    // CI's moving card received. Live must never start an editing gesture here.
    await page.getByTestId("fit-view-button").evaluate((el: HTMLButtonElement) => el.click());
    await page.getByTestId("handle-payments-bottom").dispatchEvent("click");
    await page.getByTestId("node-payments").dispatchEvent("click");
    await expect(page.getByTestId("dock-tab-properties")).toBeVisible();
    await waitForCameraIdle(page);
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-interaction-state", "idle");
    await expect(page.getByTestId("canvas-wrap")).not.toHaveAttribute("data-viewport-moving");
  });
