import { readFileSync } from "node:fs";
import { openDiagramProperties } from "./fixtures";
import { holdChunk, releaseAndEvaluate } from "./chunk";
import { chunk } from "./chunk";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, gotoLive, expectNoErrors, waitForStableViewport } from "./fixtures";
import { MOD, SLUG } from "./ai-helpers";

// Code that loads on use (src/lib/lazyLoad.tsx): while it downloads, and when the download fails, what
// stands in for it stays usable, and the person's intent holds until it arrives.

const LIBRARY = chunk("LibraryDialog", "src/components/LibraryDialog.tsx");
const DIALOGS = chunk("dialogs", "src/interop/ui/dialogs.tsx");
const SESSION = chunk("LiveSession", "src/live/LiveSession.tsx");
const MESSAGES = chunk("fileMessages", "src/interop/ui/fileMessages.ts");
const SHORTCUTS = chunk("ShortcutsDialog", "src/components/ShortcutsDialog.tsx");

test("a pending custom injection is modal, cancellable and returns focus to its node", async ({ page }) => {
  const dialogChunk = chunk("InjectDialog", "src/live/InjectDialog.tsx");
  const download = await gate(page, dialogChunk);
  await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1&paused=1`);
  await waitForStableViewport(page);
  await page.getByTestId("node-payments").click({ button: "right" });
  await page.getByTestId("context-menu-item-sim.inject").click();
  await page.getByTestId("context-menu-item-sim.inject:custom").click();
  await expect.poll(download.requested).toBe(true);
  await expect(page.getByTestId("inject-loading")).toHaveAttribute("aria-modal", "true");
  await expect(page.getByTestId("inject-loading-status")).toHaveAttribute("role", "status");
  expect(await page.getByTestId("live-play").evaluate((el) => !!el.closest("[inert]"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("inject-loading")).toHaveCount(0);
  expect(await page.getByTestId("node-payments").evaluate((el) => el.parentElement === document.activeElement)).toBe(
    true,
  );
  const response = page.waitForResponse((r) => dialogChunk.test(r.url()));
  download.release();
  await (await response).finished();
  await settle(page);
  await expect(page.getByTestId("live-inject-dialog")).toHaveCount(0);
  await expect(page.getByTestId("live-hud")).toBeVisible();
});

test("capacity callouts download without blocking Live or its heat map", async ({ page, consoleErrors }) => {
  const callout = await gate(page, chunk("BottleneckCallout", "src/live/BottleneckCallout.tsx"));
  await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1&paused=1`);
  await page.getByTestId("view-button").click();
  await page.getByTestId("capacity-overlay-toggle").click();
  await expect.poll(callout.requested).toBe(true);
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await expect(page.getByTestId("capacity-label-payments")).toBeVisible();
  await expect(page.getByTestId("bottleneck-callout")).toHaveCount(0);
  const processed = () => page.getByTestId("node-badge-payments").getAttribute("data-processed").then(Number);
  const before = await processed();
  await page.getByTestId("live-play").click();
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
  await expect.poll(processed).toBeGreaterThan(before);
  await page.getByTestId("live-play").click();
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
  callout.release();
  await expect(page.getByTestId("bottleneck-callout")).toBeVisible();
  expectNoErrors(consoleErrors);
});

test("delayed narration keeps keyboard focus in an open presentation menu", async ({ page, consoleErrors }) => {
  const narration = await gate(page, chunk("NoteCallout", "src/live/NoteCallout.tsx"));
  await gotoLive(page, `./?view=canvas&example=${SLUG}&sim=payments-outage&speed=8&paused=1`);
  await page.getByTestId("present-toggle").click();
  await page.getByTestId("live-play").click();
  await expect.poll(narration.requested).toBe(true);
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "waiting");
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-more-menu").focus();
  await page.keyboard.press("ArrowDown");
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  if (!focused) throw new Error("No menu item has keyboard focus");
  expect(focused).not.toBe("live-more-menu");
  await expect(page.getByTestId(focused)).toBeFocused();
  narration.release();
  await expect(page.getByTestId("live-note-continue")).toBeVisible();
  await expect(page.getByTestId(focused)).toBeFocused();
  await page.keyboard.press("Escape");
  await page.getByTestId("live-note-continue").click();
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
  expectNoErrors(consoleErrors);
});

