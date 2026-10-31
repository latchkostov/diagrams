import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  expectNoErrors,
  pageLoadTimeout,
  waitForLiveSession,
  waitForSelectionSettled,
  waitForCameraIdle,
  fitDiagram,
  emptyCanvasPoint,
  pauseClock,
} from "./fixtures";
import { CATCH_UP_MS } from "../../src/live/frameClock";
import { tutorialKey } from "../../scripts/e2e-keys";
import type { ResolvedUiStep } from "../../src/tutorials/solution";

// Tutorials (src/tutorials): one generated test per tutorial plays its solution path through the real UI, step by
// step, and waits on the runner's state (the strip's data-step) to move on. Then the entry point, Skip ("do it for
// me") all the way, Undo stepping back, and the sandbox never reaching Your diagrams.

export async function openTutorial(page: Page, id: string) {
  if (id === "import-and-review")
    await page.addInitScript(() =>
      Object.defineProperty(window, "showOpenFilePicker", { value: undefined, configurable: true }),
    );
  await page.goto(`./?tutorial=${id}`);
  await expect(page.getByTestId("tutorial-start")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
  if (id === "capacity") {
    // This lesson seeds a saved run before Start. Let that lazy session mount before
    // Start resets it, so its pending startup cannot race the solution's Live toggle.
    await waitForLiveSession(page);
    await expect(page.getByTestId("live-sim-picker")).toHaveValue("triple");
  }
}

export async function play(page: Page, step: ResolvedUiStep) {
  if ("close" in step) {
    const close = page.getByTestId(step.close);
    if (await close.isVisible()) await close.click();
  } else if ("playing" in step) {
    const control = page.getByTestId("live-play");
    const state = await control.getAttribute("data-state");
    const playing = state === "slowmo" ? (await control.getAttribute("data-playing")) === "1" : state === "playing";
    if (state !== "waiting" && playing !== step.playing) await control.click();
  } else if ("history" in step) {
    const current = await strip(page).getAttribute("data-step");
    for (let edits = 0; edits < 3 && (await strip(page).getAttribute("data-step")) === current; edits++) {
      const before = await page.evaluate(() => JSON.stringify(window.__tutorial?.diagram()));
      await page.getByTestId(`${step.history}-button`).click();
      await expect.poll(() => page.evaluate(() => JSON.stringify(window.__tutorial?.diagram()))).not.toBe(before);
      await waitForSelectionSettled(page);
    }
  } else if ("importFixture" in step) {
    const chooser = page.waitForEvent("filechooser");
    await page.keyboard.press("ControlOrMeta+o");
    await (await chooser).setFiles("public/tutorial-status-compose.yaml");
  } else if ("open" in step) {
    const disclosure = page.getByTestId(step.open);
    await expect(disclosure).toBeVisible();
    if ((await disclosure.getAttribute("aria-expanded")) === "false") await disclosure.click();
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  } else if ("click" in step) {
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
    } else {
      // React can publish the pressed state after click() resolves. Capture the requested transition first.
      const enteringLive =
        step.click === "live-toggle" &&
        (await page.getByTestId("live-toggle").getAttribute("aria-pressed")) === "false";
      await page.getByTestId(step.click).click();
      // A click requests Live before its lazy session and picker exist. Keep the next recipe input
      // behind the session's real mount signal, as gotoLive does for direct navigation.
      if (enteringLive) await waitForLiveSession(page);
    }
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
  else if ("pan" in step) {
    await waitForCameraIdle(page);
    const pane = await page.getByTestId("canvas-wrap").boundingBox();
    if (!pane) throw new Error("The practice canvas is missing");
    const position = await emptyCanvasPoint(page);
    const x = pane.x + position.x;
    const y = pane.y + position.y;
    const dx = position.x < pane.width / 2 ? pane.width / 8 : -pane.width / 8;
    await page.mouse.move(x, y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(x + dx, y, { steps: 8 });
    await page.mouse.up({ button: "middle" });
  } else if ("pane" in step) {
    const position = await emptyCanvasPoint(page);
    await page.getByTestId("canvas-wrap").dblclick({ position });
  } else if ("dblclick" in step) await page.getByTestId(step.dblclick).dblclick();
  else if ("hover" in step) {
    // A narrated Follow can move this subject out of frame. Overview is the stable map for inspecting any node.
    if (step.hover.startsWith("node-")) {
      await fitDiagram(page);
      await waitForCameraIdle(page);
    }
    await hoverPractice(page, step.hover);
  } else if ("fill" in step) {
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
  } else {
    if (/^Control\+Alt\+[[\]]$/.test(step.press)) {
      // Connection navigation leaves from the focused node. After a quick-add, focus reaches the new (selected) node a
      // frame after its naming ends; pressed sooner, the keys leave from the node before it (CI: study-fanout's push
      // dead-letter queue).
      await waitForCameraIdle(page);
      await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-interaction-state", "idle");
      await expect
        .poll(() =>
          page.evaluate(() => {
            const node = document.activeElement?.closest(".react-flow__node");
            return !node || node.classList.contains("selected");
          }),
        )
        .toBe(true);
    }
    if (step.press === "ControlOrMeta+d")
      await expect.poll(() => page.evaluate(() => window.__historyProbe?.().pending)).toBe(false);
    await page.keyboard.press(tutorialKey(step.press));
  }
}

export const quarantineReason = "quarantined: see docs/backlog/2026-10-24-tutorials-quarantine.md";

export const strip = (page: Page) => page.getByTestId("tutorial-step");

/** A completed lesson may open the sheet before a final readout hover returns. Dismiss it as a learner would. */
export async function hoverPractice(page: Page, id: string) {
  const handoff = page.getByTestId("tutorial-handoff");
  await page.addLocatorHandler(handoff, async () => {
    await page.getByTestId("tutorial-handoff-dismiss").click();
  });
  try {
    await page.getByTestId(id).hover();
  } finally {
    await page.removeLocatorHandler(handoff);
  }
}

export async function finishSolution(page: Page, highlightsOff = false) {
  const seen: string[] = [];
  for (;;) {
    // Traffic can complete a step (or the tutorial) between separate browser reads.
    // Read the runner and its solution in one turn, rather than pairing a stale DOM
    // phase with the next step's solution or the finished strip's empty step id.
    const { value, current, steps } = await page.evaluate(() => {
      const tutorial = window.__tutorial;
      if (!tutorial) throw new Error("The tutorial runner is missing");
      const state = tutorial.snapshot().state;
      return {
        value: state.value,
        current: state.stepIds[state.index],
        steps: state.value === "completing" ? [] : tutorial.solution(),
      };
    });
    if (value === "finished") break;
    expect(["active", "hinting", "completing"]).toContain(value);
    expect(seen, `step ${current} came back`).not.toContain(current);
    seen.push(current);
    if (highlightsOff) await expect(page.getByTestId("tutorial-coach")).toHaveCount(0);
    for (const step of steps) await play(page, step);
    await expect(strip(page)).not.toHaveAttribute("data-step", current, { timeout: 20_000 });
  }
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  return seen;
}

/** Drive authored replay time separately from the wall-clock assertion deadline. */
export async function advanceTutorialClock(page: Page, ready: () => Promise<boolean>) {
  await expect
    .poll(
      async () => {
        // One frame catches up all fixed simulation ticks in this batch; drawing
        // every intervening frame only couples completion to the test machine.
        await page.clock.fastForward(CATCH_UP_MS);
        return ready();
      },
      { intervals: [0] },
    )
    .toBe(true);
}

export async function skipAll(page: Page, clocked = false) {
  const steps = await page.evaluate(() => window.__tutorial?.snapshot().state.stepIds ?? []);
  const lesson = await page.getByTestId("tutorial-app").evaluateAll((apps) => apps[0]?.getAttribute("data-tutorial"));
  while ((await strip(page).getAttribute("data-phase")) === "step") {
    const current = (await strip(page).getAttribute("data-step")) ?? "";
    if (lesson === "sequence-evidence" && (await page.getByTestId("sequence-dialog").isVisible())) {
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("sequence-dialog")).toHaveCount(0);
    }
    await page.getByTestId("tutorial-skip").click();
    if (clocked)
      await advanceTutorialClock(page, async () => {
        if ((await strip(page).getAttribute("data-phase")) === "finished") return true;
        const next = (await strip(page).getAttribute("data-step")) ?? "";
        // A reference replay can temporarily return to an earlier milestone.
        return steps.indexOf(next) > steps.indexOf(current);
      });
    await expect(strip(page)).not.toHaveAttribute("data-step", current);
  }
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
}

/** Nothing a tutorial does is stored as a diagram: no library entry, no autosave for its sandbox. */
export async function expectNothingSaved(page: Page) {
  const keys = await page.evaluate(() => Object.keys(localStorage));
  const stored = keys.filter((k) => /^diagrams\.(autosave|doc|library-entry|library)\./.test(k));
  const library = await page.evaluate(() => localStorage.getItem("diagrams.library.v1"));
  expect(
    stored.filter((k) => k !== "diagrams.library.v1"),
    "a tutorial stored a diagram",
  ).toEqual([]);
  if (library) expect(JSON.parse(library).entries).toEqual([]);
}

export async function savedEntries(page: Page): Promise<{ slug: string; title: string }[]> {
  return page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith("diagrams.library-entry.v1:"))
      .map((k) => JSON.parse(localStorage.getItem(k) ?? "{}")),
  );
}
export async function runPointerSolution(page: Page, consoleErrors: string[], id: string) {
  test.slow(); // Live has to carry real traffic for the last step.
  await openTutorial(page, id);
  const capture = process.env.TUTORIAL_SCREENSHOTS;
  if (
    capture &&
    [
      "checks-and-fixes",
      "route-by-address",
      "network-policy",
      "resource-headroom",
      "sequence-evidence",
      "author-a-simulation",
    ].includes(id)
  ) {
    mkdirSync(capture, { recursive: true });
    await page.screenshot({ path: join(capture, `${id}-intro.png`) });
  }
  await page.getByTestId("tutorial-start").click();
  await expect(strip(page)).toHaveAttribute("data-phase", "step");
  const seen = await finishSolution(page);
  if (
    capture &&
    [
      "checks-and-fixes",
      "route-by-address",
      "network-policy",
      "resource-headroom",
      "sequence-evidence",
      "author-a-simulation",
    ].includes(id)
  )
    await page.screenshot({ path: join(capture, `${id}-completed.png`) });
  if (id === "rate-limit") expect(seen).toEqual(["quota-10", "run", "rejected"]);
  if (id === "backlog-lag") expect(seen).toEqual(["live", "backlog-50", "add-consumer", "consumer-progress"]);
  if (id === "shared-api-quotas")
    expect(seen).toEqual(["launch-burst", "shared-refusals", "local-refusals", "within-budget", "served"]);
  if (id === "capacity") expect(seen).toContain("overlay");
  if (id === "trace-slowmo") {
    expect(seen).toContain("finished");
    await expect(page.getByTestId("live-toggle")).toHaveAttribute("aria-pressed", "true");
  }
  if (id === "saved-simulations") expect(seen).toEqual(["live", "waiting", "continue", "expectation"]);
  if (id === "scale-to-zero") expect(seen).toContain("cold-start");
  if (id === "load-shedding")
    expect(seen).toEqual(["live", "run-spike", "watch-backlog", "cap-queue", "bounded-spike"]);
  if (id === "dead-letters") expect(seen).toContain("replay");
  if (id === "partitions") expect(seen).toEqual(["read-idle", "six-partitions", "rerun"]);
  if (id === "outbox")
    expect(seen).toEqual([
      "trace-message",
      "run-happy-path",
      "read-happy-path",
      "watch-compensation",
      "read-compensation",
    ]);
  if (id === "command-palette") expect(seen).toEqual(["add", "goto", "action"]);
  if (id === "share-present") expect(seen).toEqual(["present", "leave", "share"]);
  await expect(page.getByTestId("tutorial-progress")).toBeVisible();
  if (id === "library-reuse") {
    expect(await savedEntries(page)).toHaveLength(1);
    await expect(page.getByTestId("tutorial-app")).toBeVisible();
  } else await expectNothingSaved(page);
  expectNoErrors(consoleErrors);
}
export async function runPointerSkipAll(page: Page, consoleErrors: string[], id: string) {
  await page.clock.install();
  await openTutorial(page, id);
  await page.getByTestId("tutorial-start").click();
  await pauseClock(page);
  await skipAll(page, true);
  await expectNothingSaved(page);
  expectNoErrors(consoleErrors);
}
