import { test, expect, expectNoErrors, pageLoadTimeout, pauseClock } from "./fixtures";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { CATCH_UP_MS } from "../../src/live/frameClock";
import { tutorialEntries } from "../../src/tutorials/catalog/ids";
import { expectNoViolations } from "./a11y-helpers";
import { chunk, holdChunk } from "./chunk";

test("syllabus: finish, inspect seals, reset a chapter and Undo", async ({ page, consoleErrors }) => {
  await page.goto("./?view=tutorials");
  await expect(page.getByTestId("tutorials-resume")).toContainText("Start here: 1.1", { timeout: pageLoadTimeout() });
  await expect(page.getByTestId("tutorials-overall")).toContainText("0 of 58 lessons · 0 of 7 seals");
  await expect(page.getByTestId("tutorials-chapter-basics")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("tutorial-open-workbench-tour")).toHaveAccessibleName(/^Start 1\.1 .*Not started/);
  await expectNoViolations(page, "tutorials-view");
  await page.getByTestId("tutorials-resume-open").click();
  await page.getByTestId("tutorial-start").click();
  // A Skip can replay reference milestones; follow the rendered step, as the lesson sweep does.
  while ((await page.getByTestId("tutorial-step").getAttribute("data-phase")) === "step") {
    const step = await page.getByTestId("tutorial-step").getAttribute("data-step");
    await page.getByTestId("tutorial-skip").click();
    await expect(page.getByTestId("tutorial-step")).not.toHaveAttribute("data-step", step ?? "");
  }
  await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-phase", "finished");
  await expect(page.getByTestId("tutorial-handoff-logged")).toHaveText("Logged · today");
  await expect(page.getByTestId("tutorial-handoff-heading")).toBeFocused();
  await expect(page.getByTestId("tutorial-handoff-steps")).toHaveText(
    "Add a mobile appAdd the API it callsConnect themName the APIGo liveWatch requests flow",
  );
  await expect(page.getByTestId("tutorial-next")).toHaveText("Start 1.2");
  await expectNoViolations(page, "tutorial-handoff");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("tutorial-next")).toBeFocused();
  await page.getByTestId("tutorial-done-exit").click();
  const today = await page.evaluate(() => new Date().toLocaleDateString("en", { day: "numeric", month: "short" }));
  await expect(page.getByTestId("tutorial-status-workbench-tour")).toHaveText(`Done · ${today}`);
  await expect(page.getByTestId("tutorial-open-workbench-tour")).toHaveAccessibleName(/^Review 1\.1 .*Done/);
  await page.getByTestId("tutorials-seals").click();
  await expect(page.getByTestId("tutorials-seal-chapter-basics")).toContainText("Not yet · 1 of 15");
  await expect(page.getByTestId("tutorials-seal-whole-syllabus")).toContainText("Not yet · 1 of 58");
  await expectNoViolations(page, "tutorials-view");
  await page.getByTestId("tutorials-seals-back").click();
  await page.getByTestId("tutorials-reset-basics").click();
  await expect(page.getByTestId("tutorials-reset-dialog")).toHaveAttribute("role", "alertdialog");
  await expect(page.getByTestId("tutorials-reset-scope-track")).toBeChecked();
  await expect(page.getByTestId("tutorials-reset-cancel")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByTestId("tutorials-reset-chapter-select")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByTestId("tutorials-reset-scope-track")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByTestId("tutorials-reset-confirm")).toBeFocused();
  await expect(page.getByTestId("tutorials-reset-counts")).toHaveText(
    "1 finished lesson, 0 in progress and 0 seals will be reset.",
  );
  await expectNoViolations(page, "tutorials-reset-dialog");
  await page.getByTestId("tutorials-reset-confirm").click();
  await expect(page.getByTestId("tutorial-status-workbench-tour")).toHaveText("3 min · Level 1");
  // Undo is still useful after another surface unmounts and remounts the hub.
  await page.getByTestId("view-gallery").click();
  await page.getByTestId("view-tutorials").click();
  await page.getByTestId("tutorials-reset-undo").click();
  await expect(page.getByTestId("tutorial-status-workbench-tour")).toHaveText(`Done · ${today}`);
  await expect(page.getByTestId("tutorials-overall")).toContainText("1 of 58 lessons");
  await page.reload();
  await expect(page.getByTestId("tutorial-status-workbench-tour")).toHaveText(`Done · ${today}`);
  // The header opens the same dialog, with an explicit Everything scope.
  await page.getByTestId("tutorials-more").click();
  await page.getByTestId("context-menu-item-tutorials-reset").click();
  await expect(page.getByTestId("tutorials-reset-scope-all")).toBeChecked();
  await page.getByTestId("tutorials-reset-scope-lesson").check();
  await page.getByTestId("tutorials-reset-cancel").click();
  await expect(page.getByTestId("tutorials-more")).toBeFocused();
  await page.getByTestId("tutorials-more").click();
  await page.getByTestId("context-menu-item-tutorials-reset").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tutorials-more")).toBeFocused();
  await expect(page.getByTestId("tutorial-status-workbench-tour")).toHaveText(`Done · ${today}`);
  expectNoErrors(consoleErrors);
});