test("a failed narration download offers Retry and preserves Continue", async ({ page }) => {
  const narration = await gate(page, chunk("NoteCallout", "src/live/NoteCallout.tsx"));
  narration.fail = true;
  await gotoLive(page, `./?view=canvas&example=${SLUG}&sim=payments-outage&speed=8`);
  await expect(page.getByTestId("toast")).toContainText("Part of the app couldn't be downloaded");
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "waiting");
  await expect(page.getByTestId("live-note")).toHaveCount(0);
  narration.fail = false;
  narration.release();
  await page.getByTestId("lazy-load-retry").click();
  await expect(page.getByTestId("live-note-continue")).toBeVisible();
  await page.getByTestId("live-note-continue").click();
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
});

test("a waiting narration keeps its Continue action after its download", async ({ page, consoleErrors }) => {
  const narration = await gate(page, chunk("NoteCallout", "src/live/NoteCallout.tsx"));
  await gotoLive(page, `./?view=canvas&example=${SLUG}&sim=payments-outage&speed=8`);
  await expect.poll(narration.requested).toBe(true);
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "waiting");
  await expect(page.getByTestId("live-note")).toHaveCount(0);
  narration.release();
  await expect(page.getByTestId("live-note-continue")).toBeVisible();
  await page.getByTestId("live-note-continue").click();
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
  expectNoErrors(consoleErrors);
});

for (const failed of [false, true]) {
  for (const action of ["save", "download"] as const) {
    test(`${action} completes while operation messages are ${failed ? "failed" : "pending"}`, async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: undefined });
      });
      const messages = await gate(page, MESSAGES);
      messages.fail = failed;
      await gotoCanvas(page, SLUG);
      const downloaded = page.waitForEvent("download");
      if (action === "save") await page.keyboard.press(`${MOD}+s`);
      else {
        await page.getByTestId("file-button").click();
        await page.getByTestId("file-share").click();
        await page.getByTestId("share-option-file").click();
      }
      expect((await downloaded).suggestedFilename()).toBe(`${SLUG}.diagram.json`);
      await expect.poll(messages.requested).toBe(true);
      if (!failed) messages.release();
      await settle(page);
      await expect(page.getByTestId("toast").filter({ hasText: "Couldn't" })).toHaveCount(0);
    });
  }
  for (const action of ["open", "save"] as const) {
    test(`native ${action} keeps user activation while messages are ${failed ? "failed" : "pending"}`, async ({
      page,
    }) => {
      await page.addInitScript(() => {
        const state = { active: false, calls: 0, writes: 0 };
        Object.assign(window, { __coldPicker: state });
        Object.defineProperty(window, "showOpenFilePicker", {
          configurable: true,
          value: async () => {
            state.active = navigator.userActivation.isActive;
            state.calls++;
            return [];
          },
        });
        Object.defineProperty(window, "showSaveFilePicker", {
          configurable: true,
          value: async () => {
            state.active = navigator.userActivation.isActive;
            state.calls++;
            return {
              kind: "file",
              name: "saved.diagram.json",
              createWritable: async () => ({
                write: async () => {
                  state.writes++;
                },
                close: async () => {},
              }),
            };
          },
        });
      });
      const messages = await gate(page, MESSAGES);
      messages.fail = failed;
      await gotoCanvas(page, SLUG);
      await page.keyboard.press(`${MOD}+${action === "open" ? "o" : "s"}`);
      const state = () =>
        page.evaluate(
          () => (window as Window & { __coldPicker: { active: boolean; calls: number; writes: number } }).__coldPicker,
        );
      await expect.poll(async () => (await state()).calls).toBe(1);
      expect((await state()).active).toBe(true);
      if (action === "save") await expect.poll(async () => (await state()).writes).toBe(1);
      await expect.poll(messages.requested).toBe(true);
      if (!failed) messages.release();
      await settle(page);
      await expect(page.getByTestId("toast").filter({ hasText: "Couldn't" })).toHaveCount(0);
    });
  }
}

