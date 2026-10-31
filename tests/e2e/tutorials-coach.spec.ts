import { expectNoViolations } from "./a11y-helpers";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, waitForCameraIdle, waitForSelectionSettled, pageLoadTimeout, pauseClock } from "./fixtures";

async function begin(page: Page, lesson: string) {
  await page.goto(`./?tutorial=${lesson}`);
  await expect(page.getByTestId("tutorial-start")).toBeVisible({ timeout: pageLoadTimeout() });
  await page.getByTestId("tutorial-start").click();
  await expect(page.getByTestId("coach-card")).toBeVisible();
  await waitForCameraIdle(page);
}
async function clearTarget(page: Page, distance?: number) {
  await expect
    .poll(async () => {
      const id = await page.getByTestId("tutorial-coach").getAttribute("data-target");
      if (!id) return false;
      const a = await page.getByTestId("coach-card").boundingBox();
      const b = await page.getByTestId(id).boundingBox();
      if (!a || !b) return false;
      const viewport = await page.evaluate(() => ({
        x: visualViewport?.offsetLeft ?? 0,
        y: visualViewport?.offsetTop ?? 0,
        width: visualViewport?.width ?? innerWidth,
        height: visualViewport?.height ?? innerHeight,
      }));
      if (
        viewport.width <= 600 &&
        (a.x < viewport.x ||
          a.y < viewport.y ||
          a.x + a.width > viewport.x + viewport.width ||
          a.y + a.height > viewport.y + viewport.height)
      )
        return false;
      const dx = Math.max(a.x - b.x - b.width, b.x - a.x - a.width, 0);
      const dy = Math.max(a.y - b.y - b.height, b.y - a.y - a.height, 0);
      const separate = a.x >= b.x + b.width || b.x >= a.x + a.width || a.y >= b.y + b.height || b.y >= a.y + a.height;
      return separate && (distance === undefined || Math.hypot(dx, dy) < distance);
    })
    .toBe(true);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Missing viewport");
  if (viewport.width <= 600) {
    for (const id of ["coach-hint", "tutorial-show-me", "tutorial-skip"]) {
      await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId(id)).toBeEnabled();
    }
  }
}
async function shot(page: Page, name: string) {
  if (!process.env.COACH_SHOTS) return;
  mkdirSync(process.env.COACH_SHOTS, { recursive: true });
  await page.screenshot({ path: join(process.env.COACH_SHOTS, `${name}.png`) });
}

for (const [lesson, stepId, previous, required] of [
  ["dots-and-sides", "connect", [], ["Service A", "right dot"]],
  [
    "dots-and-sides",
    "reconnect",
    ["connect", "describe", "side"],
    ["Service B", "Bookings query", "Request", "source side"],
  ],
  ["api-gateway", "add-users", ["add-app", "add-gw", "add-orders"], ["Service", "gateway", "Users"]],
  ["quick-add", "grow", ["add-app"], ["browser", "Service"]],
  ["quick-add", "grow-db", ["add-app", "grow", "name-api"], ["Web API", "PostgreSQL"]],
] as const) {
  test(`lesson objective persists beside both routes: ${lesson}/${stepId}`, async ({ page }) => {
    await begin(page, lesson);
    for (const step of previous) {
      await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-step", step);
      await page.getByTestId("tutorial-skip").click();
    }
    await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-step", stepId);
    let objective: string | null = null;
    for (const mode of ["pointer", "keyboard", "pointer"]) {
      await page.getByTestId(`coach-route-${mode}`).click();
      const goal = page.getByTestId("coach-objective");
      await expect(goal).toBeVisible();
      for (const name of required) await expect(goal).toContainText(name);
      objective ??= await goal.textContent();
      if (objective === null) throw new Error("Missing lesson objective");
      await expect(goal).toHaveText(objective);
    }
  });
}