async function finishBySkipping(page: Page, clocked = false) {
  const steps = await page.evaluate(() => window.__tutorial?.snapshot().state.stepIds ?? []);
  const strip = page.getByTestId("tutorial-step");
  while ((await strip.getAttribute("data-phase")) === "step") {
    const step = await strip.getAttribute("data-step");
    await page.getByTestId("tutorial-skip").click();
    if (clocked)
      await expect
        .poll(
          async () => {
            await page.clock.fastForward(CATCH_UP_MS);
            if ((await strip.getAttribute("data-phase")) === "finished") return true;
            const next = (await strip.getAttribute("data-step")) ?? "";
            return steps.indexOf(next) > steps.indexOf(step ?? "");
          },
          { intervals: [0] },
        )
        .toBe(true);
    await expect(strip).not.toHaveAttribute("data-step", step ?? "");
  }
  await expect(strip).toHaveAttribute("data-phase", "finished");
}

async function dismissHandoff(page: Page) {
  await expect(page.getByTestId("tutorial-handoff-heading")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tutorial-handoff")).toHaveCount(0);
}

test("handoff Escape waits for its real focus-and-listener frame", async ({ page }) => {
  await page.goto("./?tutorial=quick-add");
  await page.getByTestId("tutorial-start").click();
  const held = await page.evaluateHandle(() => {
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    const callbacks = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    window.requestAnimationFrame = (callback) => {
      if (!document.querySelector('[data-testid="tutorial-handoff-heading"]')) return request(callback);
      const id = --sequence;
      callbacks.set(id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      if (id < 0) callbacks.delete(id);
      else cancel(id);
    };
    return {
      pending: () => callbacks.size,
      frames: () => new Promise<void>((resolve) => request(() => request(() => resolve()))),
      release() {
        window.requestAnimationFrame = request;
        window.cancelAnimationFrame = cancel;
        for (const callback of callbacks.values()) request(callback);
        callbacks.clear();
      },
    };
  });
  let dismissing: Promise<void> | undefined;
  try {
    await finishBySkipping(page);
    await expect.poll(() => held.evaluate(({ pending }) => pending())).toBeGreaterThan(0);
    dismissing = dismissHandoff(page);
    await held.evaluate(({ frames }) => frames());
    await held.evaluate(({ release }) => release());
    await dismissing;
    await expect(page.getByTestId("canvas-wrap")).toBeFocused();
  } finally {
    await held.evaluate(({ release }) => release());
    await dismissing;
    await held.dispose();
  }
});

test("cancelling Start next while its example loads preserves the intro on a normal reopen", async ({ page }) => {
  const held = await holdChunk(page, chunk("aks-app-config-key-vault", "src/examples/aks-app-config-key-vault.json"));
  try {
    await page.goto("./?tutorial=annotate");
    await page.getByTestId("tutorial-start").click();
    await finishBySkipping(page);
    await page.getByTestId("tutorial-next").click();
    await expect.poll(held.requested).toBe(true);
    await expect(page.getByTestId("view-loading")).toBeVisible();
    await page.getByTestId("tutorial-exit").click();
    await expect(page.getByTestId("tutorials-view")).toBeVisible();
    held.release();
    await page.getByTestId("tutorial-open-dependencies").click();
    await expect(page.getByTestId("tutorial-intro")).toBeVisible();
    await expect(page.getByTestId("tutorial-start")).toBeFocused();
  } finally {
    held.release();
  }
});

test("handoff starts the next lesson directly and Escape leaves the canvas usable", async ({ page }) => {
  await page.goto("./?tutorial=mobile-api");
  await page.getByTestId("tutorial-start").click();
  await finishBySkipping(page);
  await page.getByTestId("tutorial-next").click();
  await expect(page.getByTestId("tutorial-app")).toHaveAttribute("data-tutorial", "quick-add");
  await expect(page.getByTestId("tutorial-intro")).toHaveCount(0);
  await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-phase", "step");
  await finishBySkipping(page);
  await dismissHandoff(page);
  await expect(page.getByTestId("canvas-wrap")).toBeFocused();
  await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-phase", "finished");
  await page.getByTestId("canvas-wrap").click({ position: { x: 40, y: 40 }, button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("tutorial-exit").click();
  await expect(page.getByTestId("tutorials-chapter-basics")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("tutorial-open-quick-add")).toBeInViewport();
});

for (const whole of [false, true]) {
  test(`handoff shows ${whole ? "the final syllabus seal" : "the chapter seal"} only when newly earned`, async ({
    page,
  }) => {
    const id = whole ? "study-cells" : "share-present";
    const ids = tutorialEntries.filter((lesson) => !lesson.quarantined).map((lesson) => lesson.id);
    const done = whole ? ids.filter((lesson) => lesson !== id) : ids.slice(0, ids.indexOf(id));
    const versions = Object.fromEntries(
      readdirSync("src/tutorials/catalog")
        .filter((name) => name.endsWith(".ts"))
        .flatMap((name) => {
          const source = readFileSync(join("src/tutorials/catalog", name), "utf8");
          const id = /id: "([^"]+)"/.exec(source)?.[1];
          const version = /version: (\d+)/.exec(source)?.[1];
          return id && version ? [[id, Number(version)]] : [];
        }),
    );
    await page.addInitScript(
      ({ done, versions }) => {
        localStorage.setItem(
          "diagrams.tutorials.v1",
          JSON.stringify({
            progress: Object.fromEntries(done.map((id) => [id, { version: versions[id], completed: true, step: 0 }])),
          }),
        );
      },
      { done, versions },
    );
    if (whole) await page.clock.install();
    await page.goto(`./?tutorial=${id}`);
    await page.getByTestId("tutorial-start").click();
    if (whole) await pauseClock(page);
    await finishBySkipping(page, whole);
    if (whole) await page.clock.resume();
    const seal = whole ? "whole-syllabus" : "chapter-basics";
    await expect(page.getByTestId(`tutorial-handoff-seal-${seal}`)).toBeVisible();
    await expect(page.getByTestId("tutorial-announce")).toContainText("Seal earned:");
    await expect(page.getByTestId("tutorial-handoff-heading")).toHaveText(
      whole ? "You've finished the syllabus" : "Chapter I complete",
    );
    if (whole) await expect(page.getByTestId("tutorial-next")).toHaveCount(0);
    else await expect(page.getByTestId("tutorial-next")).toHaveText("Start 2.1");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("tutorial-handoff-heading")).toBeInViewport();
    await expect(page.getByTestId("tutorial-done-exit")).toBeInViewport();
    expect(await page.getByTestId("tutorial-handoff").evaluate((el) => getComputedStyle(el).animationName)).toBe(
      "none",
    );
    await expectNoViolations(page, "tutorial-handoff");
    if (!whole) {
      await page.getByTestId("tutorial-handoff-heading").focus();
      await page.keyboard.press("Tab");
      await expect(page.getByTestId("tutorial-next")).toBeFocused();
    }
    await page.getByTestId("tutorial-pick-chapter").click();
    await expect(page.getByTestId(`tutorial-open-${id}`)).toBeInViewport();
    if (!whole) {
      await page.getByTestId(`tutorial-open-${id}`).click();
      await page.getByTestId("tutorial-start").click();
      await finishBySkipping(page);
      await expect(page.getByTestId(`tutorial-handoff-seal-${seal}`)).toHaveCount(0);
      await expect(page.getByTestId("tutorial-announce")).not.toContainText("Seal earned:");
    }
  });
}
