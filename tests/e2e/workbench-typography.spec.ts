import { test, expect, gotoCanvas, gotoLive, expectTheme, pauseClock, waitForCameraIdle } from "./fixtures";

test("selected subtitles grow to two lines and React Flow remeasures the card", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoCanvas(page, "retry-storm");
  await page.getByTestId("node-payments").click();
  const subtitle = page.getByTestId("inspector-field-sublabel");
  await subtitle.fill("Worker");
  await subtitle.press("Tab");
  await waitForCameraIdle(page);
  const node = page.getByTestId("rf__node-payments");
  const small = await node.evaluate((el) => (el as HTMLElement).offsetHeight);
  await subtitle.fill("Twelve workers handle every request with a bounded queue and a shared connection pool");
  await subtitle.press("Tab");
  await expect.poll(() => node.evaluate((el) => (el as HTMLElement).offsetHeight)).toBeGreaterThan(small);
  const line = page.getByTestId("node-payments").getByTestId("card-second-line");
  const style = await line.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      font: cs.fontFamily,
      height: (el as HTMLElement).offsetHeight,
      line: parseFloat(cs.lineHeight),
      clamp: cs.webkitLineClamp,
    };
  });
  expect(style.font).toContain("Mona Sans");
  expect(style.clamp).toBe("2");
  expect(style.height).toBeGreaterThan(style.line);
  expect(style.height).toBeLessThanOrEqual(Math.ceil(style.line * 2));
  await expect
    .poll(() =>
      node.evaluate((el) =>
        Math.abs((el as HTMLElement).offsetHeight - (el.firstElementChild as HTMLElement).offsetHeight),
      ),
    )
    .toBeLessThanOrEqual(1);
});

test("Edit message paths keep full opacity and a two-pixel stroke", async ({ page }) => {
  await gotoCanvas(page, "retry-storm");
  const stroke = page.getByTestId("connection-stroke-orders-flow");
  const style = await stroke.evaluate((el) => ({
    opacity: getComputedStyle(el).opacity,
    width: getComputedStyle(el).strokeWidth,
  }));
  expect(style).toEqual({ opacity: "1", width: "2px" });
});

for (const theme of ["light", "dark"])
  test(`Live badge shapes preserve their meanings (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.install();
    await gotoLive(page, "./?view=canvas&example=retry-storm&live=1&sim=three-quick-retries&paused=1");
    await expectTheme(page, theme);
    await pauseClock(page);
    const time = page.getByTestId("live-timeline-input");
    await time.fill("159");
    await time.press("ArrowRight");
    await page.clock.runFor(1400);
    await waitForCameraIdle(page);
    const lost = page.getByTestId("node-alert-payments");
    await expect(lost).toHaveClass(/is-lost/);
    await expect(page.getByTestId(/^node-processed-/).first()).toHaveClass(/is-processed/);
    const contrast = await lost.evaluate((el) => {
      const cs = getComputedStyle(el);
      const lum = (color: string) => {
        const values = color
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number);
        if (!values) throw new Error("Expected RGB ink");
        return values
          .map((v) => {
            const n = v / 255;
            return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
          })
          .reduce((a, n, i) => a + n * [0.2126, 0.7152, 0.0722][i], 0);
      };
      const a = lum(cs.color),
        b = lum(cs.backgroundColor);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  });

test("the main-thread canvas uses tabular Mona Sans at its registered width", async ({ page }) => {
  await gotoLive(page, "./?view=canvas&example=retry-storm&live=1&paused=1&renderer=main");
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.fonts].some(
          (face) => face.family.replaceAll('"', "") === "Mona Sans Canvas" && face.status === "loaded",
        ),
      ),
    )
    .toBe(true);
  const widths = await page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("Expected a canvas text context");
    ctx.font = '600 12px "Mona Sans Canvas"';
    const one = ctx.measureText("1111").width,
      eight = ctx.measureText("8888").width;
    const narrow = ctx.measureText("MMMM").width;
    ctx.font = '600 12px "Mona Sans Variable"';
    return { one, eight, narrow, normal: ctx.measureText("MMMM").width };
  });
  expect(widths.one).toBeCloseTo(widths.eight, 3);
  expect(widths.narrow).toBeLessThan(widths.normal);
});