for (const [device, width, height] of [
  ["2560", 2560, 1440],
  ["3440", 3440, 1440],
  ["1440", 1440, 900],
  ["tablet", 1024, 768],
  ["phone", 390, 844],
] as const) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`${device} ${theme}`, () => {
      test.use({ hasTouch: width <= 1024, isMobile: width <= 600 });
      test(`coach stays by its target: ${device} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
        await page.addInitScript((theme) => {
          localStorage.setItem("diagrams.theme", theme);
        }, theme);
        await begin(page, "workbench-tour");
        await clearTarget(page, width > 600 ? 240 : undefined);
        await shot(page, `1.1-${device}-${theme}-properties`);
        if (width <= 600) {
          await page.getByTestId("tutorial-show-me").click();
          await waitForCameraIdle(page);
        }
        await page.getByTestId("node-api").click();
        await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-step", "tools");
        await page.getByTestId("tutorial-skip").click();
        await page.getByTestId("live-toggle").click();
        // Keep the real Live controls mounted before testing their camera targets, including on touch.
        if ((await page.getByTestId("inspector").getAttribute("data-collapsed")) !== "1")
          await page.getByTestId("inspector-toggle").click();
        await waitForCameraIdle(page);
        await page.getByTestId("tutorial-skip").hover();
        if ((await page.getByTestId("tutorial-step").getAttribute("data-step")) === "read")
          await page.getByTestId("tutorial-skip").click();
        await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-step", "overview");
        await clearTarget(page, width > 600 ? 240 : undefined);
        await shot(page, `1.1-${device}-${theme}-overview`);
        await page.getByTestId("live-view-menu").click();
        await clearTarget(page, width > 600 ? 400 : undefined);
        await page.getByTestId("fit-view-button").click();
        await waitForCameraIdle(page);
        await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-step", "focus");
        await begin(page, "quick-add");
        await page.getByTestId("tutorial-skip").click();
        await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-step", "grow");
        const app = await page.evaluate(() => window.__tutorial?.snapshot().subjects.app);
        if (!app) throw new Error("Missing browser subject");
        await page.getByTestId(`node-${app}`).click();
        await waitForSelectionSettled(page);
        if (width <= 600) {
          await page.getByTestId("inspector-toggle").click();
          await waitForCameraIdle(page);
        }
        await expect(page.getByTestId("tutorial-coach")).toHaveAttribute("data-target", `grow-chip-${app}`);
        await clearTarget(page, width > 600 ? 240 : undefined);
        await shot(page, `1.3-${device}-${theme}-grow`);
        await page.getByTestId("coach-route-keyboard").click();
        await expect(page.getByTestId("tutorial-coach")).toHaveAttribute("data-target", `node-${app}`);
        await expect(page.getByTestId("coach-now")).toContainText("Alt");
        await expect(page.getByTestId("coach-card")).not.toContainText("Alt+→");
        await expect(page.getByTestId("coach-key-arrow").first()).toBeVisible();
        await clearTarget(page);
        await shot(page, `1.3-${device}-${theme}-keyboard`);
      });
    });
  }
}

test("focused help follows the target through camera movement without losing focus", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await begin(page, "workbench-tour");
  await page.getByTestId("coach-hint").click();
  await expect(page.getByTestId("coach-hint")).toBeFocused();
  const source = await page.getByTestId("node-api").boundingBox();
  const canvas = await page.getByTestId("canvas-wrap").boundingBox();
  if (!source || !canvas) throw new Error("Missing tutorial target or canvas");
  await page.mouse.move(canvas.x + canvas.width - 80, canvas.y + canvas.height / 2);
  await page.mouse.wheel(Math.round(source.x - 100), 0);
  await waitForCameraIdle(page);
  await clearTarget(page, 240);
  await expect(page.getByTestId("coach-hint")).toBeFocused();
});

test("help is keyboard reachable; Do it for me completes the step without stealing typing focus", async ({ page }) => {
  await begin(page, "quick-add");
  await page.getByTestId("tutorial-skip").click();
  await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-step", "grow");
  await page.getByTestId("coach-route-keyboard").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("coach-hint")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tutorial-hint")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("tutorial-show-me")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("tutorial-skip")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-step", "name-api");
  const field = page.getByTestId("inspector-field-label");
  await field.fill("Web API");
  await expect(field).toBeFocused();
  await expect(page.getByTestId("tutorial-announce")).toContainText("Name");
  await field.press("Enter");
  await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-step", "grow-db");
});

test("stuck nudge uses the clock, resets on progress, and leaves all exits available", async ({ page }) => {
  await page.clock.install();
  await begin(page, "quick-add");
  await page.clock.runFor(40_001);
  await expect(page.getByTestId("coach-help")).toContainText("Taking a while?");
  await page.getByTestId("tutorial-skip").click();
  await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-step", "grow");
  await expect(page.getByTestId("coach-help")).toContainText("Stuck?");
  await expect(page.getByTestId("tutorial-exit")).toBeVisible();
  await expect(page.getByTestId("tutorial-skip")).toBeEnabled();
});

test("a coach-owned fixture button stays visible without chasing its own target", async ({ page }) => {
  await begin(page, "import-and-review");
  await expect(page.getByTestId("tutorial-fixture")).toBeVisible();
  await page.getByTestId("tutorial-show-me").click();
  await expectNoViolations(page, "tutorial-app");
  await expect(page.getByTestId("tutorial-target-fallback")).toHaveCount(0);
  await expect(page.getByTestId("tutorial-coach")).toHaveAttribute("data-target", "tutorial-fixture");
  const download = page.waitForEvent("download");
  await page.getByTestId("tutorial-fixture").click();
  expect((await download).suggestedFilename()).toBe("tutorial-status-compose.yaml");
  await expect(page.getByTestId("tutorial-exit")).toBeVisible();
});

test("a short grow drag leaves a visible connection when the new service is named", async ({ page }) => {
  await begin(page, "quick-add");
  await page.getByTestId("tutorial-skip").click();
  const app = await page.evaluate(() => window.__tutorial?.snapshot().subjects.app);
  if (!app) throw new Error("Missing browser");
  await page.getByTestId(`node-${app}`).click();
  await waitForSelectionSettled(page);
  const source = await page.getByTestId(`node-${app}`).boundingBox();
  const chip = await page.getByTestId(`grow-chip-${app}`).boundingBox();
  if (!source || !chip) throw new Error("Missing grow control");
  await page.keyboard.down("Alt");
  try {
    await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width + 30, source.y - 40, { steps: 12 });
    await page.mouse.up();
  } finally {
    await page.keyboard.up("Alt");
  }
  await expect(page.getByTestId("quick-add-search")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-step", "name-api");
  await page.getByTestId("inspector-field-label").fill("Web API");
  await page.getByTestId("inspector-field-label").press("Enter");
  const diagram = await page.evaluate(() => window.__tutorial?.diagram());
  const browser = diagram?.nodes.find((n) => n.id === app),
    service = diagram?.nodes.find((n) => n.label === "Web API");
  if (!browser || !service) throw new Error("Missing grown service");
  expect(service.x - browser.x - 220).toBeGreaterThanOrEqual(160);
  expect(diagram?.edges.some((e) => e.from === browser.id && e.to === service.id)).toBe(true);
});

test("dismissing a completion handoff restores a visible coach with a paused clock", async ({ page }) => {
  await page.clock.install();
  await begin(page, "annotate");
  for (const step of ["title", "note", "zone"]) {
    await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-step", step);
    await page.getByTestId("tutorial-skip").click();
  }
  await expect(page.getByTestId("tutorial-handoff")).toBeVisible();
  await pauseClock(page);
  await page.getByTestId("tutorial-handoff-dismiss").click();
  await expect(page.getByTestId("tutorial-handoff")).toHaveCount(0);
  await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-phase", "finished");
  await expect(page.getByTestId("tutorial-finished")).toBeInViewport();
  await expect(page.getByTestId("canvas-wrap")).toBeFocused();
});