for (const cancel of ["cancel", "escape"] as const) {
  test(`a valid paste ${cancel === "cancel" ? "cancelled" : "closed with Esc"} while messages download never imports`, async ({
    page,
    consoleErrors,
  }) => {
    const messages = await gate(page, MESSAGES);
    await gotoCanvas(page, SLUG);
    const before = await page.evaluate(() => localStorage.getItem("diagrams.library.v1"));
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-import-from").click();
    await page.getByTestId("import-paste").click();
    await page
      .getByTestId("paste-input")
      .fill(JSON.stringify({ format: "diagrams/v1", title: "Cancelled import", nodes: [], edges: [] }));
    await page.getByTestId("paste-submit").click();
    await expect.poll(messages.requested).toBe(true);
    if (cancel === "cancel") await page.getByTestId("paste-cancel").click();
    else await page.keyboard.press("Escape");
    await expect(page.getByTestId("paste-dialog")).toHaveCount(0);
    const downloaded = page.waitForResponse((response) => MESSAGES.test(response.url()));
    messages.release();
    await (await downloaded).finished();
    await settle(page);
    await expect(page.getByTestId("node-payments")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("diagrams.library.v1"))).toBe(before);
    expectNoErrors(consoleErrors);
  });
}

/** Holds every request for `pattern` until release(); `fail` aborts them while it's true. */
async function gate(page: Page, pattern: RegExp) {
  let held = false;
  let release!: () => void;
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  const control = { fail: false, hold: true, requested: () => held, release };
  await page.route(pattern, async (route) => {
    held = true;
    if (control.fail) return route.abort("failed");
    if (control.hold) await open;
    await route.continue();
  });
  return control;
}

/** Two paints, so a download that just finished has rendered whatever it was going to. */
const settle = (page: Page) =>
  page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );

async function openLibrary(page: Page) {
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-library").click();
}

