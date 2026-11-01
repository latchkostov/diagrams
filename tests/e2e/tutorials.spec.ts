import {
  openTutorial,
  play,
  hoverPractice,
  finishSolution,
  advanceTutorialClock,
  skipAll,
  expectNothingSaved,
  savedEntries,
  strip,
  quarantineReason,
} from "./pointer-tutorial-driver";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openDiagramProperties, openShareChooser } from "./fixtures";
import { chunk, holdChunk } from "./chunk";
import { openAnnotate, openLibrary } from "./fixtures";
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
  animationFrames,
} from "./fixtures";
import { tutorialEntries } from "../../src/tutorials/catalog/ids";

import { expectNoViolations } from "./a11y-helpers";

test("example Tutorial chip opens its lesson and Exit returns to its chapter", async ({ page, consoleErrors }) => {
  await page.addInitScript(() => localStorage.setItem("diagrams.locale", "cs"));
  await gotoCanvas(page, "retry-storm");
  await page.getByTestId("example-picker").click();
  await page.getByTestId("picker-browse-examples").click();
  const chip = page.getByTestId("example-tutorial-retry-storm");
  await expect(chip).toHaveAccessibleName(`${await chip.textContent()} A retry storm`);
  await chip.click();
  await expect(page.getByTestId("tutorial-start")).toBeVisible();
  await expect(page).toHaveURL(/tutorial=retry-storm/);
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("tutorial-exit").click();
  await expect(page.getByTestId("tutorials-chapter-resilience")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("tutorial-open-retry-storm")).toBeInViewport();
  await page.getByTestId("view-canvas").click();
  await expect(page.getByTestId("node-checkout")).toBeVisible();
  expectNoErrors(consoleErrors);
});

for (const [control, lesson] of [
  ["waiting", "threads-block"],
  ["retries", "retry-storm"],
] as const) {
  test(`inspector ${control} teaches in place and Exit returns to its chapter`, async ({ page, consoleErrors }) => {
    await gotoCanvas(page, "retry-storm");
    await play(page, { click: "edge-pay" });
    await page.keyboard.press("Enter");
    const simulation = page.getByTestId("inspector-section-edge-simulation");
    if ((await simulation.getAttribute("aria-expanded")) === "false") await simulation.click();
    await page.getByTestId(`inspector-tutorial-${control}`).click();
    await expect(page.getByTestId("tutorial-start")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`tutorial=${lesson}`));
    await page.getByTestId("tutorial-start").click();
    if ((await page.getByTestId("live-toggle").getAttribute("aria-pressed")) === "true")
      await page.getByTestId("live-toggle").click();
    const edge = await page.evaluate(
      (key) => window.__tutorial?.snapshot().edges[key],
      lesson === "retry-storm" ? "caller->callee" : "caller->partner",
    );
    expect(edge).toBeTruthy();
    await play(page, { click: `edge-${edge}` });
    await page.keyboard.press("Enter");
    const lessonSimulation = page.getByTestId("inspector-section-edge-simulation");
    if ((await lessonSimulation.getAttribute("aria-expanded")) === "false") await lessonSimulation.click();
    await page.getByTestId(`inspector-tutorial-${control}`).click();
    await page.getByTestId("tutorial-exit").click();
    await expect(page.getByTestId("tutorial-app")).toHaveCount(0);
    await expect(page.getByTestId(`tutorial-open-${lesson}`)).toBeInViewport();
    await page.getByTestId("view-canvas").click();
    await expect(page.getByTestId("node-checkout")).toBeVisible();
    await expect(page).not.toHaveURL(/tutorial=/);
    expectNoErrors(consoleErrors);
  });
}

test("capacity: solution driver handles completion between browser reads", async ({ page }) => {
  await page.setContent('<section data-testid="tutorial-step" data-phase="step" data-step="drain"></section>');
  await page.getByTestId("tutorial-step").evaluate((element) => {
    let finished = false;
    const finish = () =>
      queueMicrotask(() => {
        finished = true;
        element.setAttribute("data-phase", "finished");
        element.setAttribute("data-step", "");
      });
    window.__tutorial = {
      snapshot: () => {
        const value = finished ? "finished" : "active";
        finish();
        return { state: { value, index: 0, stepIds: ["drain"] } };
      },
      solution: () => [],
    } as unknown as NonNullable<Window["__tutorial"]>;
  });
  // Force the old driver's separate phase/step reads across the completion boundary.
  // Playwright's injected getAttribute uses a captured native method, so intercept
  // the browser round trip instead of patching Element.prototype in the page.
  const getByTestId = page.getByTestId.bind(page);
  page.getByTestId = (id) => {
    const locator = getByTestId(id);
    if (id === "tutorial-step") {
      const getAttribute = locator.getAttribute.bind(locator);
      locator.getAttribute = async (name, options) => {
        const value = await getAttribute(name, options);
        if (name === "data-phase" && value === "step")
          await locator.evaluate((element) => {
            element.setAttribute("data-phase", "finished");
            element.setAttribute("data-step", "");
          });
        return value;
      };
    }
    return locator;
  };
  expect(await finishSolution(page)).toEqual(["drain"]);
});

test("dead-letters: solution input waits for the requested Live session to mount", async ({ page }) => {
  const session = await holdChunk(page, chunk("LiveSession", "src/live/LiveSession.tsx"));
  await openTutorial(page, "dead-letters");
  await page.getByTestId("tutorial-start").click();
  // Native macOS observed false immediately after click, before React published the requested state.
  // Keep that snapshot deterministic while the actual session download remains held.
  const getByTestId = page.getByTestId.bind(page);
  page.getByTestId = (id) => {
    const locator = getByTestId(id);
    if (id === "live-toggle") {
      const getAttribute = locator.getAttribute.bind(locator);
      locator.getAttribute = (name, options) =>
        name === "aria-pressed" ? Promise.resolve("false") : getAttribute(name, options);
    }
    return locator;
  };
  let finished = false;
  const clicking = play(page, { click: "live-toggle" }).then(() => {
    finished = true;
  });
  try {
    await expect.poll(session.requested).toBe(true);
    await expect(page.getByTestId("live-toggle")).toHaveAttribute("aria-busy", "true");
    // The pending surface is the boundary, independent of how long its download takes.
    expect(finished).toBe(false);
    session.release();
    await clicking;
    await expect(page.getByTestId("live-sim-picker")).toBeVisible();
  } finally {
    session.release();
    await clicking;
  }
});

test("Skip-all keeps advancing the clock while a reference replay revisits an earlier step", async ({ page }) => {
  await page.clock.install();
  await pauseClock(page);
  await page.setContent(
    '<section data-testid="tutorial-step" data-phase="step" data-step="second"><button data-testid="tutorial-skip">Skip step</button></section>',
  );
  await page.getByTestId("tutorial-step").evaluate((strip) => {
    Object.assign(window, { __tutorial: { snapshot: () => ({ state: { stepIds: ["first", "second"] } }) } });
    let clicks = 0;
    strip.querySelector('[data-testid="tutorial-skip"]')?.addEventListener("click", () => {
      strip.setAttribute("data-clicks", String(++clicks));
      // The replay first restores the predecessor; that is not progress past second.
      strip.setAttribute("data-step", "first");
      if (clicks > 1) strip.setAttribute("data-phase", "finished");
      setTimeout(() => {
        strip.setAttribute("data-step", "");
        strip.setAttribute("data-phase", "finished");
      }, 3000);
    });
  });
  await skipAll(page, true);
  await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-clicks", "1");
});

