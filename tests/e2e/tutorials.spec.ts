import { deflateRawSync } from "node:zlib";
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  expectNoErrors,
  gotoCanvas,
  pageLoadTimeout,
  fitDiagram,
  pauseClock,
  waitForCameraIdle,
  waitForSelectionSettled,
  emptyCanvasPoint,
  savedDiagram,
} from "./fixtures";
import { tutorialEntries } from "../../src/tutorials/catalog/ids";
import type { ResolvedUiStep } from "../../src/tutorials/solution";
import { expectNoViolations } from "./a11y-helpers";

// Tutorials (src/tutorials): one generated test per tutorial plays its solution path through the real UI, step by
// step, and waits on the runner's state (the strip's data-step) to move on. Then the entry point, Skip ("do it for
// me") all the way, Undo stepping back, and the sandbox never reaching Your diagrams.

async function openTutorial(page: Page, id: string) {
  await page.goto(`./?tutorial=${id}`);
  await expect(page.getByTestId("tutorial-start")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
}

async function play(page: Page, step: ResolvedUiStep) {
  if ("click" in step) {
    if (step.click === "canvas-pane")
      await page.getByTestId("canvas-wrap").click({ position: await emptyCanvasPoint(page) });
    else if (step.click.startsWith("edge-") && !step.click.startsWith("edge-label-")) {
      await waitForCameraIdle(page);
      // A bent line's group bounds can have empty canvas at their centre. Hit its visible path instead.
      const point = await page.getByTestId(step.click).evaluate((group) => {
        const path = Array.from(group.children).find(
          (child): child is SVGPathElement => child instanceof SVGPathElement,
        );
        const matrix = path?.getScreenCTM();
        if (!path || !matrix) throw new Error("Expected a rendered edge path");
        const p = path.getPointAtLength(path.getTotalLength() / 2);
        const screen = new DOMPoint(p.x, p.y).matrixTransform(matrix);
        return { x: screen.x, y: screen.y };
      });
      await page.mouse.click(point.x, point.y);
    } else await page.getByTestId(step.click).click();
  } else if ("modClick" in step) {
    await fitDiagram(page);
    await waitForCameraIdle(page);
    await page.getByTestId(step.modClick).click({ modifiers: [...step.modifiers] });
  } else if ("rightclick" in step) {
    if (step.rightclick.startsWith("edge-label-")) await page.getByTestId(step.rightclick).click({ button: "right" });
    else {
      await fitDiagram(page);
      await waitForCameraIdle(page);
      if (step.rightclick === "canvas-pane")
        await page.getByTestId("canvas-wrap").click({ button: "right", position: await emptyCanvasPoint(page) });
      else {
        const box = await page.getByTestId(step.rightclick).boundingBox();
        if (!box) throw new Error("A context menu target is missing");
        // A multi-selection's frame intentionally owns the pointer above its selected nodes.
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
      }
    }
  } else if ("boxSelect" in step) {
    await fitDiagram(page);
    await waitForCameraIdle(page);
    await expect(page.getByTestId(step.boxSelect)).toBeVisible();
    const boxes = await Promise.all(step.around.map((id) => page.getByTestId(id).boundingBox()));
    expect(boxes.every(Boolean)).toBe(true);
    const bounds = boxes.map((b) => {
      if (!b) throw new Error("A box selection target is missing");
      return b;
    });
    const left = Math.min(...bounds.map((b) => b.x)) - 12;
    const top = Math.min(...bounds.map((b) => b.y)) - 12;
    const right = Math.max(...bounds.map((b) => b.x + b.width)) + 12;
    const bottom = Math.max(...bounds.map((b) => b.y + b.height)) + 12;
    await page.mouse.move(left, top);
    await page.mouse.down();
    await page.mouse.move(right, bottom, { steps: 16 });
    await page.mouse.up();
  } else if ("select" in step) await page.getByTestId(step.select).selectOption(step.value);
  else if ("pane" in step) {
    const position = await emptyCanvasPoint(page);
    await page.getByTestId("canvas-wrap").dblclick({ position });
  } else if ("dblclick" in step) await page.getByTestId(step.dblclick).dblclick();
  else if ("hover" in step) await page.getByTestId(step.hover).hover();
  else if ("fill" in step) {
    if (step.fill === "inspector-field-label") {
      // Quick-add can render the new field before its queued reveal and naming focus arrive. Filling it early
      // lets that later focus reopen naming after Enter, leaving the runner in completing (CI: add-users).
      await waitForCameraIdle(page);
      await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-interaction-state", "idle");
      await expect(page.getByTestId(step.fill)).toBeFocused();
    }
    await page.getByTestId(step.fill).fill(step.text);
  } else if ("into" in step) {
    // Typed at the caret the solution's clicks and keys put there: appended, never replacing the field.
    await expect(page.getByTestId(step.into)).toBeFocused();
    await page.keyboard.insertText(step.type);
  } else if ("type" in step) await page.keyboard.insertText(step.type);
  else if ("drag" in step) {
    // Seed diagrams start with nothing selected, so their Inspector should stay collapsed.
    if (await page.evaluate(() => !!window.__tutorial?.snapshot().selected.length)) await waitForSelectionSettled(page);
    await fitDiagram(page);
    await waitForCameraIdle(page);
    if (step.to.startsWith("group-")) {
      const from = await page.getByTestId(step.drag).boundingBox();
      const to = await page.getByTestId(step.to).boundingBox();
      if (!from || !to) throw new Error("A boundary drop target is missing");
      // Boundary bodies let the pane receive the drop; membership is decided from the node's centre.
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 16 });
      await page.mouse.up();
    } else await page.getByTestId(step.drag).dragTo(page.getByTestId(step.to));
  } else await page.keyboard.press(step.press);
}

const quarantineReason = "quarantined: see docs/backlog/2026-10-24-tutorials-quarantine.md";

const strip = (page: Page) => page.getByTestId("tutorial-step");

async function finishSolution(page: Page, highlightsOff = false) {
  const seen: string[] = [];
  while ((await strip(page).getAttribute("data-phase")) === "step") {
    const current = (await strip(page).getAttribute("data-step")) ?? "";
    expect(seen, `step ${current} came back`).not.toContain(current);
    seen.push(current);
    if (highlightsOff) await expect(page.getByTestId("tutorial-coach")).toHaveCount(0);
    const steps = await page.evaluate(() => window.__tutorial?.solution() ?? []);
    for (const step of steps) await play(page, step);
    await expect(strip(page)).not.toHaveAttribute("data-step", current, { timeout: 20_000 });
  }
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  return seen;
}

