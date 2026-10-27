import { test, expect, gotoLab } from "./fixtures";

test("Workbench dock fixture keeps tab and Escape navigation", async ({ page }) => {
  await gotoLab(page, "workbench-dock");
  await page.getByTestId("dock-tab-properties").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("dock-tab-checks")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("lab-dock-panel")).toHaveText("Checks");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("dock-tab-properties")).toBeFocused();
  await expect(page.getByTestId("dock-tab-properties")).toHaveAttribute("aria-selected", "true");
});

test("Workbench run chart uses fixed series with the same current legend", async ({ page }) => {
  await gotoLab(page, "workbench-run-chart");
  const chart = page.getByTestId("dock-run-chart");
  await expect(chart).toHaveAttribute("data-samples", "90");
  await expect(chart).toContainText("245/s");
  await expect(chart).toContainText("1.5k");
  await expect(page.getByTestId("hover-history-chart")).toBeVisible();
});

test("Workbench tag fixture shows a finding and aggregated neighbours", async ({ page }) => {
  await gotoLab(page, "workbench-tags");
  await expect(page.getByTestId("check-marker")).toHaveText("1");
  await expect(page.getByTestId("check-count-lab-service")).toContainText("+3");
  await page.getByTestId("check-count-lab-service").click();
  await expect(page.getByTestId("check-marker")).toHaveCount(0);
  await page.getByTestId("check-count-lab-service").click();
  await expect(page.getByTestId("check-marker")).toHaveText("1");
});

test("the phone scrim gives mid-grey the same perceived dip in both themes", async ({ page }, info) => {
  await page.setViewportSize({ width: 600, height: 844 });
  await gotoLab(page, "workbench-note-scrim");
  const L = (rgb: number[]) => {
    const [r, g, b] = rgb.slice(0, 3).map((v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return (
      0.2104542553 * Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) +
      0.793617785 * Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) -
      0.0040720468 * Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    );
  };
  const pixel = async (png: Buffer) =>
    page.evaluate(async (data) => {
      const image = new Image();
      image.src = "data:image/png;base64," + data;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Expected pixel canvas");
      ctx.drawImage(image, 0, 0);
      return [...ctx.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data];
    }, png.toString("base64"));
  const drops: number[] = [];
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (theme) =>
        localStorage.setItem(
          "diagrams.settings.v1",
          JSON.stringify({
            ...JSON.parse(localStorage.getItem("diagrams.settings.v1") ?? "{}"),
            themePreference: theme,
          }),
        ),
      theme,
    );
    await page.reload();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
    const card = page.getByTestId("lab-scrim-card");
    // Finish the Lab's mount fade so both themes measure the declared mid-grey ground.
    const before = await pixel(
      await card.screenshot({ animations: "disabled", path: info.outputPath(`scrim-before-${theme}.png`) }),
    );
    expect(before).toEqual([128, 128, 128, 255]);
    await page.getByTestId("lab-scrim-toggle").click();
    const after = await pixel(
      await card.screenshot({ animations: "disabled", path: info.outputPath(`scrim-${theme}.png`) }),
    );
    const drop = L(before) - L(after);
    drops.push(drop);
    expect(drop).toBeGreaterThan(0.1);
    expect(drop).toBeLessThan(0.14);
    info.annotations.push({ type: "scrim-calibration", description: JSON.stringify({ theme, before, after, drop }) });
  }
  expect(Math.abs(drops[0] - drops[1])).toBeLessThan(0.01);
});
