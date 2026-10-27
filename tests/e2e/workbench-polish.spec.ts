import { test, expect, gotoCanvas, gotoLive, pauseClock, waitForCameraIdle } from "./fixtures";

test.use({ viewport: { width: 390, height: 844 } });

test("the phone rail's arrow traversal includes More and excludes its closed items", async ({ page }) => {
  await gotoCanvas(page, "retry-storm");
  await page.getByTestId("rail-select").focus();
  await page.keyboard.press("End");
  await expect(page.getByTestId("rail-more")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.getByTestId("rail-select")).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("view-gallery")).toBeFocused();
});

for (const theme of ["light", "dark"])
  test(`the phone note is bounded and returns focus (${theme})`, async ({ page }) => {
    await page.clock.install();
    await page.addInitScript(
      (theme) => localStorage.setItem("diagrams.settings.v1", JSON.stringify({ themePreference: theme })),
      theme,
    );
    await gotoLive(page, "./?view=canvas&example=retry-storm&live=1&sim=three-quick-retries&paused=1");
    await pauseClock(page);
    const time = page.getByTestId("live-timeline-input");
    await time.fill("159");
    await time.press("ArrowRight");
    await page.getByTestId("live-view-menu").click();
    await page.getByTestId("view-follow").click();
    await page.clock.runFor(1400);
    await waitForCameraIdle(page);
    for (const id of ["live-note-expand", "live-note-details"]) {
      const boundary = await page.getByTestId(id).evaluate((el) => {
        const cs = getComputedStyle(el);
        return { width: cs.borderTopWidth, style: cs.borderTopStyle };
      });
      expect(boundary).toEqual({ width: "1px", style: "solid" });
    }
    const colour = async (board = false) => {
      const box = board
        ? { x: 150, y: 110, width: 0, height: 0 }
        : await page.getByTestId("node-payments").boundingBox();
      if (!box) throw new Error("Expected Payments");
      const png = await page.screenshot({ animations: "disabled" });
      return page.evaluate(
        async ({ png, x, y }) => {
          const image = new Image();
          image.src = "data:image/png;base64," + png;
          await image.decode();
          const c = document.createElement("canvas");
          c.width = image.width;
          c.height = image.height;
          const ctx = c.getContext("2d");
          if (!ctx) throw new Error("Expected pixel canvas");
          ctx.drawImage(image, 0, 0);
          return [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data];
        },
        { png: png.toString("base64"), x: box.x + box.width - 15, y: box.y + box.height - 15 },
      );
    };
    const before = await colour();
    const boardBefore = await colour(true);
    await page.getByTestId("live-note-expand").click();
    await expect(page.getByTestId("live-note-close")).toBeFocused();
    await expect(page.getByTestId("focus-offscreen-checkout")).toBeVisible();
    // Display compositing may round one channel by one code point; a scrim must not darken the subject.
    const after = await colour();
    expect((await colour(true))[0]).toBeLessThan(boardBefore[0]);
    expect(Math.max(...after.map((channel, index) => Math.abs(channel - before[index])))).toBeLessThanOrEqual(1);
    await page.getByTestId("live-note-close").click();
    await expect(page.getByTestId("live-note-expand")).toBeFocused();
    await page.getByTestId("live-note-expand").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("live-note-expand")).toBeFocused();
  });