async function skipAll(page: Page) {
  while ((await strip(page).getAttribute("data-phase")) === "step") {
    const current = (await strip(page).getAttribute("data-step")) ?? "";
    await page.getByTestId("tutorial-skip").click();
    await expect(strip(page)).not.toHaveAttribute("data-step", current);
  }
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
}

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

async function savedEntries(page: Page): Promise<{ slug: string; title: string }[]> {
  return page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith("diagrams.library-entry.v1:"))
      .map((k) => JSON.parse(localStorage.getItem(k) ?? "{}")),
  );
}

for (const entry of ["Skip Save", "Continue at Run"] as const)
  test(`author-a-drill: ${entry} then manual Run plays the saved Drill`, async ({ page, consoleErrors }) => {
    if (entry === "Continue at Run")
      await page.addInitScript(() =>
        localStorage.setItem(
          "diagrams.tutorials.v1",
          JSON.stringify({ progress: { "author-a-drill": { version: 1, step: 3, completed: false } } }),
        ),
      );
    await openTutorial(page, "author-a-drill");
    await page.getByTestId("tutorial-start").click();
    if (entry === "Skip Save") {
      for (const current of ["live", "open"]) {
        await expect(strip(page)).toHaveAttribute("data-step", current);
        const solution = await page.evaluate(() => window.__tutorial?.solution() ?? []);
        for (const action of solution) await play(page, action);
        await expect(strip(page)).not.toHaveAttribute("data-step", current);
      }
      await expect(strip(page)).toHaveAttribute("data-step", "save");
      // The panel still holds Practice traffic's local draft after Skip saves a separate Drill.
      await page.getByTestId("tutorial-skip").click();
    }
    await expect(strip(page)).toHaveAttribute("data-step", "run");
    const solution = await page.evaluate(() => window.__tutorial?.solution() ?? []);
    for (const action of solution) await play(page, action);
    await expect(strip(page)).toHaveAttribute("data-phase", "finished");
    await expect(page.getByTestId("live-sim-picker")).toHaveValue("simulation");
    await expectNothingSaved(page);
    expectNoErrors(consoleErrors);
  });

for (const finish of ["menu", "Skip"] as const)
  test(`faults: Restore completes with an additional slowdown (${finish})`, async ({ page, consoleErrors }) => {
    await openTutorial(page, "faults");
    await page.getByTestId("tutorial-start").click();
    const live = await page.evaluate(() => window.__tutorial?.solution() ?? []);
    for (const action of live) await play(page, action);
    await expect(strip(page)).toHaveAttribute("data-step", "down");
    const api = await page.evaluate(() => window.__tutorial?.snapshot().subjects.api);
    expect(api).toBeTruthy();
    await play(page, { rightclick: "node-" + api });
    await page.getByTestId("context-menu-item-sim.fault").click();
    await page.getByTestId("context-menu-item-sim.slow").click();
    await page.getByTestId("context-menu-item-sim.slow:5").click();
    await expect(page.getByTestId("node-fault-" + api)).toContainText("5");
    const down = await page.evaluate(() => window.__tutorial?.solution() ?? []);
    for (const action of down) await play(page, action);
    await expect(strip(page)).toHaveAttribute("data-step", "restore");
    if (finish === "Skip") await page.getByTestId("tutorial-skip").click();
    else {
      const restore = await page.evaluate(() => window.__tutorial?.solution() ?? []);
      for (const action of restore) await play(page, action);
    }
    await expect(strip(page)).toHaveAttribute("data-phase", "finished");
    await expect(page.getByTestId("node-fault-" + api)).toContainText("5");
    expectNoErrors(consoleErrors);
  });

test("dependencies-2: hidden Dependencies can be shown before adding a setting", async ({ page }) => {
  test.fixme(!!tutorialEntries.find((t) => t.id === "dependencies-2")?.quarantined, quarantineReason);
  await page.addInitScript(() => localStorage.setItem("diagrams.showDependencies.v1", "0"));
  await openTutorial(page, "dependencies-2");
  await page.getByTestId("tutorial-start").click();
  await expect(strip(page)).toHaveAttribute("data-step", "show-dependencies");
  const solution = await page.evaluate(() => window.__tutorial?.solution() ?? []);
  for (const action of solution) await play(page, action);
  await expect(strip(page)).toHaveAttribute("data-step", "add-setting");
  const edge = await page.evaluate(() => window.__tutorial?.snapshot().edges["api->config"]);
  await expect(page.getByTestId("edge-label-" + edge)).toBeVisible();
});

test("dependencies-2: the lock target follows the setting inserted before existing rows", async ({ page }) => {
  test.fixme(!!tutorialEntries.find((t) => t.id === "dependencies-2")?.quarantined, quarantineReason);
  await openTutorial(page, "dependencies-2");
  await page.getByTestId("tutorial-start").click();
  await expect(strip(page)).toHaveAttribute("data-step", "add-setting");
  const edge = await page.evaluate(() => window.__tutorial?.snapshot().edges["api->config"]);
  await page.getByTestId("edge-label-" + edge).click();
  const field = page.getByTestId("inspector-field-settings");
  const original = await field.inputValue();
  await field.fill("Notifications:Token\n" + original);
  await expect(strip(page)).toHaveAttribute("data-step", "mark-secret");
  await expect(page.getByTestId("inspector-setting-lock-0")).toHaveAttribute("aria-pressed", "false");
  const solution = await page.evaluate(() => window.__tutorial?.solution() ?? []);
  for (const action of solution) await play(page, action);
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  await expect(page.getByTestId("inspector-setting-lock-0")).toHaveAttribute("aria-pressed", "true");
  await expect(field).toHaveValue("!Notifications:Token\n" + original);
});

test("partitions: Start preserves the idle-consumer lesson", async ({ page }) => {
  await openTutorial(page, "partitions");
  await expect
    .poll(async () => Number(await page.getByTestId("live-canvas").getAttribute("data-sim-time")))
    .toBeGreaterThan(0);
  await page.getByTestId("tutorial-start").click();
  await expect(strip(page)).toHaveAttribute("data-step", "read-idle");
  const consumers = await page.evaluate(() => window.__tutorial?.snapshot().subjects.consumers);
  await page.getByTestId("node-" + consumers).hover();
  await expect(strip(page)).toHaveAttribute("data-step", "read-idle");
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-step", "six-partitions");
});