test("the shortcuts sheet's failed download stays in its dialog: Retry, Close, Escape, focus back", async ({
  page,
}) => {
  const sheet = await gate(page, SHORTCUTS);
  sheet.fail = true;
  await gotoCanvas(page, SLUG);
  const button = page.getByTestId("shortcuts-button");
  await button.click();
  await expect(page.getByTestId("lazy-dialog-error")).toBeVisible();
  // The canvas is still there behind it, not the app's reload screen.
  await expect(page.getByTestId("node-payments")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lazy-dialog")).toHaveCount(0);
  await expect(button).toBeFocused();
  await button.click();
  await expect(page.getByTestId("lazy-dialog-error")).toBeVisible();
  await page.getByTestId("lazy-dialog-cancel").click();
  await expect(page.getByTestId("lazy-dialog")).toHaveCount(0);
  // Back online: Retry in the same dialog opens the sheet.
  await button.click();
  await expect(page.getByTestId("lazy-dialog-error")).toBeVisible();
  sheet.fail = false;
  sheet.hold = false;
  await page.getByTestId("lazy-dialog-retry").click();
  await expect(page.getByTestId("shortcuts-dialog")).toBeVisible();
  await expect(page.getByTestId("lazy-dialog")).toHaveCount(0);
});

test("the shortcuts sheet's Retry keeps focus in its frame: Escape closes it while the download is pending", async ({
  page,
}) => {
  const sheet = await gate(page, SHORTCUTS);
  sheet.fail = true;
  await gotoCanvas(page, SLUG);
  await page.getByTestId("shortcuts-button").click();
  await expect(page.getByTestId("lazy-dialog-error")).toBeVisible();
  // Online again, but the download is held: Retry by keyboard, and it's loading.
  sheet.fail = false;
  await page.getByTestId("lazy-dialog-retry").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("lazy-dialog-loading")).toBeVisible();
  await expect(page.getByTestId("lazy-dialog")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lazy-dialog")).toHaveCount(0);
  await expect(page.getByTestId("shortcuts-button")).toBeFocused();
  sheet.release();
});

test.describe("a dialog whose download fails", () => {
  test("says so in its frame, and Retry opens it without reloading", async ({ page }) => {
    const library = await gate(page, LIBRARY);
    library.fail = true;
    await gotoCanvas(page, SLUG);
    await openLibrary(page);
    await expect(page.getByTestId("lazy-dialog-error")).toBeVisible();
    await expect(page.getByTestId("lazy-dialog-retry")).toBeVisible();
    // The canvas behind is intact.
    await expect(page.getByTestId("node-payments")).toBeVisible();
    library.fail = false;
    library.hold = false;
    await page.getByTestId("lazy-dialog-retry").click();
    await expect(page.getByTestId("library-dialog")).toBeVisible();
    await expect(page.getByTestId("lazy-dialog")).toHaveCount(0);
  });

  test("closes with Esc or Close, and opening it again retries", async ({ page }) => {
    const library = await gate(page, LIBRARY);
    library.fail = true;
    await gotoCanvas(page, SLUG);
    await openLibrary(page);
    await expect(page.getByTestId("lazy-dialog-error")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("lazy-dialog")).toHaveCount(0);
    await openLibrary(page);
    await expect(page.getByTestId("lazy-dialog-error")).toBeVisible();
    await page.getByTestId("lazy-dialog-cancel").click();
    await expect(page.getByTestId("lazy-dialog")).toHaveCount(0);
    // Back online: the same command opens it.
    library.fail = false;
    library.hold = false;
    await openLibrary(page);
    await expect(page.getByTestId("library-dialog")).toBeVisible();
  });
});

test("a dialog still downloading is a modal Esc cancels, and it never appears later", async ({
  page,
  consoleErrors,
}) => {
  const dialogs = await gate(page, DIALOGS);
  await gotoCanvas(page, SLUG);
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-import-from").click();
  await page.getByTestId("import-paste").click();
  await expect(page.getByTestId("lazy-dialog-loading")).toBeVisible();
  await expect(page.getByTestId("lazy-dialog")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lazy-dialog")).toHaveCount(0);

  const downloaded = page.waitForResponse((response) => DIALOGS.test(response.url()));
  dialogs.release();
  await (await downloaded).finished();
  await settle(page);
  await expect(page.getByTestId("paste-dialog")).toHaveCount(0);
  // Asked again, it opens at once.
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-import-from").click();
  await page.getByTestId("import-paste").click();
  await expect(page.getByTestId("paste-dialog")).toBeVisible();
  expectNoErrors(consoleErrors);
});

test("a privacy confirmation still downloading stays with its diagram", async ({ page, consoleErrors }) => {
  const dialogs = await gate(page, DIALOGS);
  await gotoCanvas(page, SLUG);
  const work = (title: string) => ({
    format: "diagrams/v1",
    title,
    private: true,
    nodes: [{ id: "intake", stencil: "generic.service", label: "Intake service", x: 0, y: 0 }],
    edges: [],
  });
  const open = async (title: string) => {
    await page.getByTestId("import-input").setInputFiles({
      name: "work.diagram.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(work(title))),
    });
    await expect(page.getByTestId("diagram-title")).toHaveText(title);
    await openDiagramProperties(page);
    await expect(page.getByTestId("private-badge")).toBeVisible();
  };
  await open("First private");
  await open("Second private");

  // Asked about the second; another diagram opens while the confirmation downloads.
  await openDiagramProperties(page);
  await page.getByTestId("private-badge").click();
  await expect(page.getByTestId("lazy-dialog-loading")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("diagram-title")).toHaveText("First private");
  await expect(page.getByTestId("lazy-dialog")).toHaveCount(0);

  const downloaded = page.waitForResponse((response) => DIALOGS.test(response.url()));
  dialogs.release();
  await (await downloaded).finished();
  await settle(page);
  // Nothing asks about (or turns off) the diagram now open, and both stay private.
  await expect(page.getByTestId("privacy-dialog")).toHaveCount(0);
  await openDiagramProperties(page);
  await expect(page.getByTestId("private-badge")).toBeVisible();
  await page.goForward();
  await expect(page.getByTestId("diagram-title")).toHaveText("Second private");
  await openDiagramProperties(page);
  await expect(page.getByTestId("private-badge")).toBeVisible();
  expectNoErrors(consoleErrors);
});

test("a simulation chosen while the live session downloads runs once it arrives", async ({ page, consoleErrors }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: undefined });
  });
  const session = await gate(page, SESSION);
  await gotoCanvas(page, SLUG);
  const toggle = page.getByTestId("live-toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect.poll(session.requested).toBe(true);
  await expect(toggle).toHaveAttribute("aria-busy", "true");
  await expect(toggle).toHaveCSS("cursor", "progress");
  await expect(toggle).toBeFocused();
  const exported = page.waitForEvent("download");
  await page.keyboard.press(`${MOD}+s`);
  const file = await exported;
  expect(JSON.parse(readFileSync(await file.path(), "utf8")).format).toBe("diagrams/v1");
  await expect(toggle).toBeFocused();
  await expect(page.getByTestId("live-hud")).toHaveCount(0);

  await page.keyboard.press(`${MOD}+k`);
  // "Black Friday" alone also names the Black Friday commerce example; this query names only the Kafka simulation.
  await page.getByTestId("command-input").fill("black friday 2,000 orders");
  await expect(page.getByTestId("command-item-sim:black-friday")).toBeVisible();
  await expect(page.locator('[data-testid^="command-item-"]').first()).toHaveAttribute(
    "data-testid",
    "command-item-sim:black-friday",
  );
  await page.keyboard.press("Enter");
  // Live view stays on while its code downloads.
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  session.release();
  await expect(page.getByTestId("live-hud")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-busy", "false");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("live-sim-picker")).toHaveValue("black-friday");
  expectNoErrors(consoleErrors);
});