test("tutorial policy: a failed copy stays on Keep; only the explicit successful copy is owned", async ({ page }) => {
  await openTutorial(page, "library-reuse");
  await page.getByTestId("tutorial-start").click();
  while ((await strip(page).getAttribute("data-step")) !== "keep") {
    const current = await strip(page).getAttribute("data-step");
    await page.getByTestId("tutorial-skip").click();
    await expect(strip(page)).not.toHaveAttribute("data-step", current ?? "");
  }
  await expectNothingSaved(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Object.defineProperty(window, "__copyPolicyRestore", {
      configurable: true,
      value: () => {
        Storage.prototype.setItem = original;
      },
    });
    Storage.prototype.setItem = function (key, value) {
      if (/^diagrams\.(doc|library-entry)\./.test(key)) throw new DOMException("Storage full", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  try {
    await page.getByTestId("tutorial-save-copy").click();
    await expect(page.getByTestId("toast")).toHaveAttribute("data-kind", "error");
    await expect(strip(page)).toHaveAttribute("data-step", "keep");
    await expectNothingSaved(page);
  } finally {
    await page.evaluate(() => (window as Window & { __copyPolicyRestore(): void }).__copyPolicyRestore());
  }
  await page.getByTestId("tutorial-save-copy").click();
  await expect(page.getByTestId("tutorial-open-copy")).toBeVisible();
  expect(await savedEntries(page)).toHaveLength(1);
  await expect(strip(page)).toHaveAttribute("data-step", "keep");
  const stored = () =>
    page.evaluate(() =>
      Object.entries(localStorage)
        .filter(([key]) => /^diagrams\.(doc|autosave|library-entry)\./.test(key))
        .sort(),
    );
  const before = await stored();
  await page.getByTestId("node-status").dblclick();
  await page.getByTestId("inspector-field-label").fill("Later practice edit");
  await page.keyboard.press("Enter");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  expect(await stored()).toEqual(before);
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-library").click();
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  await expect(page.getByTestId("tutorial-app")).toBeVisible();
});

test("tutorial policy: cancelled and failed imports cannot advance or acquire ownership", async ({ page }) => {
  await openTutorial(page, "import-and-review");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("import-input").setInputFiles([]);
  await expect(strip(page)).toHaveAttribute("data-step", "import");
  await page
    .getByTestId("import-input")
    .setInputFiles({ name: "broken.yaml", mimeType: "text/yaml", buffer: Buffer.from("services: [broken") });
  await expect(page.getByTestId("toast")).toHaveAttribute("data-kind", "error");
  await expect(strip(page)).toHaveAttribute("data-step", "import");
  await expectNothingSaved(page);
  await play(page, { importFixture: true });
  await expect(strip(page)).toHaveAttribute("data-step", "report");
  for (const action of await page.evaluate(() => window.__tutorial?.solution() ?? [])) await play(page, action);
  await expect(strip(page)).toHaveAttribute("data-step", "read");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("import-report")).toHaveCount(0);
  await expect(strip(page)).toHaveAttribute("data-step", "read");
  await expectNothingSaved(page);
  await page.getByTestId("tutorial-restart").click();
  await expect(strip(page)).toHaveAttribute("data-step", "import");
  expect(await page.evaluate(() => window.__tutorial?.diagram()?.nodes)).toEqual([]);
});

for (const sample of [
  { id: "workbench-tour", locale: "en", width: 1440, height: 900, dark: false },
  { id: "library-reuse", locale: "en", width: 1440, height: 900, dark: true },
  { id: "workbench-tour", locale: "ar", width: 390, height: 844, dark: false },
  { id: "import-and-review", locale: "en", width: 390, height: 844, dark: true },
  { id: "workbench-tour", locale: "en-XA", width: 780, height: 390, dark: true },
])
  test(`batch2 readability: ${sample.id} ${sample.locale} ${sample.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: sample.width, height: sample.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(({ locale, dark }) => {
      localStorage.setItem("diagrams.locale", locale);
      localStorage.setItem(
        "diagrams.settings.v1",
        JSON.stringify({ theme: dark ? "dark" : "light", themePreference: dark ? "dark" : "light" }),
      );
    }, sample);
    await openTutorial(page, sample.id);
    await page.getByTestId("tutorial-start").click();
    await page.getByTestId("tutorial-show-me").click();
    await expect(page.getByTestId("tutorial-skip")).toBeInViewport();
    await expect(page.getByTestId("tutorial-exit")).toBeInViewport();
    for (const id of ["tutorial-exit", "tutorial-skip", "tutorial-show-me"]) {
      const bounds = await page.getByTestId(id).boundingBox();
      expect(bounds, id).not.toBeNull();
      if (!bounds) throw new Error(`Missing control: ${id}`);
      expect(bounds.x, `${id} left edge`).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width, `${id} right edge`).toBeLessThanOrEqual(sample.width);
    }
    await expectNoViolations(page, "tutorial-app");
    const destination = process.env.TUTORIAL_SCREENSHOTS;
    if (destination) mkdirSync(destination, { recursive: true });
    await page.screenshot({
      path: destination
        ? join(destination, `${sample.id}-${sample.locale}-${sample.width}.png`)
        : testInfo.outputPath("batch2-readable.png"),
    });
  });

for (const entry of ["Skip Save", "Continue at Run"] as const)
  test(`author-a-drill: ${entry} then manual Run plays the saved Drill`, async ({ page, consoleErrors }) => {
    if (entry === "Continue at Run")
      await page.addInitScript(() =>
        localStorage.setItem(
          "diagrams.tutorials.v1",
          JSON.stringify({ progress: { "author-a-drill": { version: 2, step: 3, completed: false } } }),
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

for (const path of ["Skip", "Continue"] as const)
  test(`dependencies-2: ${path} reveals hidden Dependencies`, async ({ page, consoleErrors }) => {
    await page.addInitScript(() => localStorage.setItem("diagrams.showDependencies.v1", "0"));
    await openTutorial(page, "dependencies-2");
    await page.getByTestId("tutorial-start").click();
    await expect(strip(page)).toHaveAttribute("data-step", "show-dependencies");
    if (path === "Skip") await page.getByTestId("tutorial-skip").click();
    else {
      for (const action of await page.evaluate(() => window.__tutorial?.solution() ?? [])) await play(page, action);
      await expect(strip(page)).toHaveAttribute("data-step", "add-setting");
      await page.evaluate(() => localStorage.setItem("diagrams.showDependencies.v1", "0"));
      await page.reload();
      await expect(page.getByTestId("tutorial-start")).toBeVisible({ timeout: pageLoadTimeout() });
      await page.getByTestId("tutorial-start").click();
    }
    await expect(strip(page)).toHaveAttribute("data-step", "add-setting");
    await expect(strip(page)).toHaveAttribute("data-state", "active");
    const edge = await page.evaluate(() => window.__tutorial?.snapshot().edges["api->config"]);
    await expect(page.getByTestId("edge-label-" + edge)).toBeVisible();
    await page.getByTestId("edge-label-" + edge).click();
    await expect(page.getByTestId("inspector-field-settings")).toBeVisible();
    expectNoErrors(consoleErrors);
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
  await expect(strip(page)).toHaveAttribute("data-step", "read-compensation");
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
            progress: { "threads-block": { version: 3, step: 3, completed: false } },
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
  await hoverPractice(page, "node-caller");
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
});

test("rate-limit: playback waits for the limiter readout before completing", async ({ page, consoleErrors }) => {
  await page.clock.install();
  await openTutorial(page, "rate-limit");
  await page.getByTestId("tutorial-start").click();
  for (const id of ["quota-10", "run"]) {
    await expect(strip(page)).toHaveAttribute("data-step", id);
    for (const action of await page.evaluate(() => window.__tutorial?.solution() ?? [])) await play(page, action);
  }
  await page.getByTestId("live-sim-picker").hover();
  await expect
    .poll(async () => Number(await page.getByTestId("live-canvas").getAttribute("data-sim-time")))
    .toBeGreaterThan(0);
  await pauseClock(page);
  await advanceTutorialClock(
    page,
    async () => (await page.getByTestId("live-canvas").getAttribute("data-sim-time")) === "10000",
  );
  await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-sim-time", "10000");
  await expect(strip(page)).toHaveAttribute("data-step", "rejected");
  await hoverPractice(page, "node-limiter");
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  expectNoErrors(consoleErrors);
});

test("scale-to-zero: the cold-start note holds the readout for a late learner", async ({ page, consoleErrors }) => {
  await openTutorial(page, "scale-to-zero");
  await page.getByTestId("tutorial-start").click();
  for (const id of ["run-quiet-sunday", "replicas-zero", "run-morning-rush"]) {
    await expect(strip(page)).toHaveAttribute("data-step", id);
    for (const action of await page.evaluate(() => window.__tutorial?.solution() ?? [])) await play(page, action);
  }
  await page.getByTestId("tutorial-step").hover();
  await expect(page.getByTestId("live-note-continue")).toBeVisible();
  await expect(strip(page)).toHaveAttribute("data-step", "cold-start");
  await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-sim-time", "6000");
  await hoverPractice(page, "node-worker");
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  expectNoErrors(consoleErrors);
});

test("where-time-goes: Latency can be expanded and read before Done finishes", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() =>
    localStorage.setItem(
      "diagrams.tutorials.v1",
      JSON.stringify({
        progress: { "where-time-goes": { version: 3, step: 4, completed: false } },
      }),
    ),
  );
  await openTutorial(page, "where-time-goes");
  await page.getByTestId("tutorial-start").click();
  await pauseClock(page);
  await advanceTutorialClock(page, async () => (await strip(page).getAttribute("data-step")) === "read-breakdown");
  await expect(strip(page)).toHaveAttribute("data-step", "read-breakdown");
  await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-sim-time", "9000");
  await page.clock.resume();
  const solution = await page.evaluate(() => window.__tutorial?.solution() ?? []);
  for (const action of solution.slice(0, -1)) await play(page, action);
  await expect(page.getByTestId("hover-section-latency")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("node-latency-breakdown-billing")).toBeVisible();
  await expect(strip(page)).toHaveAttribute("data-step", "read-breakdown");
  await play(page, solution[solution.length - 1]);
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
});

async function reachStudyMilestone(page: Page, id: string, milestone: string) {
  test.fixme(!!tutorialEntries.find((tutorial) => tutorial.id === id)?.quarantined, quarantineReason);
  await openTutorial(page, id);
  await page.getByTestId("tutorial-start").click();
  while ((await strip(page).getAttribute("data-step")) !== milestone) {
    const current = await strip(page).getAttribute("data-step");
    await page.getByTestId("tutorial-skip").click();
    await expect(strip(page)).not.toHaveAttribute("data-step", current ?? "");
  }
}

for (const finish of ["inspector", "Skip"] as const)
  test(`study-payments: brownout honors saved caller overrides (${finish})`, async ({ page, consoleErrors }) => {
    test.slow();
    await reachStudyMilestone(page, "study-payments", "survive-psp-brownout");
    await page.getByTestId("live-toggle").click();
    await page.getByTestId("live-sim-picker").selectOption("psp-brownout");
    await fitDiagram(page);
    await page.getByTestId("node-psp").dblclick();
    await page.getByTestId("dock-edit-properties").click();
    await page.getByTestId("inspector-field-label").click();
    await page.getByTestId("inspector-field-label").press("Enter");
    // eslint-disable-next-line no-restricted-syntax -- Connection navigation uses Ctrl+Alt on every platform (Ctrl+Option on macOS).
    await page.keyboard.press("Control+Alt+[");
    await expect.poll(() => page.evaluate(() => window.__tutorial?.snapshot().selected)).toEqual(["payments-psp"]);
    await page.getByTestId("inspector-section-edge-simulation").click();
    await page.getByTestId("inspector-field-breaker-on").click();
    await page.getByTestId("inspector-field-breaker-off").click();
    await expect(page.getByTestId("inspector-field-breaker-on")).not.toBeChecked();
    if (finish === "inspector") {
      await page.getByTestId("inspector-field-breaker-on").click();
      await page.getByTestId("inspector-field-deadlineMs").fill("250");
      await page.getByTestId("inspector-field-deadlineMs").press("Enter");
      await page.getByTestId("live-restart").click();
    } else await page.getByTestId("tutorial-skip").click();
    await expect(strip(page)).toHaveAttribute("data-step", "dead-letter-disputes");
    expectNoErrors(consoleErrors);
  });

test("study-checkout: Skip and Continue replay the authored tenfold traffic", async ({ page, consoleErrors }) => {
  test.slow();
  await page.clock.install();
  await reachStudyMilestone(page, "study-checkout", "survive-tenfold");
  await page.getByTestId("live-toggle").click();
  await page.getByTestId("live-sim-picker").selectOption("tenfold");
  await page.getByTestId("live-capacity").click();
  await expect(page.getByTestId("capacity-traffic-mult")).toHaveAttribute("data-value", "10");
  await page.getByTestId("capacity-preset-normal").click();
  await page.getByTestId("capacity-save").click();
  const traffic = () =>
    page.evaluate(() => window.__tutorial?.runs().saved.find((sim) => sim.id === "tenfold")?.multipliers?.traffic);
  await expect.poll(traffic).toBe(1);
  await pauseClock(page);
  await page.getByTestId("tutorial-skip").click();
  await advanceTutorialClock(page, async () => (await strip(page).getAttribute("data-step")) === "keep-orders");
  await expect(strip(page)).toHaveAttribute("data-step", "keep-orders");
  await expect.poll(traffic).toBe(10);
  await page.getByTestId("live-capacity").click();
  await expect(page.getByTestId("capacity-traffic-mult")).toHaveAttribute("data-value", "10");
  await page.reload();
  await expect(page.getByTestId("tutorial-start")).toContainText("Continue", { timeout: pageLoadTimeout() });
  await page.getByTestId("tutorial-start").click();
  await advanceTutorialClock(page, async () => (await strip(page).getAttribute("data-step")) === "keep-orders");
  await expect(strip(page)).toHaveAttribute("data-step", "keep-orders");
  await expect.poll(traffic).toBe(10);
  expectNoErrors(consoleErrors);
});

test("study-checkout: Skip repairs the saved Partner quota pool", async ({ page, consoleErrors }) => {
  test.slow();
  await reachStudyMilestone(page, "study-checkout", "respect-partner-quota");
  if (!(await page.getByTestId("live-sim-picker").isVisible())) await page.getByTestId("live-toggle").click();
  await page.getByTestId("live-sim-picker").selectOption("partner-quota");
  await fitDiagram(page);
  await page.getByTestId("node-payments").dblclick();
  await page.getByTestId("dock-edit-properties").click();
  await page.getByTestId("inspector-field-label").click();
  await page.getByTestId("inspector-field-label").press("Enter");
  // eslint-disable-next-line no-restricted-syntax -- Connection navigation uses Ctrl+Alt on every platform (Ctrl+Option on macOS).
  await page.keyboard.press("Control+Alt+[");
  await expect.poll(() => page.evaluate(() => window.__tutorial?.snapshot().selected)).toEqual(["checkout-payments"]);
  await page.getByTestId("inspector-section-edge-simulation").click();
  await page.getByTestId("inspector-section-call-advanced").click();
  await page.getByTestId("inspector-field-poolConnections").fill("10");
  await page.getByTestId("inspector-field-poolConnections").press("Enter");
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  await expect(page.getByTestId("inspector-field-poolConnections")).toHaveValue("1");
  expectNoErrors(consoleErrors);
});

test("study-dispatch: saved Inputs complete the partition fix", async ({ page, consoleErrors }) => {
  test.slow();
  await page.clock.install();
  await reachStudyMilestone(page, "study-dispatch", "fix-partition-ceiling");
  await pauseClock(page);
  await page.getByTestId("live-sim-picker").selectOption("more-partitions");
  await page.getByTestId("live-capacity").click();
  await page.getByTestId("capacity-replicas-dispatcher").fill("4");
  await page.getByTestId("capacity-replicas-dispatcher").press("Enter");
  await page.getByTestId("capacity-partitions-pings").fill("4");
  await page.getByTestId("capacity-partitions-pings").press("Enter");
  await page.getByTestId("capacity-save").click();
  await page.getByTestId("live-restart").click();
  await advanceTutorialClock(page, async () => (await strip(page).getAttribute("data-phase")) === "finished");
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  expectNoErrors(consoleErrors);
});

for (const { replicas, partitions } of [
  { replicas: 4, partitions: 3 },
  { replicas: 2, partitions: 2 },
])
  test(`study-dispatch: Skip repairs saved Inputs (${replicas} replicas, ${partitions} partitions)`, async ({
    page,
    consoleErrors,
  }) => {
    test.slow();
    await reachStudyMilestone(page, "study-dispatch", "fix-partition-ceiling");
    await page.getByTestId("live-sim-picker").selectOption("more-partitions");
    await page.getByTestId("live-capacity").click();
    // Save a distinct baseline first: 2/2 initially matches the diagram and is not a dirty input.
    await page.getByTestId("capacity-replicas-dispatcher").fill("3");
    await page.getByTestId("capacity-replicas-dispatcher").press("Enter");
    await page.getByTestId("capacity-partitions-pings").fill("3");
    await page.getByTestId("capacity-partitions-pings").press("Enter");
    await page.getByTestId("capacity-save").click();
    await page.getByTestId("capacity-replicas-dispatcher").fill(String(replicas));
    await page.getByTestId("capacity-replicas-dispatcher").press("Enter");
    await page.getByTestId("capacity-partitions-pings").fill(String(partitions));
    await page.getByTestId("capacity-partitions-pings").press("Enter");
    await page.getByTestId("capacity-save").click();
    await expect(strip(page)).toHaveAttribute("data-step", "fix-partition-ceiling");
    await page.getByTestId("tutorial-skip").click();
    await expect(strip(page)).toHaveAttribute("data-phase", "finished");
    await page.getByTestId("tutorial-handoff-dismiss").click();
    await expect(page.getByTestId("tutorial-handoff")).toHaveCount(0);
    await page.getByTestId("live-capacity").click();
    await expect(page.getByTestId("capacity-replicas-dispatcher")).toHaveValue("4");
    await expect(page.getByTestId("capacity-partitions-pings")).toHaveValue("4");
    expectNoErrors(consoleErrors);
  });

test("study-payments: Skip repairs a new simulation run in place, leaving it the learner's unsaved draft", async ({
  page,
  consoleErrors,
}) => {
  test.slow();
  await reachStudyMilestone(page, "study-payments", "never-double-charge");
  await page.getByTestId("live-toggle").click();
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-edit-sims").click();
  await page.getByTestId("sim-panel-new").click();
  await page.getByTestId("sim-panel-title").fill("My unsaved payment run");
  await page.getByTestId("sim-panel-run").click();
  const id = await page.getByTestId("live-sim-picker").inputValue();
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-step", "survive-psp-brownout");
  // Skip saved nothing for the learner: the panel still holds their unsaved draft, title and all.
  await expect(page.getByTestId("sim-panel-title")).toHaveValue("My unsaved payment run");
  await expect(page.getByTestId("sim-panel-dirty")).toBeVisible();
  await expect(page.getByTestId("live-sim-picker")).toHaveValue(id);
  // Run again, then reselecting the draft, still run with safe retries.
  await page.getByTestId("sim-panel-run").click();
  await page.getByTestId("live-sim-picker").selectOption("poison-disputes");
  await page.getByTestId("live-sim-picker").selectOption(id);
  await expect.poll(() => page.evaluate(() => window.__tutorial?.snapshot().state.observed[0])).toBe(true);
  expectNoErrors(consoleErrors);
});

test("study-payments: brownout Skip repairs overridden draft settings, through the open panel's Run again and Save", async ({
  page,
  consoleErrors,
}) => {
  test.slow();
  await reachStudyMilestone(page, "study-payments", "survive-psp-brownout");
  if (!(await page.getByTestId("live-sim-picker").isVisible())) await page.getByTestId("live-toggle").click();
  await page.getByTestId("live-sim-picker").selectOption("psp-brownout");
  // The Live inspector on the saved run: its own deadline (too long) and its breaker turned off.
  await fitDiagram(page);
  await page.getByTestId("node-psp").dblclick();
  await page.getByTestId("dock-edit-properties").click();
  await page.getByTestId("inspector-field-label").click();
  await page.getByTestId("inspector-field-label").press("Enter");
  // eslint-disable-next-line no-restricted-syntax -- Connection navigation uses Ctrl+Alt on every platform (Ctrl+Option on macOS).
  await page.keyboard.press("Control+Alt+[");
  await expect.poll(() => page.evaluate(() => window.__tutorial?.snapshot().selected)).toEqual(["payments-psp"]);
  await page.getByTestId("inspector-section-edge-simulation").click();
  await page.getByTestId("inspector-field-breaker-on").click();
  await page.getByTestId("inspector-field-breaker-off").click();
  await expect(page.getByTestId("inspector-field-breaker-on")).not.toBeChecked();
  await page.getByTestId("inspector-field-deadlineMs").fill("1000");
  await page.getByTestId("inspector-field-deadlineMs").press("Enter");
  const savedCaller = () =>
    page.evaluate(
      () =>
        window.__tutorial?.runs().saved.find((sim) => sim.id === "psp-brownout")?.setup?.edges?.["payments-psp"]
          ?.caller,
    );
  await expect.poll(savedCaller).toMatchObject({ deadlineMs: 1000, breaker: null });
  // Simulations… › edit the run, then Run without Save: a draft carrying those run-only settings.
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-edit-sims").click();
  await page.getByTestId("sim-panel-title").fill("My overridden brownout");
  await page.getByTestId("sim-panel-run").click();
  await expect.poll(() => page.evaluate(() => window.__tutorial?.runs().draft?.title)).toBe("My overridden brownout");
  await page.getByTestId("tutorial-skip").click();
  // Completing the brownout means the draft that plays has the 250 ms deadline and an open breaker.
  await expect(strip(page)).toHaveAttribute("data-step", "dead-letter-disputes");
  const draft = await page.evaluate(() => window.__tutorial?.runs().draft);
  expect(draft?.title).toBe("My overridden brownout");
  expect(draft?.setup?.edges?.["payments-psp"]?.caller).toMatchObject({ deadlineMs: 250, breaker: {} });
  await expect(page.getByTestId("live-sim-picker")).toHaveValue("psp-brownout");
  await expect(page.getByTestId("sim-panel-title")).toHaveValue("My overridden brownout");
  await expect(page.getByTestId("sim-panel-dirty")).toBeVisible();
  // The saved run keeps the learner's own overrides: Skip repaired their draft, not the run they saved.
  expect(await savedCaller()).toMatchObject({ deadlineMs: 1000, breaker: null });
  // The open panel's copy has the repair too: its Run again plays it, and reselecting keeps it.
  const brownout = () => page.evaluate(() => window.__tutorial?.snapshot().state.observed[1]);
  const draftCaller = () =>
    page.evaluate(() => window.__tutorial?.runs().draft?.setup?.edges?.["payments-psp"]?.caller);
  await page.getByTestId("sim-panel-run").click();
  await expect.poll(draftCaller).toMatchObject({ deadlineMs: 250, breaker: {} });
  await page.getByTestId("live-sim-picker").selectOption("poison-disputes");
  await expect.poll(brownout).toBe(false);
  await page.getByTestId("live-sim-picker").selectOption("psp-brownout");
  await expect.poll(brownout, { timeout: 15_000 }).toBe(true);
  // And its Save saves it: the learner's title with the repaired deadline and breaker.
  await page.getByTestId("sim-panel-save").click();
  await expect(page.getByTestId("sim-panel-dirty")).toBeHidden();
  await expect.poll(savedCaller).toMatchObject({ deadlineMs: 250, breaker: {} });
  expect(
    await page.evaluate(() => window.__tutorial?.runs().saved.find((sim) => sim.id === "psp-brownout")?.title),
  ).toBe("My overridden brownout");
  expect(await page.evaluate(() => window.__tutorial?.runs().draft)).toBeNull();
  expectNoErrors(consoleErrors);
});

test("study-payments: Skip at the brownout keeps an edited running draft, through Run again, reselection and Continue", async ({
  page,
  consoleErrors,
}) => {
  test.slow();
  await reachStudyMilestone(page, "study-payments", "survive-psp-brownout");
  if (!(await page.getByTestId("live-sim-picker").isVisible())) await page.getByTestId("live-toggle").click();
  await page.getByTestId("live-sim-picker").selectOption("psp-brownout");
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-edit-sims").click();
  // Edited at this milestone itself, then Run without Save.
  await page.getByTestId("sim-panel-title").fill("My edited brownout");
  await page.getByTestId("sim-panel-run").click();
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-step", "dead-letter-disputes");
  await expect(page.getByTestId("sim-panel-title")).toHaveValue("My edited brownout");
  await expect(page.getByTestId("sim-panel-dirty")).toBeVisible();
  await expect(page.getByTestId("live-sim-picker")).toHaveValue("psp-brownout");
  // Run again and reselection play the repaired brownout: its 250 ms deadline opens the breaker again.
  const brownout = () => page.evaluate(() => window.__tutorial?.snapshot().state.observed[1]);
  await page.getByTestId("sim-panel-run").click();
  await page.getByTestId("live-sim-picker").selectOption("poison-disputes");
  await expect.poll(brownout).toBe(false);
  await page.getByTestId("live-sim-picker").selectOption("psp-brownout");
  await expect.poll(brownout, { timeout: 15_000 }).toBe(true);
  // The learner's own Save keeps their edit; Continue after a reload lands where they left.
  await page.getByTestId("sim-panel-save").click();
  await expect(page.getByTestId("sim-panel-dirty")).toBeHidden();
  await page.reload();
  await expect(page.getByTestId("tutorial-start")).toContainText("Continue", { timeout: pageLoadTimeout() });
  await page.getByTestId("tutorial-start").click();
  await expect(strip(page)).toHaveAttribute("data-step", "dead-letter-disputes");
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
  // Restoring the topic does not impersonate the learner's palette navigation.
  await expect(strip(page)).toHaveAttribute("data-step", "goto");
  await finishSolution(page);
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
  await openAnnotate(page);
  await page.getByTestId("palette-annotate-text").click();
  await expect(page.getByTestId("annotation-editor")).toBeFocused();
  await expect(strip(page)).toHaveAttribute("data-step", "title");
  await expect(strip(page)).toHaveAttribute("data-state", "completing");
  await page.getByTestId("annotation-editor").fill("Checkout overview");
  await expect(strip(page)).toHaveAttribute("data-step", "title");
  await page.keyboard.press("Escape");
  await expect(strip(page)).toHaveAttribute("data-step", "note");
  // Skip with the note's editor open commits it and moves on once, without another note.
  await openAnnotate(page);
  await page.getByTestId("palette-annotate-note").click();
  await expect(page.getByTestId("annotation-editor")).toBeFocused();
  await expect(strip(page)).toHaveAttribute("data-state", "completing");
  await expect(page.getByTestId("tutorial-completing").getByTestId("coach-key")).toHaveText([
    "Esc",
    process.platform === "darwin" ? "⌘" : "Ctrl",
    "Enter",
  ]);
  await page.getByTestId("annotation-editor").fill("Keep this learner note");
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-step", "zone");
  await expect(page.getByTestId("annotation-editor")).toHaveCount(0);
  await expect(page.getByTestId(/^annotation-text-/).filter({ hasText: "Keep this learner note" })).toHaveCount(1);
  await expect(page.locator('[data-testid^="annotation-"][data-kind="note"]')).toHaveCount(1);
  expectNoErrors(consoleErrors);
});

test("arrange: Align middles accepts a box containing services and their connection", async ({
  page,
  consoleErrors,
}) => {
  await openTutorial(page, "arrange");
  await page.getByTestId("tutorial-start").click();
  await fitDiagram(page);
  await waitForCameraIdle(page);
  await page.getByTestId("node-seed-0").hover();
  await page.getByTestId("handle-seed-0-right").dragTo(page.getByTestId("handle-seed-1-left"));
  await expect(page.getByTestId(/^edge-(?!label-)/)).toHaveCount(1);
  for (const action of await page.evaluate(() => window.__tutorial?.solution() ?? [])) await play(page, action);
  await expect(strip(page)).toHaveAttribute("data-step", "align");
  expect(await page.evaluate(() => window.__tutorial?.snapshot().selected.length)).toBe(6);
  for (const action of await page.evaluate(() => window.__tutorial?.solution() ?? [])) await play(page, action);
  await expect(strip(page)).toHaveAttribute("data-step", "tidy");
  expectNoErrors(consoleErrors);
});

for (const finish of ["Align middles", "Skip"] as const)
  test(`arrange: Show me keeps the box selection, then ${finish} finishes Align middles`, async ({
    page,
    consoleErrors,
  }) => {
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

for (const selectedApp of [false, true])
  test(`insert-on-edge: Skip reuses a gateway added ${selectedApp ? "after the selected app" : "separately"} without a duplicate`, async ({
    page,
    consoleErrors,
  }) => {
    await openTutorial(page, "insert-on-edge");
    await page.getByTestId("tutorial-start").click();
    if (selectedApp) {
      await page.getByTestId("node-app").click();
      await waitForSelectionSettled(page);
    }
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

test("command-palette: adding a topic waits for Go to without requiring an unrelated selection", async ({
  page,
  consoleErrors,
}) => {
  await openTutorial(page, "command-palette");
  await page.getByTestId("tutorial-start").click();
  await playUntil(page, 3);
  await expect(strip(page)).toHaveAttribute("data-step", "goto");
  const nodes = page.getByTestId(/^rf__node-/);
  await expect(nodes).toHaveCount(3);
  const count = await nodes.count();
  await expect(strip(page)).toHaveAttribute("data-state", "active");
  await expect(nodes).toHaveCount(count);
  const topic = await page.evaluate(() => window.__tutorial?.snapshot().subjects.topic);
  await expect.poll(() => page.evaluate(() => window.__tutorial?.snapshot().selected)).toEqual([topic]);
  for (const action of await page.evaluate(() => window.__tutorial?.solution() ?? [])) await play(page, action);
  await expect(strip(page)).toHaveAttribute("data-step", "action");
  await expect(nodes).toHaveCount(count);
  expectNoErrors(consoleErrors);
});

test("share-present: Continue reconstructs presentation before returning to Share", async ({ page, consoleErrors }) => {
  await openTutorial(page, "share-present");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("present-toggle").click();
  await expect(strip(page)).toHaveAttribute("data-step", "leave");
  await page.reload();
  await expect(page.getByTestId("tutorial-start")).toBeVisible({ timeout: pageLoadTimeout() });
  await page.getByTestId("tutorial-start").click();
  await expect(strip(page)).toHaveAttribute("data-step", "leave");
  await expect(page.getByTestId("present-exit")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(strip(page)).toHaveAttribute("data-step", "share");
  await expect(strip(page)).toHaveAttribute("data-state", "active");
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-share").click();
  await expect(strip(page)).toHaveAttribute("data-step", "audience");
  await page.keyboard.press("Escape");
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  expectNoErrors(consoleErrors);
});

test("share-present exits to the original diagram without saving, and offers Interactive HTML first", async ({
  page,
}) => {
  await gotoCanvas(page, "retry-storm");
  await page.getByTestId("view-tutorials").click();
  if ((await page.getByTestId("tutorials-chapter-sharing").getAttribute("aria-expanded")) !== "true")
    await page.getByTestId("tutorials-chapter-sharing").click();
  await page.getByTestId("tutorial-open-share-present").click();
  await page.getByTestId("tutorial-start").click();
  for (const current of ["present", "leave", "share"]) {
    await expect(strip(page)).toHaveAttribute("data-step", current);
    for (const action of await page.evaluate(() => window.__tutorial?.solution() ?? [])) await play(page, action);
    await expect(strip(page)).not.toHaveAttribute("data-step", current);
  }
  await expect(strip(page)).toHaveAttribute("data-step", "audience");
  await expect(page.getByTestId("share-chooser")).toBeVisible();
  await expect(page.getByTestId("share-option-html")).toBeFocused();
  await expectNothingSaved(page);
  await page.keyboard.press("Escape");
  await finishSolution(page);
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
  if ((await page.getByTestId("tutorials-chapter-sharing").getAttribute("aria-expanded")) !== "true")
    await page.getByTestId("tutorials-chapter-sharing").click();
  await page.getByTestId("tutorial-open-share-present").click();
  await page.getByTestId("tutorial-start").click();
  const practiceId = await page.evaluate(() => window.__tutorial?.diagram()?.nodes[0]?.id);
  if (!practiceId) throw new Error("Practice diagram has no node");
  const practiceNode = page.getByTestId(`node-${practiceId}`);
  await practiceNode.dblclick();
  await page.getByTestId("inspector-field-label").fill("Sandbox edit only");
  await page.keyboard.press("Enter");
  await expect(practiceNode).toContainText("Sandbox edit only");
  await page.getByTestId("tutorial-exit").click();
  await expect(page.getByTestId("tutorials-view")).toBeVisible();
  await page.getByTestId("view-canvas").click();
  await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", slug);
  await expect(page.getByTestId(originalTestId)).toContainText("My edited service");
  await expect(page.getByTestId(/^node-/)).toHaveCount(original.nodes.length);
  await expect(practiceNode).toHaveCount(0);
  expect(await savedDiagram(page)).toEqual(original);
  expectNoErrors(consoleErrors);
});

test("tutorial policy: share-present downloads on Save as without acquiring ownership", async ({ page }) => {
  await openTutorial(page, "share-present");
  await page.getByTestId("tutorial-start").click();
  await skipAll(page);
  await expectNothingSaved(page);
  const download = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+Shift+s");
  expect((await download).suggestedFilename()).toMatch(/\.diagram\.json$/);
  await expectNothingSaved(page);
  await expect(page.getByTestId("tutorial-open-copy")).toHaveCount(0);
});

test("Tutorials view and running tutorial pass the shared axe scan", async ({ page }) => {
  await page.goto("./?view=tutorials");
  await expect(page.getByTestId("tutorials-view")).toBeVisible({ timeout: pageLoadTimeout() });
  await expectNoViolations(page);
  await openTutorial(page, "mobile-api");
  await page.getByTestId("tutorial-start").click();
  await expect(strip(page)).toHaveAttribute("data-phase", "step");
  // Scan the settled page: entrance fades would otherwise be measured mid-way.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity),
  );
  await expectNoViolations(page);
});

test("mobile-api plays with Highlights off throughout", async ({ page }) => {
  test.slow();
  await openTutorial(page, "mobile-api");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("tutorial-highlights").uncheck();
  await finishSolution(page, true);
  await expect(page.getByTestId("tutorial-spot")).toHaveCount(0);
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
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-step", "connect");
  // The canvas stays LTR. A target in its middle has room on the Arabic inline-end (left).
  await expect(page.getByTestId("tutorial-coach")).toHaveAttribute("data-target", "handle-mobile-1-right");
  await expect
    .poll(async () => {
      const tip = await page.getByTestId("coach-card").boundingBox();
      const target = await page.getByTestId("handle-mobile-1-right").boundingBox();
      return !!tip && !!target && tip.x + tip.width < target.x;
    })
    .toBe(true);
  await finishSolution(page);
  await expectNothingSaved(page);
});

test("finish offers a copy only on request, with Open returning to the saved diagram", async ({ page }) => {
  await openTutorial(page, "library-reuse");
  await page.getByTestId("tutorial-start").click();
  await skipAll(page);
  await expectNothingSaved(page);
  await page.getByTestId("tutorial-save-copy").click();
  await expect(page.getByTestId("tutorial-open-copy")).toBeVisible();
  const entries = await savedEntries(page);
  expect(entries).toHaveLength(1);
  await page.getByTestId("tutorial-open-copy").click();
  await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", entries[0].slug);
  await expect(page.getByTestId("node-status")).toContainText("Status API");
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
  await openLibrary(page);
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
  await expect(page.getByTestId("tutorial-intro")).toHaveCount(0);
  await skipAll(page);
  // The handoff wraps to the unfinished Building blocks fixture after this chapter is complete.
  await expect(page.getByTestId("tutorial-next")).toHaveText("Start 2.1");
  await page.getByTestId("tutorial-done-exit").click();
  await expect(page.getByTestId("tutorials-view")).toBeVisible();
  await expect(page.getByTestId("tutorial-app")).toHaveCount(0);
});

test("tutorial policy: File Save as downloads practice without adding it to Your diagrams", async ({ page }) => {
  await openTutorial(page, "lab-tutorial-runtime");
  await page.getByTestId("tutorial-start").click();
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  await expectNothingSaved(page);
  await page.getByTestId("file-button").click();
  const download = page.waitForEvent("download");
  await page.getByTestId("export-save-as").click();
  expect((await download).suggestedFilename()).toMatch(/\.diagram\.json$/);
  await expectNothingSaved(page);
  await expect(page.getByTestId("tutorial-app")).toBeVisible();
});

test("app chrome Present hides teaching chrome and returns to the same tutorial", async ({ page }) => {
  await openTutorial(page, "lab-tutorial-runtime");
  await page.getByTestId("tutorial-start").click();
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  await page.getByTestId("present-toggle").click();
  await expect(page.getByTestId("tutorial-bar")).toHaveCount(0);
  await expect(page.getByTestId("tutorial-step")).toBeHidden();
  await expect(page.getByTestId("tutorial-spot")).toHaveCount(0);
  await page.getByTestId("present-exit").click();
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  await expect(page.getByTestId("topbar")).toBeVisible();
  await expectNothingSaved(page);
});

test("tutorial policy: save shortcuts leave Your diagrams empty in other lessons", async ({ page }) => {
  await openTutorial(page, "lab-tutorial-runtime");
  await page.getByTestId("tutorial-start").click();
  const download = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+Shift+s");
  await download;
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-library").click();
  // Your diagrams can still be downloading when File hands over to its dialog.
  await expect(page.getByTestId("library-dialog").or(page.getByTestId("lazy-dialog"))).toBeVisible({
    timeout: pageLoadTimeout(),
  });
  await expect(page.getByTestId("lazy-dialog")).toHaveCount(0, { timeout: pageLoadTimeout() });
  await expect(page.getByTestId("library-dialog")).toBeVisible();
  expect(await savedEntries(page)).toHaveLength(0);
  await expectNothingSaved(page);
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
  await expect(page.getByTestId("view-tutorials")).toHaveAttribute("aria-pressed", "true");
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
  await openTutorial(page, "quick-add");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-step", "grow");
  await page.getByTestId("node-browser-1").click();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("quick-add-search")).toHaveValue("Service");
  // Highlighted at once, without hovering, while the coach explains the assisted search.
  await expect(page.getByTestId("context-menu-item-quick-add:generic.service")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("tutorial-coach")).toHaveAttribute("data-target", "quick-add-search");
  await page.keyboard.press("Enter");
  // The + also connected it, so the name is next; its field already has the keyboard (quick-add's own rule).
  await expect(strip(page)).toHaveAttribute("data-step", "name-api");
  await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  await page.keyboard.type("Web API");
  // The name matches, but it's still being typed: completing, and nothing moves the keyboard.
  await expect(strip(page)).toHaveAttribute("data-state", "completing");
  await expect(page.getByTestId("tutorial-spot")).toHaveCount(0);
  await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(strip(page)).toHaveAttribute("data-step", "grow-db");
  // The canvas's own first-time tips stay quiet in a tutorial.
  await expect(page.getByTestId("first-run-hint")).toHaveCount(0);
  await expect(page.getByTestId("toast-make-message")).toHaveCount(0);
  await expect(page.getByTestId("reset-diagram")).toHaveCount(0);
});

test("a near-miss name says what's expected and fixes it in one click", async ({ page }) => {
  await skipToName(page);
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
  expect(progress.progress["mobile-api"]).toMatchObject({ completed: true, version: 2 });
  await expectNothingSaved(page);
  // Restart puts the practice diagram back as it started.
  await page.getByTestId("tutorial-restart").click();
  await expect(strip(page)).toHaveAttribute("data-step", "add-app");
  await expect(page.getByTestId("node-mobile-1")).toHaveCount(0);
});

test("Undo goes back a step; Show me reveals the hint and highlights still point the way", async ({ page }) => {
  await openTutorial(page, "mobile-api");
  await page.getByTestId("tutorial-start").click();
  await expect(page.getByTestId("tutorial-coach")).toHaveAttribute("data-target", "rail-add");
  await page.getByTestId("rail-add").click();
  await expect(page.getByTestId("tutorial-coach")).toHaveAttribute("data-target", "palette-search");
  await openLibrary(page);
  await page.getByTestId("palette-search").fill("mobile");
  await expect(page.getByTestId("tutorial-coach")).toHaveAttribute("data-target", "palette-item-client.mobile");
  await openLibrary(page);
  await page.getByTestId("palette-item-client.mobile").click();
  await expect(strip(page)).toHaveAttribute("data-step", "add-api");
  await expect(page.getByTestId("tutorial-done")).toBeVisible();
  await page.getByTestId("tutorial-show-me").click();
  await expect(page.getByTestId("tutorial-hint")).toBeVisible();
  await page.getByTestId("undo-button").click();
  await expect(strip(page)).toHaveAttribute("data-step", "add-app");
  // Highlights off: no coach mark, the words stay.
  await page.getByTestId("tutorial-highlights").uncheck();
  await expect(page.getByTestId("tutorial-spot")).toHaveCount(0);
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
  await expect(strip(page)).toHaveAttribute("data-step", "connect");
  expect(await page.evaluate(() => window.__tutorial?.diagram().edges)).toEqual([]);
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-step", "name-api");
  await page.getByTestId("node-service-1").dblclick();
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
    await openDiagramProperties(page);
    await expect(page.getByTestId("private-badge")).toBeVisible();
    const entries = await savedEntries(page);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ private: true });
    await page.reload();
    await openDiagramProperties(page);
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
  await openDiagramProperties(page);
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
  await openDiagramProperties(page);
  await expect(page.getByTestId("private-badge")).toBeVisible();
});

test("tutorial library deletion keeps keyboard Undo inside the dialog", async ({ page }) => {
  await openTutorial(page, "library-reuse");
  await page.getByTestId("tutorial-start").click();
  await skipAll(page);
  await page.getByTestId("tutorial-save-copy").click();
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
  await openTutorial(page, "library-reuse");
  await page.getByTestId("tutorial-start").click();
  await skipAll(page);
  await page.getByTestId("tutorial-save-copy").click();
  await page.getByTestId("tutorial-open-copy").click();
  await expect(page.getByTestId("node-status")).toBeVisible();
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
  await page.getByTestId("tutorial-handoff-dismiss").click();
  await expect(page.getByTestId("tutorial-handoff")).toHaveCount(0);
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

declare global {
  interface Window {
    __tutorialFiles: { pickerCalls: number; writes: string[] };
  }
}

test("shortcuts Tutorials navigation preserves the opened device file Save binding", async ({ page }) => {
  await page.addInitScript((diagram) => {
    const state = { pickerCalls: 0, writes: [] as string[] };
    window.__tutorialFiles = state;
    const handle = {
      kind: "file",
      name: "practice.diagram.json",
      getFile: async () => new File([JSON.stringify(diagram)], "practice.diagram.json"),
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
      createWritable: async () => ({
        write: async (text: string) => {
          state.writes.push(text);
        },
        close: async () => {},
      }),
    };
    Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: async () => [handle] });
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async () => {
        state.pickerCalls++;
        return handle;
      },
    });
  }, importedDiagram);
  await gotoCanvas(page, "retry-storm");
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-open").click();
  await expect(page.getByTestId("node-imported-api")).toBeVisible();
  await page.getByTestId("shortcuts-button").click();
  await page.getByTestId("shortcuts-tutorials").click();
  await expect(page.getByTestId("tutorials-view")).toBeVisible();
  await expect(page.getByTestId("shortcuts-dialog")).toHaveCount(0);
  if ((await page.getByTestId("tutorials-chapter-sharing").getAttribute("aria-expanded")) !== "true")
    await page.getByTestId("tutorials-chapter-sharing").click();
  await page.getByTestId("tutorial-open-share-present").click();
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("view-tutorials").click();
  await expect(page.getByTestId("tutorials-view")).toBeVisible();
  if ((await page.getByTestId("tutorials-chapter-sharing").getAttribute("aria-expanded")) !== "true")
    await page.getByTestId("tutorials-chapter-sharing").click();
  await page.getByTestId("tutorial-open-share-present").click();
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("shortcuts-button").click();
  await page.getByTestId("shortcuts-tutorials").click();
  await expect(page.getByTestId("tutorials-view")).toBeVisible();
  await page.getByTestId("view-canvas").click();
  await expect(page.getByTestId("node-imported-api")).toBeVisible();
  await page.getByTestId("node-imported-api").dblclick();
  await page.getByTestId("inspector-field-label").fill("Saved after tutorials");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => page.evaluate(() => window.__tutorialFiles.writes.length)).toBe(1);
  expect(await page.evaluate(() => window.__tutorialFiles.pickerCalls)).toBe(0);
  const saved = await page.evaluate(() => window.__tutorialFiles.writes[0]);
  expect(JSON.parse(saved).nodes[0].label).toBe("Saved after tutorials");
});

test("checks-and-fixes: Continue after a real Undo restores Reapply and its finding before learner input", async ({
  page,
  consoleErrors,
}) => {
  await openTutorial(page, "checks-and-fixes");
  await page.getByTestId("tutorial-start").click();
  for (const current of ["open", "read", "fix", "undo"]) {
    await expect(strip(page)).toHaveAttribute("data-step", current);
    for (const action of await page.evaluate(() => {
      const tutorial = window.__tutorial;
      if (!tutorial) throw new Error("The tutorial runner is missing");
      return tutorial.solution();
    }))
      await play(page, action);
    await expect(strip(page)).not.toHaveAttribute("data-step", current);
  }
  await expect(strip(page)).toHaveAttribute("data-step", "reapply");
  const absentConsumer = async () =>
    expect(
      await page.evaluate(() => window.__tutorial?.diagram()?.nodes.some((node) => node.stencil === "generic.service")),
    ).toBe(false);
  await absentConsumer();
  await page.getByTestId("tutorial-exit").click();
  await page.goto("./?tutorial=checks-and-fixes");
  await expect(page.getByTestId("tutorial-start")).toContainText("Continue", { timeout: pageLoadTimeout() });
  await page.getByTestId("tutorial-start").click();
  await expect(strip(page)).toHaveAttribute("data-state", "active");
  await expect(strip(page)).toHaveAttribute("data-step", "reapply");
  await absentConsumer();
  await page.getByTestId("checks-count").click();
  await expect(page.getByTestId("check-choose-no-reader:topic")).toBeEnabled();
  await skipAll(page);
  expectNoErrors(consoleErrors);
});

for (const id of [
  "api-gateway",
  "route-by-address",
  "kafka-topic",
  "queue-workers",
  "load-balancer",
  "cache-aside",
  "webhooks",
  "fanout",
  "partitions",
  "outbox",
  "dependencies-2",
  "network-policy",
  "checks-and-fixes",
]) {
  test(`${id}: Continue reconstructs the first completed step and Skip reaches the handoff`, async ({
    page,
    consoleErrors,
  }) => {
    await page.clock.install();
    await openTutorial(page, id);
    await page.getByTestId("tutorial-start").click();
    await pauseClock(page);
    const first = await strip(page).getAttribute("data-step");
    await page.getByTestId("tutorial-skip").click();
    await advanceTutorialClock(page, async () => (await strip(page).getAttribute("data-step")) !== first);
    const milestone = await strip(page).getAttribute("data-step");
    if (!milestone) throw new Error("The saved tutorial milestone is missing");
    const predecessor = await page.evaluate(() => {
      const diagram = window.__tutorial?.diagram();
      if (!diagram) throw new Error("The tutorial diagram is missing");
      return {
        nodes: diagram.nodes.map(({ stencil, label, props }) => ({ stencil, label, props })),
        edges: diagram.edges.map(({ from, to, kind, props }) => ({
          from: diagram.nodes.findIndex((node) => node.id === from),
          to: diagram.nodes.findIndex((node) => node.id === to),
          kind,
          props,
        })),
      };
    });
    await page.getByTestId("tutorial-exit").click();
    await page.goto(`./?tutorial=${id}`);
    await expect(page.getByTestId("tutorial-start")).toContainText("Continue", { timeout: pageLoadTimeout() });
    await page.getByTestId("tutorial-start").click();
    await pauseClock(page);
    await advanceTutorialClock(page, async () =>
      ["active", "hinting", "completing"].includes((await strip(page).getAttribute("data-state")) ?? ""),
    );
    await expect(strip(page)).toHaveAttribute("data-step", milestone);
    expect(
      await page.evaluate(() => {
        const diagram = window.__tutorial?.diagram();
        if (!diagram) throw new Error("The tutorial diagram is missing");
        return {
          nodes: diagram.nodes.map(({ stencil, label, props }) => ({ stencil, label, props })),
          edges: diagram.edges.map(({ from, to, kind, props }) => ({
            from: diagram.nodes.findIndex((node) => node.id === from),
            to: diagram.nodes.findIndex((node) => node.id === to),
            kind,
            props,
          })),
        };
      }),
    ).toEqual(predecessor);
    await skipAll(page, true);
    await expectNothingSaved(page);
    expectNoErrors(consoleErrors);
  });
}

test("tutorial sandbox privacy: private native imports block sharing and AI and keep the export marker", async ({
  page,
}) => {
  await openTutorial(page, "import-and-review");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("import-input").setInputFiles({
    name: "private-practice.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...importedDiagram, private: true })),
  });
  await expect(page.getByTestId("node-imported-api")).toBeVisible();
  await openShareChooser(page);
  await expect(page.getByTestId("share-private-note")).toBeVisible();
  for (const id of ["share-public-toggle", "share-option-link", "share-option-password"])
    await expect(page.getByTestId(id)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("share-chooser")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__tutorial?.aiAllowed())).toBe(false);
  const download = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+s");
  const file = await download;
  const path = await file.path();
  if (!path) throw new Error("Expected a downloaded private diagram");
  expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ private: true, title: importedDiagram.title });
  await expect(page.getByTestId("tutorial-app")).toBeVisible();
  await expectNothingSaved(page);
});

test("tutorial sandbox privacy: private then public import and Undo keep sharing, AI and exports private", async ({
  page,
}) => {
  await openTutorial(page, "import-and-review");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("import-input").setInputFiles({
    name: "private-practice.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...importedDiagram, private: true })),
  });
  await expect(page.getByTestId("node-imported-api")).toBeVisible();
  await page.getByTestId("import-input").setInputFiles("public/tutorial-status-compose.yaml");
  await expect(page.getByTestId("node-imported-api")).toHaveCount(0);
  await page.getByTestId("undo-button").click();
  await expect(page.getByTestId("node-imported-api")).toBeVisible();
  await openShareChooser(page);
  await expect(page.getByTestId("share-private-note")).toBeVisible();
  for (const id of ["share-public-toggle", "share-option-link", "share-option-password"])
    await expect(page.getByTestId(id)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("share-chooser")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__tutorial?.aiAllowed())).toBe(false);
  const download = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+s");
  const file = await download;
  const path = await file.path();
  if (!path) throw new Error("Expected a downloaded private diagram");
  expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ private: true, title: importedDiagram.title });
  await expect(page.getByTestId("tutorial-app")).toBeVisible();
  await expectNothingSaved(page);
});

test("tutorial policy: report Make it private changes only sandbox privacy", async ({ page }) => {
  await openTutorial(page, "import-and-review");
  await page.getByTestId("tutorial-start").click();
  await play(page, { importFixture: true });
  await expect(strip(page)).toHaveAttribute("data-step", "report");
  await page.getByTestId("toast-import-details").click();
  await page.getByTestId("import-report-make-private").click();
  await expect(page.getByTestId("import-report-make-private")).toHaveCount(0);
  await expect(page.getByTestId("tutorial-app")).toBeVisible();
  await expect(page).toHaveURL(/tutorial=import-and-review/);
  await expectNothingSaved(page);
  await page.getByTestId("import-report-close").click();
  await expect(page.getByTestId("import-report")).toHaveCount(0);
  await openShareChooser(page);
  await expect(page.getByTestId("share-private-note")).toBeVisible();
});

test("import-and-review: imports its downloaded practice file", async ({ page }, testInfo) => {
  await openTutorial(page, "import-and-review");
  await page.getByTestId("tutorial-start").click();
  const pending = page.waitForEvent("download");
  await page.getByTestId("tutorial-fixture").click();
  const download = await pending;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toBe("tutorial-status-compose.yaml");
  const path = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("ControlOrMeta+o");
  await (await chooser).setFiles(path);
  await expect(strip(page)).toHaveAttribute("data-step", "report");
  expect(
    await page.evaluate(() =>
      window.__tutorial
        ?.diagram()
        ?.nodes.map((node) => node.label)
        .sort(),
    ),
  ).toEqual(["api", "redis", "worker"]);
  await page.getByTestId("toast-import-details").click();
  await expect(page.getByTestId("import-report")).toContainText("tutorial-status-compose.yaml");
  await expectNothingSaved(page);
});

for (const entry of ["Skip", "Continue"] as const) {
  test(`tutorial import lifecycle: ${entry} fixture cannot overwrite a manual import and edit`, async ({ page }) => {
    if (entry === "Continue")
      await page.addInitScript(() =>
        localStorage.setItem(
          "diagrams.tutorials.v1",
          JSON.stringify({ progress: { "import-and-review": { version: 1, step: 1, completed: false } } }),
        ),
      );
    const fixture = /\/tutorial-status-compose\.yaml$/;
    const held = await holdChunk(page, fixture);
    await openTutorial(page, "import-and-review");
    await page.getByTestId("tutorial-start").click();
    if (entry === "Skip") await page.getByTestId("tutorial-skip").click();
    await expect.poll(held.requested).toBe(true);
    await play(page, { importFixture: true });
    await expect.poll(() => page.evaluate(() => window.__tutorial?.snapshot().subjects.worker)).toBeTruthy();
    const worker = await page.evaluate(() => window.__tutorial?.snapshot().subjects.worker);
    expect(worker).toBeTruthy();
    await page.getByTestId(`node-${worker}`).dblclick();
    await page.getByTestId("inspector-field-label").fill("My corrected worker");
    await page.keyboard.press("Enter");
    const before = await page.evaluate(() => window.__tutorial?.diagram());
    held.release();
    await page.unrouteAll({ behavior: "wait" });
    // Flush the request and any already loaded parser before comparing content.
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    expect(await page.evaluate(() => window.__tutorial?.diagram())).toEqual(before);
    await expect(page.getByTestId(`node-${worker}`)).toContainText("My corrected worker");
    await expectNothingSaved(page);
  });

  test(`tutorial parser chunk: ${entry} failure reaches Retry through the real import bridge`, async ({ page }) => {
    if (entry === "Continue")
      await page.addInitScript(() =>
        localStorage.setItem(
          "diagrams.tutorials.v1",
          JSON.stringify({ progress: { "import-and-review": { version: 1, step: 1, completed: false } } }),
        ),
      );
    const parser = chunk("pipeline", "src/interop/infra/pipeline.ts");
    const held = await holdChunk(page, parser);
    await openTutorial(page, "import-and-review");
    await page.getByTestId("tutorial-start").click();
    if (entry === "Skip") await page.getByTestId("tutorial-skip").click();
    await expect.poll(held.requested).toBe(true);
    await expect(page.getByTestId("tutorial-retry")).toHaveCount(0);
    held.fail = true;
    held.release();
    await expect(page.getByTestId("tutorial-retry")).toBeVisible();
    await expectNothingSaved(page);
  });
}

test("library-reuse: Continue at Redo restores a real redo stack", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "diagrams.tutorials.v1",
      JSON.stringify({ progress: { "library-reuse": { version: 1, step: 4, completed: false } } }),
    ),
  );
  await openTutorial(page, "library-reuse");
  await page.getByTestId("tutorial-start").click();
  await expect(strip(page)).toHaveAttribute("data-step", "redo");
  expect(await page.evaluate(() => window.__tutorial?.diagram()?.nodes.map((node) => node.label))).not.toContain(
    "Status notifier",
  );
  await expect(page.getByTestId("redo-button")).toBeEnabled();
  await play(page, { history: "redo" });
  await expect(strip(page)).toHaveAttribute("data-step", "keep");
  expect(await page.evaluate(() => window.__tutorial?.diagram()?.nodes.map((node) => node.label))).toContain(
    "Status notifier",
  );
  await expectNothingSaved(page);
});

test("library-reuse: closing Your diagrams focuses the completion heading", async ({ page }) => {
  await openTutorial(page, "library-reuse");
  await page.getByTestId("tutorial-start").click();
  while ((await strip(page).getAttribute("data-step")) !== "keep") {
    const current = await strip(page).getAttribute("data-step");
    await page.getByTestId("tutorial-skip").click();
    await expect(strip(page)).not.toHaveAttribute("data-step", current ?? "");
  }
  await page.getByTestId("tutorial-save-copy").click();
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-library").click();
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tutorial-handoff-heading")).toBeFocused();
});

test("tutorial sandbox privacy: Restart discards Undo and Redo and begins public", async ({ page }) => {
  await openTutorial(page, "import-and-review");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("import-input").setInputFiles({
    name: "private-practice.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...importedDiagram, private: true })),
  });
  await expect(page.getByTestId("node-imported-api")).toBeVisible();
  await page.getByTestId("tutorial-restart").click();
  await expect(page.getByTestId("node-imported-api")).toHaveCount(0);
  await expect(page.getByTestId("undo-button")).toBeDisabled();
  await expect(page.getByTestId("redo-button")).toBeDisabled();
  await page.getByTestId("canvas-view").focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("node-imported-api")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__tutorial?.aiAllowed())).toBe(true);
  await openShareChooser(page);
  await expect(page.getByTestId("share-private-note")).toHaveCount(0);
  await page.getByTestId("share-public-toggle").click();
  await expect(page.getByTestId("share-option-link")).toBeVisible();
  await expectNothingSaved(page);
});

test("tutorial sandbox privacy: on-device permission stays in memory and resets with practice", async ({ page }) => {
  await openTutorial(page, "import-and-review");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("import-input").setInputFiles({
    name: "private-practice.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...importedDiagram, private: true })),
  });
  await expect(page.getByTestId("node-imported-api")).toBeVisible();
  // Tutorials do not mount AiMount. Exercise the actual canvas callback used by its checkbox.
  await page.evaluate(() => window.__tutorial?.allowOnDevice(true));
  await expect.poll(() => page.evaluate(() => window.__tutorial?.onDeviceAllowed())).toBe(true);
  await page.evaluate(() => window.__tutorial?.allowOnDevice(false));
  await expect.poll(() => page.evaluate(() => window.__tutorial?.onDeviceAllowed())).toBe(false);
  await page.evaluate(() => window.__tutorial?.allowOnDevice(true));
  await expect.poll(() => page.evaluate(() => window.__tutorial?.onDeviceAllowed())).toBe(true);
  await page.getByTestId("tutorial-restart").click();
  await page.getByTestId("import-input").setInputFiles({
    name: "private-practice.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...importedDiagram, private: true })),
  });
  await expect(page.getByTestId("node-imported-api")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__tutorial?.onDeviceAllowed())).toBe(false);
  await expectNothingSaved(page);
});

test("tutorial sandbox privacy: a public-only lesson keeps sharing and exports public", async ({ page }) => {
  await openTutorial(page, "import-and-review");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("import-input").setInputFiles({
    name: "public-practice.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(importedDiagram)),
  });
  await expect(page.getByTestId("node-imported-api")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__tutorial?.aiAllowed())).toBe(true);
  await openShareChooser(page);
  await expect(page.getByTestId("share-private-note")).toHaveCount(0);
  await page.getByTestId("share-public-toggle").click();
  await expect(page.getByTestId("share-option-link")).toBeVisible();
  await page.keyboard.press("Escape");
  const pending = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+s");
  const path = await (await pending).path();
  if (!path) throw new Error("Expected a public diagram export");
  expect(JSON.parse(readFileSync(path, "utf8"))).not.toHaveProperty("private");
  await expectNothingSaved(page);
});

for (const [id, steps] of [
  ["resource-headroom", ["assumptions", "ceiling", "predict", "backlog", "replicas", "replay", "demand", "revised"]],
  ["sequence-evidence", ["live", "trace", "sequence", "export", "limits"]],
  ["author-a-simulation", ["burst", "note", "save", "pause", "continue", "result", "replay"]],
] as const)
  for (let index = 1; index < steps.length; index++)
    test(`batch4 Continue: ${id} at ${steps[index]} remains completable through the real UI`, async ({
      page,
      consoleErrors,
    }) => {
      test.slow();
      await page.addInitScript(
        ({ id, index }) =>
          localStorage.setItem(
            "diagrams.tutorials.v1",
            JSON.stringify({ progress: { [id]: { version: 1, step: index, completed: false } } }),
          ),
        { id, index },
      );
      await openTutorial(page, id);
      await expect(page.getByTestId("tutorial-start")).toContainText("Continue");
      await page.getByTestId("tutorial-start").click();
      await expect(strip(page)).toHaveAttribute("data-step", steps[index]);
      await expect(strip(page)).toHaveAttribute("data-state", "active");
      await finishSolution(page);
      await expectNothingSaved(page);
      expectNoErrors(consoleErrors);
    });

async function skipToCheckpoint(page: Page, target: string) {
  const count = await page.evaluate(() => window.__tutorial?.snapshot().state.stepIds.length ?? 0);
  for (let step = 0; step < count; step++) {
    const current = await strip(page).getAttribute("data-step");
    if (current === target) return;
    await page.getByTestId("tutorial-skip").click();
    await expect(strip(page)).not.toHaveAttribute("data-step", current ?? "");
  }
  throw new Error(`Did not reach checkpoint ${target}`);
}

for (const [id, target] of [
  ["trace-slowmo", "slowmo"],
  ["sequence-evidence", "trace"],
] as const)
  test(`${id}: its tracing solution recovers after the saved traffic has ended`, async ({ page, consoleErrors }) => {
    test.slow();
    await openTutorial(page, id);
    await page.getByTestId("tutorial-start").click();
    await skipToCheckpoint(page, target);
    const timeline = page.getByTestId("live-timeline-input");
    await timeline.focus();
    await page.keyboard.press("End");
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "done");
    await finishSolution(page);
    expectNoErrors(consoleErrors);
  });

test("author-a-simulation: real Save Undo returns to authoring and the preserved definition can be saved again", async ({
  page,
  consoleErrors,
}) => {
  test.slow();
  await openTutorial(page, "author-a-simulation");
  await page.getByTestId("tutorial-start").click();
  await skipToCheckpoint(page, "save");
  for (const action of await page.evaluate(() => window.__tutorial?.solution() ?? [])) await play(page, action);
  await expect(strip(page)).toHaveAttribute("data-step", "pause");
  await expect(page.getByTestId("sim-panel")).toBeVisible();
  await page.getByTestId("undo-button").click();
  await expect(strip(page)).toHaveAttribute("data-step", "save");
  expect(await page.evaluate(() => window.__tutorial?.diagram()?.simulations ?? [])).toHaveLength(0);
  await expect(page.getByTestId("sim-panel-expectation-0-value")).toHaveValue("10");
  await page.getByTestId("sim-panel-save").click();
  await expect(strip(page)).toHaveAttribute("data-step", "pause");
  await finishSolution(page);
  await expectNothingSaved(page);
  expectNoErrors(consoleErrors);
});

test("author-a-simulation: saving an already-run matching draft still launches a fresh saved experiment", async ({
  page,
  consoleErrors,
}) => {
  test.slow();
  await openTutorial(page, "author-a-simulation");
  await page.getByTestId("tutorial-start").click();
  await skipToCheckpoint(page, "save");
  for (const action of await page.evaluate(() => window.__tutorial?.solution() ?? [])) {
    if ("click" in action && action.click === "sim-panel-save") break;
    await play(page, action);
  }
  await page.getByTestId("sim-panel-run").click();
  await expect(strip(page)).toHaveAttribute("data-step", "save");
  expect(await page.evaluate(() => window.__tutorial?.diagram()?.simulations ?? [])).toHaveLength(0);
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-edit-sims").click();
  await expect(page.getByTestId("sim-panel-expectation-0-value")).toHaveValue("10");
  await page.getByTestId("sim-panel-save").click();
  await expect(strip(page)).toHaveAttribute("data-step", "pause");
  await finishSolution(page);
  await expectNothingSaved(page);
  expectNoErrors(consoleErrors);
});

test("resource-headroom: real replica Undo returns to the edit and the replay remains completable", async ({
  page,
  consoleErrors,
}) => {
  test.slow();
  await openTutorial(page, "resource-headroom");
  await page.getByTestId("tutorial-start").click();
  await skipToCheckpoint(page, "replicas");
  for (const action of await page.evaluate(() => window.__tutorial?.solution() ?? [])) await play(page, action);
  await expect(strip(page)).toHaveAttribute("data-step", "replay");
  await page.getByTestId("undo-button").click();
  await expect(strip(page)).toHaveAttribute("data-step", "replicas");
  expect(
    await page.evaluate(
      () => window.__tutorial?.diagram()?.nodes.find((node) => node.id === "worker")?.props?.replicas,
    ),
  ).toBe(1);
  await finishSolution(page);
  await expectNothingSaved(page);
  expectNoErrors(consoleErrors);
});

test("trace-slowmo: Continue at exit keeps the reconstructed run in Live", async ({ page, consoleErrors }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "diagrams.tutorials.v1",
      JSON.stringify({ progress: { "trace-slowmo": { version: 2, step: 6, completed: false } } }),
    ),
  );
  await openTutorial(page, "trace-slowmo");
  await page.getByTestId("tutorial-start").click();
  await expect(strip(page)).toHaveAttribute("data-step", "exit");
  await expect(strip(page)).toHaveAttribute("data-state", "active");
  expect(await page.evaluate(() => window.__tutorial?.snapshot().selected)).toEqual([]);
  const actions = await page.evaluate(() => window.__tutorial?.keyboardSolution() ?? []);
  for (const action of actions) {
    if (!("press" in action)) throw new Error("Expected the Escape route");
    await page.keyboard.press(action.press);
    await animationFrames(page);
    if ((await strip(page).getAttribute("data-phase")) === "finished") break;
  }
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  await expect(page.getByTestId("live-toggle")).toHaveAttribute("aria-pressed", "true");
  await expectNothingSaved(page);
  expectNoErrors(consoleErrors);
});

async function retrySequenceDownload(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByTestId("sequence-export-retry").click();
  const file = await download;
  // A completed file alone doesn't establish that the keyboard is back in the dialog.
  await expect(page.getByTestId("sequence-download-svg")).toBeFocused();
  return file;
}

test("batch4 Sequence: failed download stays current; Retry writes the same trace's SVG bytes", async ({
  page,
  consoleErrors,
}) => {
  await page.clock.install();
  await openTutorial(page, "sequence-evidence");
  await page.getByTestId("tutorial-start").click();
  for (const current of ["live", "trace", "sequence"]) {
    await expect(strip(page)).toHaveAttribute("data-step", current);
    for (const action of await page.evaluate(() => window.__tutorial?.solution() ?? [])) await play(page, action);
    await expect(strip(page)).not.toHaveAttribute("data-step", current);
  }
  await expect(strip(page)).toHaveAttribute("data-step", "export");
  const root = await page.getByTestId("trace-card").getAttribute("data-root");
  if (!root) throw new Error("Expected the traced root identity");
  await expect(page.getByTestId("sequence-view")).toHaveAttribute("data-trace", root);
  const before = await page.getByTestId("sequence-messages").textContent();
  if (!before) throw new Error("Expected sequence messages");
  await page.evaluate(() => {
    const original = HTMLAnchorElement.prototype.click;
    const url = URL.createObjectURL;
    const capture = window as Window & { sequenceBlob?: Blob; restoreSequence(): void };
    URL.createObjectURL = (blob) => {
      if (blob instanceof Blob && blob.type === "image/svg+xml") capture.sequenceBlob = blob;
      return url(blob);
    };
    HTMLAnchorElement.prototype.click = function () {
      if (this.download.endsWith("-sequence.svg")) throw new Error("Download refused by test");
      original.call(this);
    };
    capture.restoreSequence = () => {
      HTMLAnchorElement.prototype.click = original;
    };
  });
  await page.getByTestId("sequence-download-svg").click();
  await expect(page.getByTestId("sequence-export-retry")).toBeVisible();
  await expect(strip(page)).toHaveAttribute("data-step", "export");
  await page.evaluate(() => (window as Window & { restoreSequence(): void }).restoreSequence());
  await pauseClock(page);
  let file;
  try {
    file = await retrySequenceDownload(page);
    await expect(page.getByTestId("sequence-export-retry")).toHaveCount(0);
    // #413 returns focus in the Retry event: Escape must work even while animation frames are paused.
    await expect(strip(page)).toHaveAttribute("data-step", "limits");
    await expect(page.getByTestId("sequence-messages")).toHaveText(before);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sequence-dialog")).toHaveCount(0);
    await expect(page.getByTestId("trace-card")).toHaveAttribute("data-root", root);
  } finally {
    await page.clock.resume();
  }
  expect(await file.failure()).toBeNull();
  const bytes = readFileSync(await file.path(), "utf8");
  const captured = await page.evaluate(() => (window as Window & { sequenceBlob?: Blob }).sequenceBlob?.text());
  expect(bytes).toBe(captured);
  expect(bytes).toContain("Storefront");
  expect(bytes).toContain('data-testid="seq-participant-orders"');
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-phase", "finished");
  await expectNothingSaved(page);
  expectNoErrors(consoleErrors);
});

for (const sample of [
  { id: "resource-headroom", locale: "en", width: 1440, height: 900, dark: false },
  { id: "sequence-evidence", locale: "en", width: 1440, height: 900, dark: true },
  { id: "author-a-simulation", locale: "en-XA", width: 390, height: 844, dark: false },
  { id: "trace-slowmo", locale: "ar", width: 780, height: 390, dark: true },
])
  test(`batch4 readability: ${sample.id} ${sample.locale} ${sample.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: sample.width, height: sample.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(({ locale, dark }) => {
      localStorage.setItem("diagrams.locale", locale);
      localStorage.setItem(
        "diagrams.settings.v1",
        JSON.stringify({ theme: dark ? "dark" : "light", themePreference: dark ? "dark" : "light" }),
      );
    }, sample);
    await openTutorial(page, sample.id);
    await page.getByTestId("tutorial-start").click();
    await page.getByTestId("tutorial-show-me").click();
    for (const id of ["tutorial-exit", "tutorial-skip", "tutorial-show-me"])
      await expect(page.getByTestId(id)).toBeInViewport();
    await expectNoViolations(page, "tutorial-app");
    const destination = process.env.TUTORIAL_SCREENSHOTS;
    if (destination) mkdirSync(destination, { recursive: true });
    await page.screenshot({
      path: destination
        ? join(destination, `${sample.id}-${sample.locale}-${sample.width}.png`)
        : testInfo.outputPath(`${sample.id}-${sample.locale}-${sample.width}.png`),
    });
  });

for (const outcome of ["Retry", "Close"] as const)
  test(`batch4 Sequence load: ${outcome} preserves a completable lesson`, async ({ page, consoleErrors }) => {
    const held = await holdChunk(page, chunk("SequenceDialog", "src/live/SequenceDialog.tsx"));
    await openTutorial(page, "sequence-evidence");
    await page.getByTestId("tutorial-start").click();
    for (const current of ["live", "trace"]) {
      await expect(strip(page)).toHaveAttribute("data-step", current);
      for (const action of await page.evaluate(() => window.__tutorial?.solution() ?? [])) await play(page, action);
      await expect(strip(page)).not.toHaveAttribute("data-step", current);
    }
    await page.getByTestId("trace-sequence").click();
    await expect.poll(held.requested).toBe(true);
    await expect(page.getByTestId("lazy-dialog")).toBeVisible();
    await expect(strip(page)).toHaveAttribute("data-step", "sequence");
    if (outcome === "Retry") {
      const errorsBefore = consoleErrors.length;
      held.fail = true;
      held.release();
      await expect(page.getByTestId("lazy-dialog-error")).toBeVisible();
      expect(consoleErrors.slice(errorsBefore)).toEqual(["console.error: Failed to load resource: net::ERR_FAILED"]);
      consoleErrors.splice(errorsBefore, 1);
      await expect(strip(page)).toHaveAttribute("data-step", "sequence");
      held.fail = false;
      await page.getByTestId("lazy-dialog-retry").click();
      await expect(page.getByTestId("sequence-dialog")).toBeVisible();
      await expect(strip(page)).toHaveAttribute("data-step", "export");
      await finishSolution(page);
    } else {
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("lazy-dialog")).toHaveCount(0);
      held.release();
      await expect(page.getByTestId("sequence-dialog")).toHaveCount(0);
      await expect(strip(page)).toHaveAttribute("data-step", "sequence");
      await finishSolution(page);
    }
    await expectNothingSaved(page);
    expectNoErrors(consoleErrors);
  });

for (const wrong of ["target", "time"] as const)
  test(`author-a-drill: Skip repairs a saved wrong-${wrong} near miss`, async ({ page, consoleErrors }) => {
    await openTutorial(page, "author-a-drill");
    await page.getByTestId("tutorial-start").click();
    for (const current of ["live", "open"]) {
      await expect(strip(page)).toHaveAttribute("data-step", current);
      for (const action of await page.evaluate(() => window.__tutorial?.solution() ?? [])) await play(page, action);
      await expect(strip(page)).not.toHaveAttribute("data-step", current);
    }
    for (const action of await page.evaluate(() => window.__tutorial?.solution() ?? [])) {
      if ("select" in action && action.select === "sim-panel-step-0-fault-target" && wrong === "target") continue;
      if ("click" in action && action.click === "sim-panel-section-details" && wrong === "time")
        await page.getByTestId("sim-panel-step-0-time").fill("1");
      await play(page, action);
    }
    await expect(strip(page)).toHaveAttribute("data-step", "save");
    await page.getByTestId("tutorial-skip").click();
    await expect(strip(page)).toHaveAttribute("data-step", "run");
    const sim = await page.evaluate(() =>
      window.__tutorial?.diagram()?.simulations?.find((sim) => sim.id === "simulation"),
    );
    expect(sim?.timeline).toEqual([
      { atMs: 0, action: { do: "fault", drill: "slow-dependency", fault: { kind: "slow", node: "db", factor: 5 } } },
    ]);
    await finishSolution(page);
    expectNoErrors(consoleErrors);
  });

test("author-a-simulation: a second expectation survives removing the first and completes result and replay", async ({
  page,
  consoleErrors,
}) => {
  test.slow();
  await openTutorial(page, "author-a-simulation");
  await page.getByTestId("tutorial-start").click();
  await skipToCheckpoint(page, "save");
  for (const action of await page.evaluate(() => window.__tutorial?.solution() ?? [])) {
    if ("click" in action && action.click === "sim-panel-save") break;
    if ("click" in action && action.click === "sim-panel-add-expectation") {
      await play(page, action);
      await play(page, action);
      await page.getByTestId("sim-panel-expectation-0-remove").click();
    } else await play(page, action);
  }
  await page.getByTestId("sim-panel-save").click();
  await expect(strip(page)).toHaveAttribute("data-step", "pause");
  const saved = await page.evaluate(() => window.__tutorial?.runs().saved.find((sim) => sim.id === "simulation"));
  expect(saved?.expectations).toHaveLength(1);
  expect(saved?.expectations?.[0].id).toBe("check-2");
  await finishSolution(page);
  expectNoErrors(consoleErrors);
});

for (const route of ["Right arrow", "Skip"] as const)
  test(`trace-slowmo: ${route} completes the hop when playback finished during Pause`, async ({
    page,
    consoleErrors,
  }) => {
    await openTutorial(page, "trace-slowmo");
    await page.getByTestId("tutorial-start").click();
    await skipToCheckpoint(page, "pause");
    // Seek to the end while still playing, just as the playback clock reaching the end does.
    await page.getByTestId("slowmo-timeline-input").focus();
    await page.keyboard.press("End");
    await expect(strip(page)).toHaveAttribute("data-step", "hop");
    await expect(page.getByTestId("slowmo-timeline-input")).toHaveValue("0");
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-playing", "0");
    // Finish the seek's camera work before testing a hop; the following checkpoint teaches manual pan.
    await page.getByTestId("live-view-menu").click();
    await page.getByTestId("view-follow").click();
    await waitForCameraIdle(page);
    await expect(page.getByTestId("live-view-menu")).toContainText("Following");
    if (route === "Skip") await page.getByTestId("tutorial-skip").click();
    else {
      await page.getByTestId("live-play").focus();
      await page.keyboard.press("ArrowRight");
    }
    await expect(strip(page)).toHaveAttribute("data-step", "camera");
    expectNoErrors(consoleErrors);
  });

test("where-time-goes: a late reader can still inspect the held waiting comparison", async ({
  page,
  consoleErrors,
}) => {
  await page.clock.install();
  await openTutorial(page, "where-time-goes");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-step", "run");
  for (const action of await page.evaluate(() => window.__tutorial?.solution() ?? [])) await play(page, action);
  await page.getByTestId("tutorial-step").hover();
  await pauseClock(page);
  await advanceTutorialClock(
    page,
    async () => (await page.getByTestId("live-canvas").getAttribute("data-sim-time")) === "9000",
  );
  await page.clock.fastForward(20000);
  await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-sim-time", "9000");
  await expect(page.getByTestId("live-note-continue")).toBeVisible();
  await page.clock.resume();
  await hoverPractice(page, "node-billing");
  await expect(strip(page)).toHaveAttribute("data-step", "read-breakdown");
  await finishSolution(page);
  expectNoErrors(consoleErrors);
});