test("outbox: happy-path waits for narration Continue", async ({ page }) => {
  await openTutorial(page, "outbox");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-step", "run-happy-path");
  const select = await page.evaluate(() => window.__tutorial?.solution() ?? []);
  expect(select).toHaveLength(1);
  await play(page, select[0]);
  await expect(page.getByTestId("live-note-continue")).toBeVisible();
  await expect(strip(page)).toHaveAttribute("data-step", "read-happy-path");
  const read = await page.evaluate(() => window.__tutorial?.solution() ?? []);
  expect(read).toHaveLength(2);
  await play(page, read[0]);
  await expect(page.getByTestId("live-note-continue")).toHaveCount(0);
  await expect(strip(page)).toHaveAttribute("data-step", "read-happy-path");
  await play(page, read[1]);
  await expect(strip(page)).toHaveAttribute("data-step", "watch-compensation");
  await page.getByTestId("live-sim-picker").selectOption("declines");
  await expect
    .poll(async () => Number(await page.getByTestId("live-canvas").getAttribute("data-sim-time")))
    .toBeGreaterThanOrEqual(2500);
  await expect(strip(page)).toHaveAttribute("data-step", "watch-compensation");
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
});

for (const entry of ["Skip", "resume"] as const)
  test(`webhooks: ${entry} continues the paused note so watching finishes expect-parked`, async ({
    page,
    consoleErrors,
  }) => {
    test.slow(); // The saved run reaches its narration and expectation through normal playback.
    if (entry === "resume")
      await page.addInitScript(() =>
        localStorage.setItem(
          "diagrams.tutorials.v1",
          JSON.stringify({ progress: { webhooks: { version: 1, step: 2, completed: false } } }),
        ),
      );
    await openTutorial(page, "webhooks");
    await page.getByTestId("tutorial-start").click();
    if (entry === "Skip") {
      await page.getByTestId("tutorial-skip").click();
      await expect(strip(page)).toHaveAttribute("data-step", "continue-note");
      await expect(page.getByTestId("live-note-continue")).toBeVisible({ timeout: 20_000 });
      await expect(strip(page)).toHaveAttribute("data-step", "continue-note");
      await page.getByTestId("tutorial-skip").click();
    }
    await expect(strip(page)).toHaveAttribute("data-step", "expect-parked", { timeout: 20_000 });
    await expect(page.getByTestId("live-note-continue")).toHaveCount(0);
    await expect
      .poll(async () => Number(await page.getByTestId("live-canvas").getAttribute("data-sim-time")))
      .toBeGreaterThanOrEqual(6500);
    // No Skip or Continue here: the learner only watches the saved expectation resolve.
    await expect(strip(page)).toHaveAttribute("data-phase", "finished", { timeout: 20_000 });
    await expectNothingSaved(page);
    expectNoErrors(consoleErrors);
  });

for (const entry of ["Skip", "Continue"] as const)
  test(`threads-block: ${entry} past the edit keeps Live ready for the rerun`, async ({ page, consoleErrors }) => {
    if (entry === "Continue")
      await page.addInitScript(() =>
        localStorage.setItem(
          "diagrams.tutorials.v1",
          JSON.stringify({
            progress: { "threads-block": { version: 2, step: 3, completed: false } },
          }),
        ),
      );
    await openTutorial(page, "threads-block");
    await page.getByTestId("tutorial-start").click();
    if (entry === "Skip") {
      for (const id of ["run-blocking", "threads-waiting", "free-thread"]) {
        await expect(strip(page)).toHaveAttribute("data-step", id);
        await page.getByTestId("tutorial-skip").click();
      }
    }
    await expect(strip(page)).toHaveAttribute("data-step", "run-free-thread");
    const solution = await page.evaluate(() => window.__tutorial?.solution() ?? []);
    expect(solution).toEqual([{ select: "live-sim-picker", value: "free-thread" }]);
    for (const action of solution) await play(page, action);
    await expect(page.getByTestId("live-sim-picker")).toHaveValue("free-thread");
    await expect(strip(page)).toHaveAttribute("data-step", "no-threads-waiting");
    await finishSolution(page);
    expectNoErrors(consoleErrors);
  });

test("threads-block: watch steps wait for their readout even after the run has met its metrics", async ({ page }) => {
  test.slow();
  await openTutorial(page, "threads-block");
  await page.getByTestId("tutorial-start").click();
  for (const action of await page.evaluate(() => window.__tutorial?.solution() ?? [])) await play(page, action);
  await page.getByTestId("tutorial-step").hover();
  await expect
    .poll(async () => Number(await page.getByTestId("live-canvas").getAttribute("data-sim-time")))
    .toBeGreaterThanOrEqual(2000);
  await expect(strip(page)).toHaveAttribute("data-step", "threads-waiting");
  await page.getByTestId("node-caller").hover();
  await expect(strip(page)).toHaveAttribute("data-step", "free-thread");
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-step", "run-free-thread");
  for (const action of await page.evaluate(() => window.__tutorial?.solution() ?? [])) await play(page, action);
  await page.getByTestId("tutorial-step").hover();
  await expect
    .poll(async () => Number(await page.getByTestId("live-canvas").getAttribute("data-sim-time")))
    .toBeGreaterThanOrEqual(2000);
  await expect(strip(page)).toHaveAttribute("data-step", "no-threads-waiting");
  await page.getByTestId("node-caller").hover();
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
});

test("where-time-goes: Latency can be expanded and read before Done finishes", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "diagrams.tutorials.v1",
      JSON.stringify({
        progress: { "where-time-goes": { version: 2, step: 3, completed: false } },
      }),
    ),
  );
  await openTutorial(page, "where-time-goes");
  await page.getByTestId("tutorial-start").click();
  await expect(strip(page)).toHaveAttribute("data-step", "read-breakdown");
  const solution = await page.evaluate(() => window.__tutorial?.solution() ?? []);
  for (const action of solution.slice(0, -1)) await play(page, action);
  await expect(page.getByTestId("hover-section-latency")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("node-latency-breakdown-billing")).toBeVisible();
  await expect(strip(page)).toHaveAttribute("data-step", "read-breakdown");
  await play(page, solution[solution.length - 1]);
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
});