test("Your diagrams waits for operation messages before offering library actions", async ({ page }) => {
  const messages = await gate(page, chunk("fileMessages", "src/interop/ui/fileMessages.ts"));
  messages.fail = true;
  await gotoCanvas(page, SLUG);
  await openLibrary(page);
  await expect(page.getByTestId("lazy-dialog-error")).toBeVisible();
  await expect(page.getByTestId("library-dialog")).toHaveCount(0);
  messages.fail = false;
  messages.hold = false;
  await page.getByTestId("lazy-dialog-retry").click();
  await expect(page.getByTestId("library-dialog")).toBeVisible();
});

test("an oversized import still reports a failed message download", async ({ page, consoleErrors }) => {
  const messages = await gate(page, chunk("fileMessages", "src/interop/ui/fileMessages.ts"));
  messages.fail = true;
  await gotoCanvas(page, SLUG);
  await page
    .getByTestId("import-input")
    .setInputFiles({ name: "oversized.diagram.json", mimeType: "application/json", buffer: Buffer.alloc(8_000_001) });
  await expect(page.getByTestId("toast")).toContainText("Couldn't download this part of the app");
  await expect(page.getByTestId("node-payments")).toBeVisible();
  // The request abort is deliberate; a pageerror would still expose an unhandled import rejection.
  expectNoErrors(consoleErrors.filter((error) => error !== "console.error: Failed to load resource: net::ERR_FAILED"));
});

