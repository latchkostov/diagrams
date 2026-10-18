import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors } from "./fixtures";
import { MOD, SLUG } from "./ai-helpers";

// Code that loads on use (src/lib/lazyLoad.tsx): while it downloads, and when the download fails, what
// stands in for it stays usable, and the person's intent holds until it arrives.

/** A chunk's production file, or its source module on the dev server. */
const chunk = (name: string, source: string) =>
  new RegExp(String.raw`/(?:assets/${name}-[A-Za-z0-9_-]+\.js|${source.replace(/\./g, "\\.")})(?:\?.*)?$`);
const LIBRARY = chunk("LibraryDialog", "src/components/LibraryDialog.tsx");
const DIALOGS = chunk("dialogs", "src/interop/ui/dialogs.tsx");
const SESSION = chunk("LiveSession", "src/live/LiveSession.tsx");
const MESSAGES = chunk("fileMessages", "src/interop/ui/fileMessages.ts");

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
    await expect(page.getByTestId("private-badge")).toBeVisible();
  };
  await open("First private");
  await open("Second private");

  // Asked about the second; another diagram opens while the confirmation downloads.
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
  await expect(page.getByTestId("private-badge")).toBeVisible();
  await page.goForward();
  await expect(page.getByTestId("diagram-title")).toHaveText("Second private");
  await expect(page.getByTestId("private-badge")).toBeVisible();
  expectNoErrors(consoleErrors);
});

test("a simulation chosen while the live session downloads runs once it arrives", async ({ page, consoleErrors }) => {
  const session = await gate(page, SESSION);
  await gotoCanvas(page, SLUG);
  const toggle = page.getByTestId("live-toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect.poll(session.requested).toBe(true);
  await expect(toggle).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("live-hud")).toHaveCount(0);

  await page.keyboard.press(`${MOD}+k`);
  await page.getByTestId("command-input").fill("black friday");
  await expect(page.getByTestId("command-item-sim:black-friday")).toBeVisible();
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
