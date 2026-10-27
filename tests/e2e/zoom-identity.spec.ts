import { textFieldsFixture } from "../../src/lab/textFieldsFixture";
import { expect, test, gotoCanvas, STORAGE_KEYS, pauseClock, viewportTransform, waitForCameraIdle } from "./fixtures";
import { expectFittedIdentity } from "./node-identity";

for (const nodeVariant of ["card", "compact", "iconOnly"])
  for (const platform of ["Win32", "MacIntel"])
    test(`a held zoom keeps fitted identity across size steps (${nodeVariant}, ${platform})`, async ({ page }) => {
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
          diagram: textFieldsFixture,
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
        for (const node of textFieldsFixture.nodes) await expectFittedIdentity(page, node.id, node.label);
      }
      await pane.dispatchEvent("pointerup", { pointerId: 42, pointerType: "touch", bubbles: true });
      await page.clock.runFor(400);
      await expect(wrap).not.toHaveAttribute("data-viewport-moving");
      expect(Number(await wrap.evaluate((el) => el.style.getPropertyValue("--rf-zoom-exact")))).toBeCloseTo(0.75, 10);
      for (const node of textFieldsFixture.nodes) await expectFittedIdentity(page, node.id, node.label);
    });