test("failed discovery Retry is reachable by Tab and preserves filters through recovery", async ({ page }) => {
  const held = await holdChunk(page, chunk("ExampleDetails", "src/examples/ExampleDetails.tsx"));
  try {
    await gotoCanvas(page, "kafka-order-pipeline");
    await page.getByTestId("example-picker").click();
    await page.getByTestId("picker-browse-examples").click();
    await expect.poll(held.requested).toBe(true);
    await page.getByTestId("examples-search").fill("kafka order");
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("examples-feature")).toBeFocused();
    await page.getByTestId("examples-feature").selectOption("partitions");
    held.fail = true;
    held.release();
    await expect(page.getByTestId("lazy-load-retry")).toHaveCount(1);
    const retry = page.getByTestId("examples-dialog").getByTestId("examples-retry");
    await expect(retry).toBeVisible();
    // selectOption leaves focus on the feature control; Retry is the next stop in the modal.
    await page.keyboard.press("Tab");
    await expect(retry).toBeFocused();
    await page.keyboard.press("Enter");
    await expect
      .poll(() => page.evaluate(() => window.__lazySurfaces?.states()["examples.discovery"]?.state))
      .toBe("failed");
    await expect(page.getByTestId("examples-search")).toBeFocused();
    await expect(page.getByTestId("examples-search")).toHaveValue("kafka order");
    await expect(page.getByTestId("examples-feature")).toHaveValue("partitions");
    held.fail = false;
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(retry).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("example-thumb-kafka-order-pipeline")).toBeVisible();
    await expect(page.getByTestId("examples-search")).toHaveValue("kafka order");
    await expect(page.getByTestId("examples-feature")).toHaveValue("partitions");
    await expect(page.getByTestId("examples-search")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("example-picker")).toBeFocused();
    await page.getByTestId("example-picker").click();
    await page.getByTestId("picker-browse-examples").click();
    await page.getByTestId("examples-search").fill("kafka order");
    await expect(page.getByTestId("example-thumb-kafka-order-pipeline")).toBeVisible();
    await expect(page.getByTestId("examples-search")).toHaveValue("kafka order");
    await expect(page.getByTestId("examples-search")).toBeFocused();
    await page.getByTestId("examples-dialog-close").click();
    await expect(page.getByTestId("example-picker")).toBeFocused();
    await page.getByTestId("example-picker").click();
    await page.getByTestId("picker-browse-examples").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("example-picker")).toBeFocused();
  } finally {
    held.release();
  }
});

test("failed start-card discovery keeps the shared toast Retry", async ({ page }) => {
  const held = await holdChunk(page, chunk("ExampleDetails", "src/examples/ExampleDetails.tsx"));
  try {
    await page.goto("./");
    await expect.poll(held.requested).toBe(true);
    held.fail = true;
    held.release();
    const retry = page.getByTestId("lazy-load-retry");
    await expect(retry).toHaveCount(1);
    await expect(page.getByTestId("examples-dialog")).toHaveCount(0);
    held.fail = false;
    await retry.click();
    await expect(page.getByTestId("start-example-rag-assistant-thumb")).toBeVisible();
    await expect(page.getByTestId("start-card")).toBeVisible();
  } finally {
    held.release();
  }
});

for (const surface of ["TutorialApp", "TutorialsView"]) {
  test(`${surface} cancellation before release keeps preview navigation and focus`, async ({ page }) => {
    const pattern = chunk(surface, `src/tutorials/${surface}.tsx`);
    const held = await holdChunk(page, pattern);
    try {
      await page.goto("./");
      await expect(page.getByTestId("start-tutorial")).toBeVisible();
      if (surface === "TutorialApp") {
        await page.getByTestId("start-tutorial").click();
        await expect(page.getByTestId("tutorial-exit")).toBeVisible();
        await page.getByTestId("tutorial-exit").click();
      } else {
        await page.getByTestId("view-tutorials").click();
        await expect(page.getByTestId("tutorials-view-loading")).toBeVisible();
        await page.getByTestId("view-canvas").click();
      }
      await expect.poll(held.requested).toBe(true);
      await expect(page.getByTestId("start-card")).toBeVisible();
      await page.getByTestId("example-picker").focus();
      await releaseAndEvaluate(page, pattern, held.release);
      await expect(page.getByTestId("example-picker")).toBeFocused();
      await expect(page.getByTestId("tutorial-start")).toHaveCount(0);
      await expect(page.getByTestId("start-card")).toBeVisible();
    } finally {
      held.release();
    }
  });
}
