import type { Page } from "@playwright/test";
import { test, expect, pageLoadTimeout, waitForCameraIdle, waitForSelectionSettled } from "./fixtures";
import { expectNoViolations } from "./a11y-helpers";
import { runKeyboardTutorial } from "./keyboard-tutorial-driver";

async function begin(page: Page, id = "mobile-api") {
  await page.goto(`./?tutorial=${id}`);
  await expect(page.getByTestId("tutorial-start")).toBeVisible({ timeout: pageLoadTimeout() });
  await page.getByTestId("tutorial-start").click();
  await waitForCameraIdle(page);
}
async function finish(page: Page) {
  const strip = page.getByTestId("tutorial-step");
  while ((await strip.getAttribute("data-phase")) === "step") {
    const step = await strip.getAttribute("data-step");
    await page.getByTestId("tutorial-skip").click();
    await expect(strip).not.toHaveAttribute("data-step", step ?? "");
  }
  await expect(page.getByTestId("tutorial-handoff-heading")).toBeFocused();
}

test("keyboard-only completion reaches the sheet and starts the next lesson", async ({ page, consoleErrors }) => {
  await runKeyboardTutorial(page, consoleErrors, "quick-add");
  await expect(page.getByTestId("tutorial-handoff-heading")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("tutorial-handoff-body")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("tutorial-next")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tutorial-app")).toHaveAttribute("data-tutorial", "dots-and-sides");
  await expect(page.getByTestId("tutorial-intro")).toHaveCount(0);
});
for (const [width, height, theme] of [
  [2560, 1440, "light"],
  [2560, 1440, "dark"],
  [1440, 900, "light"],
  [390, 844, "light"],
] as const) {
  test(`v7 rail sheet: ${width} ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.addInitScript((theme) => localStorage.setItem("diagrams.theme", theme), theme);
    await begin(page);
    await finish(page);
    const sheet = page.getByTestId("tutorial-handoff");
    await expect(page.getByTestId("tutorial-handoff-drawing")).toBeVisible();
    await expect(sheet).toHaveCSS("width", width === 390 ? "390px" : width === 1440 ? "440px" : "600px");
    const columns = await page
      .getByTestId("tutorial-handoff-steps")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(width === 2560 ? 2 : 1);
    await expect(page.getByTestId("tutorial-next")).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId("tutorial-done-exit")).toBeInViewport({ ratio: 1 });
    if (width >= 1440) {
      await expect(page.getByTestId("tutorial-handoff-step-4")).toBeInViewport({ ratio: 1 });
      await expect
        .poll(() => page.getByTestId("tutorial-handoff-body").evaluate((el) => el.scrollHeight <= el.clientHeight))
        .toBe(true);
      await expect
        .poll(async () => {
          const step = await page.getByTestId("tutorial-handoff-step-4").boundingBox();
          const footer = await page.getByTestId("tutorial-handoff-footer").boundingBox();
          return !!step && !!footer && step.y + step.height <= footer.y;
        })
        .toBe(true);
    }
    await expectNoViolations(page, "tutorial-handoff");
    await page.screenshot({ path: testInfo.outputPath(`v7-${width}-${theme}.png`) });
    await page.getByTestId("tutorial-next").click();
    await expect(page.getByTestId("tutorial-app")).toHaveAttribute("data-tutorial", "quick-add");
    await expect(page.getByTestId("tutorial-intro")).toHaveCount(0);
    await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-phase", "step");
  });
}

for (const close of ["stay", "scrim", "escape"] as const) {
  test(`v7 ${close} returns focus and keyboard control to the canvas`, async ({ page }) => {
    await begin(page);
    await finish(page);
    if (close === "escape") await page.keyboard.press("Escape");
    else if (close === "stay") await page.getByTestId("tutorial-handoff-dismiss").click();
    else {
      const canvas = await page.getByTestId("canvas-wrap").boundingBox();
      if (!canvas) throw new Error("Missing canvas");
      await page.getByTestId("tutorial-handoff-scrim").click({ position: { x: canvas.width - 20, y: 30 } });
    }
    await expect(page.getByTestId("tutorial-handoff")).toHaveCount(0);
    await expect(page.getByTestId("tutorial-handoff-scrim")).toHaveCount(0);
    await expect(page.getByTestId("canvas-wrap")).toBeFocused();
    // Finish leaves this lesson in Live. Return to Edit before opening an editing context menu.
    await page.keyboard.press("l");
    await expect(page.getByTestId("live-toggle")).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-input")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tutorial-handoff")).toHaveCount(0);
  });
}

test("v7 settings preview reads the actual lesson's before and after values", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await begin(page, "checks-and-fixes");
  await finish(page);
  await expect(page.getByTestId("tutorial-next")).toHaveText("Start 3.1");
  await expect(page.getByTestId("tutorial-handoff-settings")).toContainText("2→6");
  await expect(page.getByTestId("tutorial-handoff-settings")).toContainText("1→3");
  await expect(page.getByTestId("tutorial-handoff-settings")).toContainText("1→2");
  await page.screenshot({ path: testInfo.outputPath("v7-settings.png") });
});

test("editing hover card follows its node and clears the grow coach", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await begin(page, "quick-add");
  await page.getByTestId("tutorial-skip").click();
  await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-step", "grow");
  const id = await page.evaluate(() => window.__tutorial?.snapshot().subjects.app);
  if (!id) throw new Error("Missing browser");
  const node = page.getByTestId(`node-${id}`);
  await node.click();
  await waitForSelectionSettled(page);
  await expect(page.getByTestId("tutorial-coach")).toHaveAttribute("data-target", `grow-chip-${id}`);
  await node.hover();
  const tip = page.getByTestId("node-tooltip");
  await expect(tip).toBeVisible();
  // Panning dismisses hover intent; reopening must measure the node in its new viewport.
  await page.mouse.wheel(0, 160);
  await waitForCameraIdle(page);
  await node.hover();
  await expect(tip).toBeVisible();
  await expect
    .poll(async () => {
      const a = await tip.boundingBox(),
        b = await node.boundingBox(),
        c = await page.getByTestId("coach-card").boundingBox();
      if (!a || !b || !c) return false;
      const overlaps = (r: typeof a, s: typeof b) =>
        r.x < s.x + s.width && r.x + r.width > s.x && r.y < s.y + s.height && r.y + r.height > s.y;
      return !overlaps(a, b) && !overlaps(a, c);
    })
    .toBe(true);
});
