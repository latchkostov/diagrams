import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, gotoCanvas, gotoLive, waitForCameraIdle, waitForStableViewport } from "./fixtures";
import { zoomIdentity } from "./node-identity";

const shots = [
  { name: "reco-40-edit", example: "recommendations-feature-store", zoom: 0.4 },
  { name: "reco-40-live", example: "recommendations-feature-store", zoom: 0.4, sim: "slow-features", at: 11400 },
  { name: "bf-25-edit", example: "black-friday-commerce", zoom: 0.25 },
  { name: "bf-25-live", example: "black-friday-commerce", zoom: 0.25, sim: "poison-deploy", at: 11300 },
  { name: "dd-35-edit", example: "delivery-dispatch", zoom: 0.35 },
];

for (const theme of ["light", "dark"] as const)
  for (const shot of shots)
    test(`capture chips ${shot.name} ${theme}`, async ({ page }, info) => {
      test.skip(!process.env.LOWZOOM_CAPTURE_DIR, "Opt-in real-app design captures");
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      if (shot.sim) {
        await page.clock.install();
        await gotoLive(page, `./?view=canvas&example=${shot.example}&live=1&sim=${shot.sim}&paused=1`);
        const duration = shot.example === "black-friday-commerce" ? 30000 : 26000;
        await page.getByTestId("live-timeline-input").fill(String(Math.round(((shot.at ?? 0) / duration) * 1000) - 1));
        await page.getByTestId("live-timeline-input").press("ArrowRight");
        await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
        await expect
          .poll(async () => Number(await page.getByTestId("live-clock").getAttribute("data-ms")))
          .toBeGreaterThan(11000);
      } else await gotoCanvas(page, shot.example);
      await page.keyboard.press("Shift+Digit1");
      await waitForCameraIdle(page);
      await zoomIdentity(page, shot.zoom);
      await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-low-zoom", shot.zoom < 0.3 ? "far" : "mid");
      for (let i = 0; i < 3; i++) {
        const delta = await page.getByTestId("canvas-wrap").evaluate((root) => {
          const pane = root.getBoundingClientRect();
          const boxes = [...root.querySelectorAll('[data-testid^="rf__node-"]')].map((n) => n.getBoundingClientRect());
          return {
            x:
              pane.x +
              pane.width / 2 -
              (Math.min(...boxes.map((b) => b.left)) + Math.max(...boxes.map((b) => b.right))) / 2,
            y:
              pane.y +
              pane.height / 2 -
              (Math.min(...boxes.map((b) => b.top)) + Math.max(...boxes.map((b) => b.bottom))) / 2,
          };
        });
        if (Math.abs(delta.x) < 1 && Math.abs(delta.y) < 1) break;
        await page
          .getByTestId("canvas-pane")
          .dispatchEvent("wheel", { deltaX: -delta.x, deltaY: -delta.y, bubbles: true });
        await waitForStableViewport(page);
      }
      if (shot.sim)
        await expect(
          page.getByTestId(shot.example === "black-friday-commerce" ? "zone-trouble-fulfil" : "zone-trouble-serving"),
        ).toContainText(shot.example === "black-friday-commerce" ? "1 failing" : "1 stressed");
      await page.mouse.move(1436, 450);
      const folder = process.env.LOWZOOM_CAPTURE_DIR;
      if (!folder) throw new Error("Missing capture directory");
      await mkdir(folder, { recursive: true });
      const path = join(folder, `${shot.name}-${theme}.png`);
      await page.screenshot({ path });
      await info.attach(shot.name, { path, contentType: "image/png" });
    });
