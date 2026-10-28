import { test, expect, gotoCanvas, gotoLive, waitForCameraIdle, viewportTransform } from "./fixtures";

type Probe = { target: Element; id: number; moves: { same: boolean; captured: boolean }[] };

for (const mode of ["middle", "space", "live", "present"])
  test(`a ${mode} pan captures its pointer and releases it on up`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    if (mode === "live") await gotoLive(page, "./?view=canvas&example=kafka-order-pipeline&live=1&paused=1");
    else await gotoCanvas(page, "kafka-order-pipeline");
    if (mode === "present") {
      await page.getByTestId("present-toggle").click();
      await expect(page.getByTestId("present-exit")).toBeVisible();
    }
    await waitForCameraIdle(page);
    const node = page.getByTestId("node-payments");
    const bounds = await node.boundingBox();
    if (!bounds) throw new Error("Missing node");
    await page.getByTestId("canvas-wrap").evaluate((root) => {
      root.addEventListener(
        "pointerdown",
        (event) => {
          (window as unknown as { __panProbe: Probe }).__panProbe = {
            target: event.target as Element,
            id: event.pointerId,
            moves: [],
          };
        },
        true,
      );
      root.addEventListener(
        "pointermove",
        (event) => {
          const probe = (window as unknown as { __panProbe?: Probe }).__panProbe;
          if (probe && event.buttons)
            probe.moves.push({
              same: event.target === probe.target,
              captured: probe.target.hasPointerCapture(probe.id),
            });
        },
        true,
      );
    });
    const before = await viewportTransform(page);
    const button = mode === "middle" ? "middle" : "left";
    if (mode === "space") await page.keyboard.down("Space");
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down({ button });
    try {
      for (let step = 1; step <= 4; step++)
        await page.mouse.move(bounds.x + bounds.width / 2 + step * 20, bounds.y + bounds.height / 2 + step * 10);
      const moves = await page.evaluate(() => (window as unknown as { __panProbe: Probe }).__panProbe.moves);
      expect(moves.length).toBeGreaterThanOrEqual(4);
      expect(moves.every((move) => move.same && move.captured)).toBe(true);
      expect(await viewportTransform(page)).not.toBe(before);
    } finally {
      await page.mouse.up({ button });
      if (mode === "space") await page.keyboard.up("Space");
    }
    expect(
      await page.evaluate(() => {
        const probe = (window as unknown as { __panProbe: Probe }).__panProbe;
        return probe.target.hasPointerCapture(probe.id);
      }),
    ).toBe(false);
  });
