import type { Locator, Page } from "@playwright/test";
import { test, expect, waitForCameraIdle, pauseClock } from "./fixtures";
import { chunk, holdChunk, releaseAndEvaluate } from "./chunk";

const boundaryChunk = chunk("boundaryPlacement", "src/editor/boundaryPlacement.ts");
async function begin(page: Page, id = "lab-tutorial-recovery") {
  await page.goto(`./?tutorial=${id}`);
  await page.getByTestId("tutorial-start").click();
  await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-phase", "step");
  await waitForCameraIdle(page);
}
async function box(locator: Locator) {
  const r = await locator.boundingBox();
  if (!r) throw new Error("Expected a visible box");
  return r;
}
async function reachable(locator: Locator) {
  await expect(locator).toBeInViewport();
  await expect(locator).toBeVisible();
  expect(
    await locator.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit === el || (hit !== null && el.contains(hit));
    }),
  ).toBe(true);
}

test("finish reads the recap before the next lesson, without a duplicate announcement", async ({ page }) => {
  await begin(page, "annotate");
  for (const step of ["title", "note", "zone"]) {
    await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-step", step);
    await page.getByTestId("tutorial-skip").click();
  }
  await expect(page.getByTestId("tutorial-handoff-heading")).toBeFocused();
  const recap = page.getByTestId("tutorial-handoff-recap");
  await expect(recap).toHaveText(/Annotations/);
  expect(
    await recap.evaluate(
      (el) =>
        !!(
          el.compareDocumentPosition(document.querySelector('[data-testid="tutorial-handoff-next"]') ?? el) &
          Node.DOCUMENT_POSITION_FOLLOWING
        ),
    ),
  ).toBe(true);
  const text = (await recap.textContent()) ?? "";
  await expect(page.getByTestId("tutorial-announce")).not.toContainText(text);
  await expect(page.getByTestId("tutorial-finished")).not.toContainText(text);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("canvas-wrap")).toBeFocused();
});

test("async boundary failure offers focused Retry and keeps learner edits", async ({ page }) => {
  const held = await holdChunk(page, boundaryChunk);
  held.fail = true;
  await begin(page);
  await page.getByTestId("tutorial-skip").click();
  await expect(page.getByTestId("tutorial-recovery")).toBeVisible();
  await expect(page.getByTestId("tutorial-retry")).toBeFocused();
  await page.getByTestId("node-c").dblclick();
  await page.getByTestId("inspector-field-label").fill("My practice service");
  await page.getByTestId("inspector-field-label").press("Enter");
  held.fail = false;
  held.release();
  await page.getByTestId("tutorial-retry").click();
  await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-step", "done");
  await expect(page.getByTestId("node-c").getByTestId("card-title")).toHaveText("My practice service");
  await page.getByTestId("tutorial-skip").click();
  await expect(page.getByTestId("tutorial-handoff")).toBeVisible();
});

test("Restart cancels a boundary move while its chunk is delayed", async ({ page }) => {
  const held = await holdChunk(page, boundaryChunk);
  try {
    await begin(page);
    await page.getByTestId("tutorial-skip").click();
    await expect.poll(held.requested).toBe(true);
    await page.getByTestId("tutorial-restart").click();
    await releaseAndEvaluate(page, boundaryChunk, held.release);
    await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-step", "move");
    await expect(page.getByTestId("tutorial-recovery")).toHaveCount(0);
    await page.getByTestId("tutorial-skip").click();
    await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-step", "done");
  } finally {
    held.release();
  }
});

test("RTL tips choose a visible field, then its disclosure, and stay within the pane", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("diagrams.locale", "ar"));
  await begin(page);
  await page.getByTestId("node-c").click({ position: { x: 20, y: 35 } });
  await waitForCameraIdle(page);
  const coach = page.getByTestId("tutorial-coach");
  await page.getByTestId("inspector-section-node-simulation").scrollIntoViewIfNeeded();
  await expect(coach).toHaveAttribute("data-target", "inspector-section-node-simulation");
  await page.getByTestId("inspector-section-node-simulation").click();
  await page.getByTestId("inspector-field-replicas").scrollIntoViewIfNeeded();
  await expect(coach).toHaveAttribute("data-target", "inspector-field-replicas");
  const tip = page.getByTestId("tutorial-tip");
  await expect(tip).toBeVisible();
  const r = await box(tip),
    pane = await box(page.getByTestId("inspector-body"));
  expect(r.x).toBeGreaterThanOrEqual(pane.x);
  expect(r.x + r.width).toBeLessThanOrEqual(pane.x + pane.width);
  expect(r.y).toBeGreaterThanOrEqual(pane.y);
  expect(r.y + r.height).toBeLessThanOrEqual(pane.y + pane.height);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 600, height: 390 },
]) {
  test(`phone instructions, Done and Exit remain reachable (${viewport.width}×${viewport.height})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("diagrams.locale", "en-XA"));
    await begin(page);
    await page.getByTestId("tutorial-show-me").click();
    await waitForCameraIdle(page);
    await page.getByTestId("node-c").click({ position: { x: 20, y: 35 } });
    for (const snap of ["peek", "half", "full"]) {
      await page.getByTestId(`dock-snap-${snap}`).click();
      await reachable(page.getByTestId("tutorial-exit"));
      await reachable(page.getByTestId("tutorial-skip"));
      await expect(page.getByTestId("tutorial-goal")).toBeInViewport();
    }
    await page.getByTestId("dock-snap-peek").click();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "24px";
    });
    await reachable(page.getByTestId("tutorial-exit"));
    await page.getByTestId("tutorial-skip").click();
    await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-step", "done");
    await reachable(page.getByTestId("tutorial-skip"));
    await page.getByTestId("tutorial-skip").click();
    await expect(page.getByTestId("tutorial-handoff")).toBeVisible();
  });
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 600, height: 390 },
])
  test(`phone expanded Read note keeps instruction, Done and Exit available (${viewport.width}×${viewport.height})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.clock.install();
    await begin(page, "lab-tutorial-phone-note");
    await pauseClock(page);
    await page.getByTestId("live-timeline-input").fill("159");
    await page.getByTestId("live-timeline-input").press("ArrowRight");
    await page.getByTestId("live-note-expand").click();
    await expect(page.getByTestId("live-note")).toHaveAttribute("data-expanded", "1");
    await reachable(page.getByTestId("tutorial-exit"));
    await reachable(page.getByTestId("tutorial-skip"));
    await expect(page.getByTestId("tutorial-goal")).toBeInViewport();
    await page.getByTestId("live-note-close").click();
    await page.getByTestId("tutorial-exit").click();
    await expect(page.getByTestId("tutorials-view")).toBeVisible();
  });