for (const { id, quarantined } of tutorialEntries)
  test(`${id}: its solution plays through the real UI`, async ({ page, consoleErrors }) => {
    test.fixme(!!quarantined, quarantineReason);
    test.slow(); // Live has to carry real traffic for the last step.
    await openTutorial(page, id);
    await page.getByTestId("tutorial-start").click();
    await expect(strip(page)).toHaveAttribute("data-phase", "step");
    const seen = await finishSolution(page);
    if (id === "partitions") expect(seen).toEqual(["read-idle", "six-partitions", "rerun"]);
    if (id === "outbox")
      expect(seen).toEqual(["trace-message", "run-happy-path", "read-happy-path", "watch-compensation"]);
    if (id === "command-palette") expect(seen).toEqual(["add", "goto"]);
    if (id === "share-present") expect(seen).toEqual(["present", "leave", "share"]);
    await expect(page.getByTestId("tutorial-progress")).toBeVisible();
    await expectNothingSaved(page);
    expectNoErrors(consoleErrors);
  });

for (const { id, quarantined } of tutorialEntries)
  test(`${id}: Skip-all finishes without saving a diagram`, async ({ page, consoleErrors }) => {
    test.fixme(!!quarantined, quarantineReason);
    await openTutorial(page, id);
    await page.getByTestId("tutorial-start").click();
    await skipAll(page);
    await expectNothingSaved(page);
    expectNoErrors(consoleErrors);
  });

test("Ctrl+K adding settles on another selection and Undo reopens it", async ({ page, consoleErrors }) => {
  await openTutorial(page, "command-palette");
  await page.getByTestId("tutorial-start").click();
  const steps = await page.evaluate(() => window.__tutorial?.solution() ?? []);
  for (const step of steps) await play(page, step);
  await expect(strip(page)).toHaveAttribute("data-step", "goto");
  await page.getByTestId("canvas-wrap").focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(strip(page)).toHaveAttribute("data-step", "add");
  await expect(strip(page)).toHaveAttribute("data-state", "active");
  await page.getByTestId("canvas-wrap").focus();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  // Redo selects the restored topic, satisfying the result that Go to checks.
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  await expectNothingSaved(page);
  expectNoErrors(consoleErrors);
});

/** Plays the current step's solution up to (not including) its step `upTo`. */
async function playUntil(page: Page, upTo: number) {
  const steps = await page.evaluate(() => window.__tutorial?.solution() ?? []);
  for (const step of steps.slice(0, upTo)) await play(page, step);
}

test("annotate keeps each instruction current until the annotation's editor closes", async ({
  page,
  consoleErrors,
}) => {
  await openTutorial(page, "annotate");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("palette-annotate-text").click();
  await expect(page.getByTestId("annotation-editor")).toBeFocused();
  await expect(strip(page)).toHaveAttribute("data-step", "title");
  await expect(strip(page)).toHaveAttribute("data-state", "completing");
  await page.getByTestId("annotation-editor").fill("Checkout overview");
  await expect(strip(page)).toHaveAttribute("data-step", "title");
  await page.keyboard.press("Escape");
  await expect(strip(page)).toHaveAttribute("data-step", "note");
  // Skip with the note's editor open commits it and moves on once, without another note.
  await page.getByTestId("palette-annotate-note").click();
  await expect(page.getByTestId("annotation-editor")).toBeFocused();
  await expect(strip(page)).toHaveAttribute("data-state", "completing");
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-step", "zone");
  await expect(page.getByTestId("annotation-editor")).toHaveCount(0);
  await expect(page.locator('[data-testid^="annotation-"][data-kind="note"]')).toHaveCount(1);
  expectNoErrors(consoleErrors);
});

for (const finish of ["Align middles", "Skip"] as const)
  test(`arrange: Show me keeps the box selection, then ${finish} finishes Align middles`, async ({
    page,
    consoleErrors,
  }) => {
    test.fixme(true, quarantineReason);
    await openTutorial(page, "arrange");
    await page.getByTestId("tutorial-start").click();
    await playUntil(page, 1);
    await expect(strip(page)).toHaveAttribute("data-step", "align");
    const selected = () => page.evaluate(() => window.__tutorial?.snapshot().selected.length);
    expect(await selected()).toBe(5);
    await page.getByTestId("tutorial-show-me").click();
    await expect(strip(page)).toHaveAttribute("data-state", "hinting");
    await waitForCameraIdle(page);
    expect(await selected()).toBe(5);
    if (finish === "Skip") await page.getByTestId("tutorial-skip").click();
    else await playUntil(page, 3);
    await expect(strip(page)).toHaveAttribute("data-step", "tidy");
    expectNoErrors(consoleErrors);
  });

test("arrange: Skip recovers after selection is cleared", async ({ page, consoleErrors }) => {
  test.fixme(true, quarantineReason);
  await openTutorial(page, "arrange");
  await page.getByTestId("tutorial-start").click();
  await playUntil(page, 1);
  await expect(strip(page)).toHaveAttribute("data-step", "align");
  await waitForCameraIdle(page);
  await page.getByTestId("canvas-wrap").click({ position: await emptyCanvasPoint(page) });
  await expect.poll(() => page.evaluate(() => window.__tutorial?.snapshot().selected)).toEqual([]);
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-step", "tidy");
  await waitForCameraIdle(page);
  const tops = await page
    .getByTestId(/^node-seed-/)
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().y));
  expect(tops).toHaveLength(5);
  expect(new Set(tops).size).toBe(1);
  expectNoErrors(consoleErrors);
});

test("insert-on-edge: Skip inserts a separately added gateway without a duplicate", async ({ page, consoleErrors }) => {
  test.fixme(true, quarantineReason);
  await openTutorial(page, "insert-on-edge");
  await page.getByTestId("tutorial-start").click();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("command-input").fill("API Gateway");
  await page.getByTestId("command-item-stencil:aws.api-gateway").click();
  await expect.poll(() => page.evaluate(() => window.__tutorial?.snapshot().subjects.gw)).toBeTruthy();
  const gateway = await page.evaluate(() => window.__tutorial?.snapshot().subjects.gw);
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-step", "name");
  await expect(page.getByTestId(/^node-/)).toHaveCount(3);
  expect(await page.evaluate(() => window.__tutorial?.snapshot().subjects.gw)).toBe(gateway);
  await expect(page.getByTestId(/^edge-(?!label-)/)).toHaveCount(2);
  expectNoErrors(consoleErrors);
});

