import type { Page } from "@playwright/test";
import { test, expect, expectNoErrors, gotoCanvas, pageLoadTimeout } from "./fixtures";
import { tutorialIds } from "../../src/tutorials/catalog/ids";
import type { ResolvedUiStep } from "../../src/tutorials/solution";

// Tutorials (src/tutorials): one generated test per tutorial plays its solution path through the real UI, step by
// step, and waits on the runner's state (the strip's data-step) to move on. Then the entry point, Skip ("do it for
// me") all the way, Undo stepping back, and the sandbox never reaching Your diagrams.

async function openTutorial(page: Page, id: string) {
  await page.goto(`./?tutorial=${id}`);
  await expect(page.getByTestId("tutorial-start")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
}

async function play(page: Page, step: ResolvedUiStep) {
  if ("click" in step) await page.getByTestId(step.click).click();
  else if ("dblclick" in step) await page.getByTestId(step.dblclick).dblclick();
  else if ("hover" in step) await page.getByTestId(step.hover).hover();
  else if ("fill" in step) await page.getByTestId(step.fill).fill(step.text);
  else if ("drag" in step) await page.getByTestId(step.drag).dragTo(page.getByTestId(step.to));
  else await page.keyboard.press(step.press);
}

const strip = (page: Page) => page.getByTestId("tutorial-step");

/** Nothing a tutorial does is stored as a diagram: no library entry, no autosave for its sandbox. */
async function expectNothingSaved(page: Page) {
  const keys = await page.evaluate(() => Object.keys(localStorage));
  const stored = keys.filter((k) => /^diagrams\.(autosave|doc|library-entry|library)\./.test(k));
  const library = await page.evaluate(() => localStorage.getItem("diagrams.library.v1"));
  expect(
    stored.filter((k) => k !== "diagrams.library.v1"),
    "a tutorial stored a diagram",
  ).toEqual([]);
  if (library) expect(JSON.parse(library).entries).toEqual([]);
}

for (const id of tutorialIds)
  test(`${id}: its solution plays through the real UI`, async ({ page, consoleErrors }) => {
    test.slow(); // Live has to carry real traffic for the last step.
    await openTutorial(page, id);
    await page.getByTestId("tutorial-start").click();
    await expect(strip(page)).toHaveAttribute("data-phase", "step");
    const seen: string[] = [];
    while ((await strip(page).getAttribute("data-phase")) === "step") {
      const current = (await strip(page).getAttribute("data-step")) ?? "";
      expect(seen, `step ${current} came back`).not.toContain(current);
      seen.push(current);
      const steps = await page.evaluate(() => window.__tutorial?.solution() ?? []);
      for (const step of steps) await play(page, step);
      // A moment (traffic seen) waits on the simulation itself.
      await expect(strip(page)).not.toHaveAttribute("data-step", current, { timeout: 20_000 });
    }
    await expect(strip(page)).toHaveAttribute("data-phase", "finished");
    await expect(page.getByTestId("tutorial-progress")).toBeVisible();
    await expectNothingSaved(page);
    expectNoErrors(consoleErrors);
  });

test("Tutorials is a view of its own: a card starts the tutorial, Enter starts it, Exit comes back", async ({
  page,
}) => {
  await gotoCanvas(page, "retry-storm");
  // The Examples dialog links to it.
  await page.getByTestId("example-picker").click();
  await page.getByTestId("picker-browse-examples").click();
  await page.getByTestId("examples-open-tutorials").click();
  await expect(page.getByTestId("tutorials-view")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(page.getByTestId("view-tutorials")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("tutorials-track-basics")).toContainText("A mobile app talks to an API");
  await page.getByTestId("tutorial-open-mobile-api").click();
  await expect(page.getByTestId("tutorial-app")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(page.getByTestId("topbar")).toHaveCount(0);
  // The intro is one focused card: its Start has the keyboard, so Enter starts.
  await expect(page.getByTestId("tutorial-start")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tutorial-intro")).toHaveCount(0);
  await expect(strip(page)).toHaveAttribute("data-step", "add-app");
  await page.getByTestId("tutorial-exit").click();
  await expect(page.getByTestId("tutorials-view")).toBeVisible();
  // Progress shows on its card: it was left at step 1, so it starts (step 1 isn't "continue").
  await expect(page.getByTestId("tutorial-open-mobile-api")).toHaveText("Start");
  // Back to the diagram it all started from.
  await page.getByTestId("view-canvas").click();
  await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", "retry-storm");
});

test("Ctrl+K opens Tutorials, and works inside a tutorial", async ({ page }) => {
  await gotoCanvas(page, "retry-storm");
  await page.getByTestId("canvas-wrap").focus();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("command-input").fill("tutorials");
  await page.getByTestId("command-item-view:tutorials").click();
  await expect(page.getByTestId("tutorials-view")).toBeVisible({ timeout: pageLoadTimeout() });
  await page.getByTestId("tutorial-open-mobile-api").click();
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("canvas-wrap").focus();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("command-input")).toBeVisible({ timeout: pageLoadTimeout() });
});

test("quick-add opens already searched for the step's pick, and the name step waits for the name to be finished", async ({
  page,
}) => {
  await openTutorial(page, "mobile-api");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-step", "add-api");
  await page.getByTestId("node-mobile-1").click();
  await page.getByTestId("grow-chip-mobile-1").click();
  await expect(page.getByTestId("quick-add-search")).toHaveValue("service");
  // Highlighted at once, no hover: it's the first match and the coach mark rings it.
  await expect(page.getByTestId("tutorial-coach")).toHaveAttribute(
    "data-target",
    "context-menu-item-quick-add:generic.service",
  );
  await page.keyboard.press("Enter");
  // The + also connected it, so the name is next; its field already has the keyboard (quick-add's own rule).
  await expect(strip(page)).toHaveAttribute("data-step", "name-api");
  await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  await page.keyboard.type("Orders API");
  // The name matches, but it's still being typed: completing, and nothing moves the keyboard.
  await expect(strip(page)).toHaveAttribute("data-state", "completing");
  await expect(page.getByTestId("tutorial-coach")).toHaveCount(0);
  await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(strip(page)).toHaveAttribute("data-step", "go-live");
  // The canvas's own first-time tips stay quiet in a tutorial.
  await expect(page.getByTestId("first-run-hint")).toHaveCount(0);
  await expect(page.getByTestId("toast-make-message")).toHaveCount(0);
  await expect(page.getByTestId("reset-diagram")).toHaveCount(0);
});

test("a near-miss name says what's expected and fixes it in one click", async ({ page }) => {
  await openTutorial(page, "mobile-api");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-step", "add-api");
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-step", "name-api");
  // The service the demo added is the one the Inspector shows.
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-inspector-target", "service-1");
  await page.getByTestId("inspector-field-label").fill("Order API");
  // Still typing: no verdict yet.
  await expect(page.getByTestId("tutorial-near-miss")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tutorial-near-miss")).toContainText("Orders API");
  await expect(page.getByTestId("tutorial-near-miss")).toContainText("Order API");
  await expect(strip(page)).toHaveAttribute("data-step", "name-api");
  await page.getByTestId("tutorial-use-expected").click();
  await expect(strip(page)).toHaveAttribute("data-step", "go-live");
  await expect(page.getByTestId("node-service-1")).toContainText("Orders API");
});

test("Skip does every step for you, and the tutorial remembers it was completed", async ({ page }) => {
  await openTutorial(page, "mobile-api");
  await page.getByTestId("tutorial-start").click();
  while ((await strip(page).getAttribute("data-phase")) === "step") {
    const current = (await strip(page).getAttribute("data-step")) ?? "";
    await page.getByTestId("tutorial-skip").click();
    await expect(strip(page)).not.toHaveAttribute("data-step", current);
  }
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  await expect(page.getByTestId("node-service-1")).toContainText("Orders API");
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem("diagrams.tutorials.v1") ?? "{}"));
  expect(progress.progress["mobile-api"]).toMatchObject({ completed: true, version: 1 });
  await expectNothingSaved(page);
  // Restart puts the practice diagram back as it started.
  await page.getByTestId("tutorial-restart").click();
  await expect(strip(page)).toHaveAttribute("data-step", "add-app");
  await expect(page.getByTestId("node-mobile-1")).toHaveCount(0);
});

test("Undo goes back a step; Show me reveals the hint and highlights still point the way", async ({ page }) => {
  await openTutorial(page, "mobile-api");
  await page.getByTestId("tutorial-start").click();
  await expect(page.getByTestId("tutorial-coach")).toHaveAttribute("data-target", "palette-search");
  await page.getByTestId("palette-search").fill("mobile");
  await expect(page.getByTestId("tutorial-coach")).toHaveAttribute("data-target", "palette-item-client.mobile");
  await page.getByTestId("palette-item-client.mobile").click();
  await expect(strip(page)).toHaveAttribute("data-step", "add-api");
  await expect(page.getByTestId("tutorial-done")).toBeVisible();
  await page.getByTestId("tutorial-show-me").click();
  await expect(page.getByTestId("tutorial-hint")).toBeVisible();
  await page.getByTestId("undo-button").click();
  await expect(strip(page)).toHaveAttribute("data-step", "add-app");
  // Highlights off: no coach mark, the words stay.
  await page.getByTestId("tutorial-highlights").uncheck();
  await expect(page.getByTestId("tutorial-coach")).toHaveCount(0);
  await expect(page.getByTestId("tutorial-goal")).toBeVisible();
});

test("an unknown tutorial says so and offers the way out", async ({ page }) => {
  await page.goto("./?tutorial=nope");
  await expect(strip(page)).toHaveAttribute("data-phase", "unknown", { timeout: pageLoadTimeout() });
  await page.getByTestId("tutorial-exit").click();
  await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
});