test("command-palette: Skip after adding the topic selects Service 1 without a second topic", async ({
  page,
  consoleErrors,
}) => {
  await openTutorial(page, "command-palette");
  await page.getByTestId("tutorial-start").click();
  await playUntil(page, 3);
  await expect(strip(page)).toHaveAttribute("data-state", "completing");
  const nodes = page.getByTestId(/^node-/);
  const count = await nodes.count();
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-step", "goto");
  await expect(strip(page)).toHaveAttribute("data-state", "active");
  await expect(nodes).toHaveCount(count);
  const anchor = await page.evaluate(() => window.__tutorial?.snapshot().subjects.anchor);
  await expect.poll(() => page.evaluate(() => window.__tutorial?.snapshot().selected)).toEqual([anchor]);
  expectNoErrors(consoleErrors);
});

test("share-present: Present, reload, then Continue lands on Share", async ({ page, consoleErrors }) => {
  await openTutorial(page, "share-present");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("present-toggle").click();
  await expect(strip(page)).toHaveAttribute("data-step", "leave");
  await page.reload();
  await expect(page.getByTestId("tutorial-start")).toBeVisible({ timeout: pageLoadTimeout() });
  await page.getByTestId("tutorial-start").click();
  await expect(strip(page)).toHaveAttribute("data-step", "share");
  await expect(strip(page)).toHaveAttribute("data-state", "active");
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-share").click();
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  expectNoErrors(consoleErrors);
});

test("share-present exits to the original diagram without saving, and offers Interactive HTML first", async ({
  page,
}) => {
  await gotoCanvas(page, "retry-storm");
  await page.getByTestId("view-tutorials").click();
  await page.getByTestId("tutorial-open-share-present").click();
  await page.getByTestId("tutorial-start").click();
  await finishSolution(page);
  await expect(page.getByTestId("share-chooser")).toBeVisible();
  await expect(page.getByTestId("share-option-html")).toBeFocused();
  await expectNothingSaved(page);
  await page.keyboard.press("Escape");
  await page.getByTestId("tutorial-exit").click();
  await expect(page.getByTestId("tutorials-view")).toBeVisible();
  await page.getByTestId("view-canvas").click();
  await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", "retry-storm");
  await expectNothingSaved(page);
});

test("share-present: Exit preserves existing diagram edits", async ({ page, consoleErrors }) => {
  await gotoCanvas(page, "retry-storm");
  await fitDiagram(page);
  await waitForCameraIdle(page);
  const originalNode = page.getByTestId(/^node-/).first();
  const originalTestId = await originalNode.getAttribute("data-testid");
  if (!originalTestId) throw new Error("Original node has no test id");
  await originalNode.dblclick();
  await page.getByTestId("inspector-field-label").fill("My edited service");
  await page.keyboard.press("Enter");
  await expect(originalNode).toContainText("My edited service");
  const original = await savedDiagram(page);
  const slug = await page.getByTestId("example-picker").getAttribute("data-diagram-slug");
  if (!slug) throw new Error("Original diagram has no slug");
  await page.getByTestId("view-tutorials").click();
  await page.getByTestId("tutorial-open-share-present").click();
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("node-seed-0").dblclick();
  await page.getByTestId("inspector-field-label").fill("Sandbox edit only");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("node-seed-0")).toContainText("Sandbox edit only");
  await page.getByTestId("tutorial-exit").click();
  await expect(page.getByTestId("tutorials-view")).toBeVisible();
  await page.getByTestId("view-canvas").click();
  await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", slug);
  await expect(page.getByTestId(originalTestId)).toContainText("My edited service");
  await expect(page.getByTestId(/^node-/)).toHaveCount(original.nodes.length);
  await expect(page.getByTestId("node-seed-0")).toHaveCount(0);
  expect(await savedDiagram(page)).toEqual(original);
  expectNoErrors(consoleErrors);
});

test("share-present keeps a copy only when Save as is chosen", async ({ page }) => {
  await openTutorial(page, "share-present");
  await page.getByTestId("tutorial-start").click();
  await skipAll(page);
  await expectNothingSaved(page);
  await page.keyboard.press("ControlOrMeta+Shift+s");
  await expect(page.getByTestId("tutorial-open-copy")).toBeVisible();
  expect(await savedEntries(page)).toHaveLength(1);
});

test("Tutorials view and running tutorial pass the shared axe scan", async ({ page }) => {
  await page.goto("./?view=tutorials");
  await expect(page.getByTestId("tutorials-view")).toBeVisible({ timeout: pageLoadTimeout() });
  await expectNoViolations(page);
  await openTutorial(page, "mobile-api");
  await page.getByTestId("tutorial-start").click();
  await expect(strip(page)).toHaveAttribute("data-phase", "step");
  await expectNoViolations(page);
});

test("mobile-api plays with Highlights off throughout", async ({ page }) => {
  test.slow();
  await openTutorial(page, "mobile-api");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("tutorial-highlights").uncheck();
  await finishSolution(page, true);
  await expect(page.getByTestId("tutorial-coach")).toHaveCount(0);
  await expectNothingSaved(page);
});

test("mobile-api plays in Arabic, with tips on the inline-end side", async ({ page }) => {
  test.slow();
  await gotoCanvas(page, "retry-storm");
  await page.getByTestId("view-button").click();
  await page.getByTestId("view-language").click();
  await page.getByTestId("language-option-ar").click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dir)).toBe("rtl");
  await openTutorial(page, "mobile-api");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-step", "add-api");
  // The canvas stays LTR. A target in its middle has room on the Arabic inline-end (left).
  await page.getByTestId("node-mobile-1").click();
  await expect(page.getByTestId("tutorial-coach")).toHaveAttribute("data-target", "grow-chip-mobile-1");
  await expect
    .poll(async () => {
      const tip = await page.getByTestId("tutorial-tip").boundingBox();
      const target = await page.getByTestId("grow-chip-mobile-1").boundingBox();
      return !!tip && !!target && tip.x + tip.width < target.x;
    })
    .toBe(true);
  await finishSolution(page);
  await expectNothingSaved(page);
});

test("finish offers a copy only on request, with Open returning to the saved diagram", async ({ page }) => {
  await openTutorial(page, "mobile-api");
  await page.getByTestId("tutorial-start").click();
  await skipAll(page);
  await expectNothingSaved(page);
  await page.getByTestId("tutorial-save-copy").click();
  await expect(page.getByTestId("tutorial-open-copy")).toBeVisible();
  const entries = await savedEntries(page);
  expect(entries).toHaveLength(1);
  await page.getByTestId("tutorial-open-copy").click();
  await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", entries[0].slug);
  await expect(page.getByTestId("node-service-1")).toContainText("Orders API");
});

test("empty canvas, tutorial title in Ctrl+K and shortcuts footer enter tutorials", async ({ page }) => {
  await page.goto("./?view=canvas");
  await expect(page.getByTestId("start-tutorial")).toBeVisible({ timeout: pageLoadTimeout() });
  await page.getByTestId("start-tutorial").click();
  await expect(page.getByTestId("tutorial-start")).toBeVisible();
  await page.getByTestId("tutorial-not-now").click();
  await expect(page.getByTestId("start-tutorial")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("command-input").fill("Tutorial: A mobile app");
  await page.getByTestId("command-item-tutorial:mobile-api").click();
  await expect(page.getByTestId("tutorial-start")).toBeVisible();
  await page.getByTestId("tutorial-not-now").click();
  await page.getByTestId("start-blank").click();
  await expect(page.getByTestId("start-card")).toHaveCount(0);
  await expect(page.getByTestId("palette-search")).toBeFocused();
  await page.getByTestId("canvas-wrap").focus();
  await page.keyboard.press("?");
  await page.getByTestId("shortcuts-tutorials").click();
  await expect(page.getByTestId("tutorials-view")).toBeVisible();
});

test("Lab runtime preview loads an example and its simulation, keeps app chrome and offers the next lesson", async ({
  page,
}, testInfo) => {
  await openTutorial(page, "lab-tutorial-runtime");
  await expect(page.getByTestId("topbar")).toBeVisible();
  await expect(page.getByTestId("example-picker")).toContainText("Practice with a saved simulation");
  await expect(page.getByTestId("node-payments")).toBeVisible();
  await page.getByTestId("tutorial-start").click();
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  await expectNothingSaved(page);
  await page.screenshot({ path: testInfo.outputPath("tutorial-app-chrome.png") });
  await page.getByTestId("tutorial-restart").click();
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  await expectNothingSaved(page);
  await page.getByTestId("tutorial-next").click();
  await expect(page.getByTestId("tutorial-title")).toHaveText("Try the next practice diagram");
  await page.getByTestId("tutorial-start").click();
  await skipAll(page);
  await expect(page.getByTestId("tutorial-next")).toHaveCount(0);
  await page.getByTestId("tutorial-done-exit").click();
  await expect(page.getByTestId("canvas-view")).toBeVisible();
  await expect(page.getByTestId("tutorial-app")).toHaveCount(0);
});

test("File Save as in app chrome explicitly saves the sandbox copy", async ({ page }) => {
  await openTutorial(page, "lab-tutorial-runtime");
  await page.getByTestId("tutorial-start").click();
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  await expectNothingSaved(page);
  await page.getByTestId("file-button").click();
  await page.getByTestId("export-save-as").click();
  await expect(page.getByTestId("tutorial-open-copy")).toBeVisible();
  const entries = await savedEntries(page);
  expect(entries).toHaveLength(1);
  expect(entries[0].title).toBe("Practice with a saved simulation");
  await expect(page.getByTestId("tutorial-app")).toBeVisible();
});

test("app chrome Present hides teaching chrome and returns to the same tutorial", async ({ page }) => {
  await openTutorial(page, "lab-tutorial-runtime");
  await page.getByTestId("tutorial-start").click();
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  await page.getByTestId("present-toggle").click();
  await expect(page.getByTestId("tutorial-bar")).toHaveCount(0);
  await expect(page.getByTestId("tutorial-step")).toBeHidden();
  await expect(page.getByTestId("tutorial-coach")).toHaveCount(0);
  await page.getByTestId("present-exit").click();
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  await expect(page.getByTestId("topbar")).toBeVisible();
  await expectNothingSaved(page);
});

test("app chrome save shortcuts and File Your diagrams share the sandbox's copy behavior", async ({ page }) => {
  await openTutorial(page, "lab-tutorial-runtime");
  await page.getByTestId("tutorial-start").click();
  await page.keyboard.press("ControlOrMeta+Shift+s");
  await expect(page.getByTestId("tutorial-open-copy")).toBeVisible();
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-library").click();
  // Your diagrams can still be downloading when File hands over to its dialog.
  await expect(page.getByTestId("library-dialog").or(page.getByTestId("lazy-dialog"))).toBeVisible({
    timeout: pageLoadTimeout(),
  });
  await expect(page.getByTestId("lazy-dialog")).toHaveCount(0, { timeout: pageLoadTimeout() });
  await expect(page.getByTestId("library-dialog")).toBeVisible();
  await expect(page.getByTestId("library-dialog")).toContainText("Practice with a saved simulation");
});

test("example start waits for loading and recovers from a failed download", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let attempts = 0;
  await page.route(/\/(?:assets\/retry-storm-[^/]+\.js|src\/examples\/retry-storm\.json)(?:\?.*)?$/, async (route) => {
    attempts++;
    if (attempts === 1) {
      await held;
      await route.abort();
    } else await route.continue();
  });
  await page.goto("./?tutorial=lab-tutorial-runtime");
  await expect(page.getByTestId("view-loading")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(page.getByTestId("tutorial-start")).toHaveCount(0);
  await expect.poll(() => attempts).toBe(1);
  release();
  await expect(page.getByTestId("tutorial-load-retry")).toBeVisible();
  await page.getByTestId("tutorial-load-retry").click();
  await expect(page.getByTestId("tutorial-start")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(page.getByTestId("node-payments")).toBeVisible();
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

async function skipToName(page: Page) {
  await openTutorial(page, "mobile-api");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-step", "add-api");
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-step", "name-api");
}

test("completed naming stays settled during unrelated edits, and a changed API name reopens it", async ({ page }) => {
  await skipToName(page);
  await page.getByTestId("inspector-field-label").fill("Orders API");
  await page.keyboard.press("Enter");
  await expect(strip(page)).toHaveAttribute("data-step", "go-live");
  await fitDiagram(page);
  await page.getByTestId("node-mobile-1").dblclick();
  await expect(strip(page)).toHaveAttribute("data-step", "go-live");
  await page.getByTestId("inspector-field-label").fill("Shop app");
  await expect(strip(page)).toHaveAttribute("data-step", "go-live");
  await page.keyboard.press("Enter");
  await fitDiagram(page);
  await page.getByTestId("node-service-1").dblclick();
  await expect(strip(page)).toHaveAttribute("data-step", "go-live");
  await page.keyboard.press("Tab");
  await page.getByTestId("inspector-field-sublabel").fill("HTTP endpoint");
  await expect(strip(page)).toHaveAttribute("data-step", "go-live");
  await page.getByTestId("canvas-wrap").focus();
  await page.keyboard.press("ArrowRight");
  await expect(strip(page)).toHaveAttribute("data-step", "go-live");
  await page.getByTestId("inspector-field-label").fill("Order API");
  await expect(strip(page)).toHaveAttribute("data-step", "name-api");
  await page.getByTestId("inspector-field-label").fill("Orders API");
  await expect(strip(page)).toHaveAttribute("data-state", "completing");
  await page.keyboard.press("Enter");
  await expect(strip(page)).toHaveAttribute("data-step", "go-live");
});

test("a Skip click that finishes naming cannot act on Go live", async ({ page }) => {
  await skipToName(page);
  await page.getByTestId("inspector-field-label").fill("Orders API");
  await expect(strip(page)).toHaveAttribute("data-state", "completing");
  // Keep the actual element across focus departure: a replacement is a different step's button.
  await page.getByTestId("tutorial-skip").evaluate((button: HTMLButtonElement) => {
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    button.focus();
    button.click();
    button.click();
  });
  await expect(strip(page)).toHaveAttribute("data-step", "go-live");
  await expect(page.getByTestId("live-toggle")).toHaveAttribute("aria-pressed", "false");
});

test("double-clicking Skip performs only the rendered step", async ({ page }) => {
  await openTutorial(page, "mobile-api");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("tutorial-skip").dblclick();
  await expect(strip(page)).toHaveAttribute("data-step", "add-api");
  await expect(page.getByTestId("node-mobile-1")).toBeVisible();
  await expect(page.getByTestId("node-service-1")).toHaveCount(0);
});

test("Continue reconstructs saved progress; Start over begins with an empty sandbox", async ({ page }) => {
  await skipToName(page);
  await page.getByTestId("tutorial-exit").click();
  await page.goto("./?view=tutorials");
  await expect(page.getByTestId("tutorial-open-mobile-api")).toHaveText("Continue", { timeout: pageLoadTimeout() });
  await page.getByTestId("tutorial-open-mobile-api").click();
  await expect(page.getByTestId("tutorial-start")).toContainText("Continue");
  await page.getByTestId("tutorial-start").click();
  await expect(strip(page)).toHaveAttribute("data-step", "name-api");
  await expect(page.getByTestId("node-mobile-1")).toBeVisible();
  await expect(page.getByTestId("node-service-1")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__tutorial?.snapshot().state.observed.slice(0, 3)))
    .toEqual([true, true, true]);
  await page.getByTestId("tutorial-exit").click();
  await page.getByTestId("tutorial-open-mobile-api").click();
  await page.getByTestId("tutorial-start-over").click();
  await expect(strip(page)).toHaveAttribute("data-step", "add-app");
  await expect(page.getByTestId("node-mobile-1")).toHaveCount(0);
  await expect(page.getByTestId("node-service-1")).toHaveCount(0);
});

test("property-sheet Continue restores Subtitle and Description without repeating Name", async ({ page }) => {
  for (const [index, step] of [
    [2, "subtitle"],
    [3, "description"],
  ] as const) {
    await openTutorial(page, "property-sheet");
    await page.getByTestId(index === 2 ? "tutorial-start" : "tutorial-start-over").click();
    await page.getByTestId("node-api").dblclick();
    await expect(strip(page)).toHaveAttribute("data-step", "name");
    const nameSolution = await page.evaluate(() => window.__tutorial?.solution() ?? []);
    for (const action of nameSolution) await play(page, action);
    await expect(strip(page)).toHaveAttribute("data-step", "subtitle");
    if (step === "description") {
      const subtitleSolution = await page.evaluate(() => window.__tutorial?.solution() ?? []);
      for (const action of subtitleSolution) await play(page, action);
    }
    await expect(strip(page)).toHaveAttribute("data-step", step);
    await page.getByTestId("tutorial-exit").click();
    await openTutorial(page, "property-sheet");
    await expect(page.getByTestId("tutorial-start")).toContainText("Continue");
    await page.getByTestId("tutorial-start").click();
    // No further input: replay must settle Name itself before handing over.
    await expect(strip(page)).toHaveAttribute("data-step", step);
    await expect(strip(page)).toHaveAttribute("data-state", "active");
    await expect.poll(() => page.evaluate(() => window.__tutorial?.snapshot().state.settled[1])).toBe(true);
    const progress = await page.evaluate(() => JSON.parse(localStorage.getItem("diagrams.tutorials.v1") ?? "{}"));
    expect(progress.progress["property-sheet"]).toMatchObject({ step: index, completed: false });
    await page.getByTestId("tutorial-exit").click();
  }
});

test("Show me keeps keyboard focus and announces its expanded hint", async ({ page }) => {
  await openTutorial(page, "mobile-api");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("tutorial-show-me").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tutorial-show-me")).toBeFocused();
  await expect(page.getByTestId("tutorial-show-me")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("tutorial-hint")).toBeVisible();
  await expect(page.getByTestId("tutorial-announce")).toHaveText(await page.getByTestId("tutorial-hint").innerText());
});

test("clicking Go live finishes a matching rename without restoring label focus", async ({ page }) => {
  await skipToName(page);
  await page.getByTestId("inspector-field-label").fill("Orders API");
  await expect(strip(page)).toHaveAttribute("data-state", "completing");
  await page.getByTestId("live-toggle").click();
  await expect(strip(page)).toHaveAttribute("data-step", "watch");
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-testid")))
    .not.toBe("inspector-field-label");
  await page.getByTestId("live-toggle").click();
  await expect(strip(page)).toHaveAttribute("data-step", "go-live");
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-testid")))
    .not.toBe("inspector-field-label");
  await page.getByTestId("live-toggle").click();
  await expect(strip(page)).toHaveAttribute("data-step", "watch");
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-testid")))
    .not.toBe("inspector-field-label");
});

const importedDiagram = {
  format: "diagrams/v1",
  title: "Imported practice diagram",
  nodes: [{ id: "imported-api", stencil: "generic.service", label: "Imported API", x: 0, y: 0 }],
  edges: [],
};

for (const policy of ["marked", "default"] as const)
  test(`tutorial file imports preserve privacy (${policy})`, async ({ page }) => {
    if (policy === "default")
      await page.addInitScript(() => localStorage.setItem("diagrams.newDiagramsPrivate.v1", "1"));
    await openTutorial(page, "lab-tutorial-runtime");
    await page.getByTestId("tutorial-start").click();
    await page.getByTestId("import-input").setInputFiles({
      name: "practice.diagram.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ ...importedDiagram, ...(policy === "marked" ? { private: true } : {}) })),
    });
    // Import crosses the lazy app/canvas surfaces. Observe the destination before checking tutorial teardown.
    await expect(page.getByTestId("node-imported-api")).toBeVisible({ timeout: pageLoadTimeout() });
    await expect(page.getByTestId("tutorial-app")).toHaveCount(0);
    await expect(page.getByTestId("diagram-title")).toHaveText(importedDiagram.title);
    await expect(page.getByTestId("private-badge")).toBeVisible();
    const entries = await savedEntries(page);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ private: true });
    await page.reload();
    await expect(page.getByTestId("private-badge")).toBeVisible({ timeout: pageLoadTimeout() });
  });

test("tutorial share-link imports persist privately before opening and retain subsequent edits", async ({ page }) => {
  await openTutorial(page, "lab-tutorial-runtime");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-import-from").click();
  await page.getByTestId("import-share-link").click();
  const payload = deflateRawSync(JSON.stringify({ ...importedDiagram, private: true })).toString("base64url");
  await page.getByTestId("open-link-input").fill(`#d=${payload}`);
  await page.getByTestId("open-link-submit").click();
  await expect(page.getByTestId("tutorial-app")).toHaveCount(0);
  await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", "shared");
  await expect(page.getByTestId("private-badge")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("node-imported-api")).toBeVisible({ timeout: pageLoadTimeout() });
  await page.getByTestId("node-imported-api").dblclick();
  await page.getByTestId("inspector-field-label").fill("Kept API");
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() => {
        return Object.keys(localStorage).some(
          (key) => key.startsWith("diagrams.autosave.") && localStorage.getItem(key)?.includes("Kept API"),
        );
      }),
    )
    .toBe(true);
  await page.reload();
  await expect(page.getByTestId("node-imported-api")).toContainText("Kept API", { timeout: pageLoadTimeout() });
  await expect(page.getByTestId("private-badge")).toBeVisible();
});

test("tutorial library deletion keeps keyboard Undo inside the dialog", async ({ page }) => {
  await openTutorial(page, "lab-tutorial-runtime");
  await page.getByTestId("tutorial-start").click();
  await page.keyboard.press("ControlOrMeta+Shift+s");
  await expect(page.getByTestId("tutorial-open-copy")).toBeVisible();
  const [entry] = await savedEntries(page);
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-library").click();
  await page.getByTestId(`library-delete-${entry.slug}`).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId(`library-item-${entry.slug}`)).toHaveCount(0);
  await expect(page.getByTestId("library-delete-undo")).toBeVisible();
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press("Tab");
    if (await page.getByTestId("library-delete-undo").evaluate((button) => button === document.activeElement)) break;
  }
  await expect(page.getByTestId("library-delete-undo")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId(`library-item-${entry.slug}`)).toBeVisible();
  await expect(page.getByTestId("library-delete-undo")).toHaveCount(0);
  expect(await savedEntries(page)).toHaveLength(1);
});

test("New diagram from a tutorial explicitly opens the blank draft after visiting a saved diagram", async ({
  page,
}) => {
  await openTutorial(page, "lab-tutorial-runtime");
  await page.getByTestId("tutorial-start").click();
  await page.keyboard.press("ControlOrMeta+Shift+s");
  await page.getByTestId("tutorial-open-copy").click();
  await expect(page.getByTestId("node-payments")).toBeVisible();
  await openTutorial(page, "lab-tutorial-runtime");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-new").click();
  await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", "new");
  await expect(page.getByTestId("node-payments")).toHaveCount(0);
  expect(await savedEntries(page)).toHaveLength(1);
});

test("tutorial Restart ends slow motion and restarts its saved simulation", async ({ page }) => {
  await page.clock.install();
  await openTutorial(page, "lab-tutorial-runtime");
  await page.getByTestId("tutorial-start").click();
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  await waitForCameraIdle(page);
  await page.getByTestId("node-shop").click({ button: "right" });
  await page.getByTestId("context-menu-item-sim.slowmo-from").click();
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "slowmo");
  await pauseClock(page);
  const before = Number(await page.getByTestId("live-canvas").getAttribute("data-sim-time"));
  expect(before).toBeGreaterThan(0);
  await page.getByTestId("tutorial-restart").click();
  await expect(page.getByTestId("live-play")).not.toHaveAttribute("data-state", "slowmo");
  await expect
    .poll(async () => Number(await page.getByTestId("live-clock").getAttribute("data-ms")))
    .toBeLessThan(before);
  await expectNothingSaved(page);
});

test("typed solution preserves text around the caret", async ({ page }) => {
  await openTutorial(page, "lab-tutorial-typed");
  await page.getByTestId("tutorial-start").click();
  await expect(strip(page)).toHaveAttribute("data-step", "add-setting");
  const steps = await page.evaluate(() => window.__tutorial?.solution() ?? []);
  const typed = steps[steps.length - 1];
  expect(typed).toEqual({ type: "Lab:Token", into: "inspector-field-settings" });
  await play(page, steps[0]);
  const field = page.getByTestId("inspector-field-settings");
  await expect(field).toBeVisible();
  const before = await field.inputValue();
  expect(before).toContain("Orders:PageSize");
  // Without the field's focus, the text is refused rather than typed wherever focus is.
  await expect(play(page, typed)).rejects.toThrow();
  await expect(field).toHaveValue(before);
  for (const step of steps.slice(1)) await play(page, step);
  // Appended at the caret after the example's own settings, which stay as they were.
  await expect(field).toHaveValue(`${before}\nLab:Token`);
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
});
