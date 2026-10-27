import { test, expect, gotoCanvas, expectNoErrors, pauseClock } from "./fixtures";
import { MOD, SLUG, installFakeSpeech, openAdvanced, speech, speechState } from "./ai-helpers";

// Dictation in the AI panel's Advanced section, against a fake SpeechRecognition installed before the app loads.
// Selectors are data-testid only.

const mic = (page: import("@playwright/test").Page) => page.getByTestId("ai-mic");

test("a restored AI dock offers dictation only after its canvas is ready", async ({ page, consoleErrors }) => {
  await installFakeSpeech(page);
  await page.addInitScript(() => {
    localStorage.setItem("diagrams.ai-dock.v1", JSON.stringify({ open: true, width: 360 }));
    localStorage.setItem("diagrams.ai-advanced.v1", "1");
  });
  let releaseCanvas: () => void = () => {
    throw new Error("Canvas gate not initialized");
  };
  const canvas = new Promise<void>((resolve) => {
    releaseCanvas = resolve;
  });
  await page.route(
    /\/(?:assets\/CanvasView-[A-Za-z0-9_-]+\.js|src\/canvas\/CanvasView\.tsx)(?:\?.*)?$/,
    async (route) => {
      await canvas;
      await route.continue();
    },
  );
  try {
    await page.goto(`./?view=canvas&example=${SLUG}`);
    // The dock is hosted by the canvas now: neither it nor dictation can mount ahead of that host.
    await expect(page.getByTestId("view-loading").filter({ visible: true })).toBeVisible();
    await expect(page.getByTestId("ai-dock")).toHaveCount(0);
    await expect(mic(page)).toHaveCount(0);
    releaseCanvas();
    await openAdvanced(page);
    await expect(page.getByTestId("ai-dock")).toHaveAttribute("data-ready", "true");
    await mic(page).click();
    await expect(page.getByTestId("ai-interim")).toContainText("Listening");
    await expect(page.getByTestId("ai-request")).toHaveValue("");
    expectNoErrors(consoleErrors);
  } finally {
    releaseCanvas();
  }
});

test("@dev a temporary canvas host detach preserves the active dictation session", async ({ page }) => {
  await installFakeSpeech(page);
  await gotoCanvas(page, SLUG);
  await openAdvanced(page);
  await mic(page).click();
  await expect(page.getByTestId("ai-interim")).toContainText("Listening");
  await speech(page, "result", [["keep these words", true]]);
  await page.evaluate(async () => {
    const url = "/src/palette/host.ts";
    const { paletteHost, publish } = (await import(url)) as typeof import("../../src/palette/host");
    const canvas = paletteHost.get().canvas;
    if (!canvas) throw new Error("Expected the mounted canvas host");
    window.addEventListener("restore-dictation-host", () => publish("canvas", canvas), { once: true });
    paletteHost.reset();
  });
  await expect(page.getByTestId("ai-dock")).toHaveAttribute("data-ready", "false");
  await expect(mic(page)).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => window.dispatchEvent(new Event("restore-dictation-host")));
  await expect(page.getByTestId("ai-dock")).toHaveAttribute("data-ready", "true");
  await expect(mic(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ai-request")).toHaveValue("Keep these words");
  expect((await speechState(page)).starts).toBe(1);
});

test.describe("Dictate", () => {
  test("start, interim words, final words at the caret, stop", async ({ page, consoleErrors }) => {
    await installFakeSpeech(page);
    await gotoCanvas(page, SLUG);
    await openAdvanced(page);

    await expect(mic(page)).toHaveAttribute("aria-label", "Dictate");
    // A polite live region, there (and empty) before listening starts, so its words are announced when they arrive.
    await expect(page.getByTestId("ai-speech-service")).toHaveAttribute("role", "status");
    await expect(page.getByTestId("ai-speech-service")).toHaveText("");
    await mic(page).click();
    await expect(mic(page)).toHaveAttribute("aria-pressed", "true");
    await expect(mic(page)).toHaveAttribute("aria-label", "Stop dictating");
    await expect(page.getByTestId("ai-interim")).toContainText("Listening");
    const { config } = await speechState(page);
    expect(config).toMatchObject({ continuous: true, interimResults: true });
    // The browser's speech service listens (not the device): the box says where the audio goes, the whole time.
    // Playwright's Chromium names Google's.
    await expect(page.getByTestId("ai-speech-service")).toHaveText(
      "What you say may be sent to Google's speech service.",
    );
    await expect(page.getByTestId("ai-dictation-message")).toHaveCount(0);

    await speech(page, "result", [["a kafka topic orders", false]]);
    await expect(page.getByTestId("ai-interim")).toHaveText("a kafka topic orders");
    await expect(page.getByTestId("ai-request")).toHaveValue("");

    await speech(page, "result", [
      ["a kafka topic orders", true],
      [" consumed by", false],
    ]);
    await expect(page.getByTestId("ai-request")).toHaveValue("A kafka topic orders");
    await expect(page.getByTestId("ai-interim")).toHaveText("consumed by");

    // The browser ends the session on silence: dictation carries on in a new one. That session's first
    // words can arrive before its start event: they're committed once, and its later (cumulative) result
    // lists don't repeat them.
    await speech(page, "holdStarts");
    await speech(page, "silence");
    await expect.poll(async () => (await speechState(page)).starts).toBe(2);
    await speech(page, "result", [["consumed by billing-worker", true]]);
    await expect(page.getByTestId("ai-request")).toHaveValue("A kafka topic orders consumed by billing-worker");
    await speech(page, "releaseStart");
    await expect.poll(async () => (await speechState(page)).active).toBe(1);
    await expect(mic(page)).toHaveAttribute("aria-pressed", "true");
    await speech(page, "result", [
      ["consumed by billing-worker", true],
      ["and shipping", true],
    ]);
    await expect(page.getByTestId("ai-request")).toHaveValue(
      "A kafka topic orders consumed by billing-worker and shipping",
    );

    await mic(page).click();
    await expect(mic(page)).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("ai-interim")).toHaveCount(0);
    await expect(page.getByTestId("ai-speech-service")).toHaveText("");
    // Every time, not once per browser: a reload and a new session say it again.
    await page.reload();
    await openAdvanced(page);
    await mic(page).click();
    await expect(page.getByTestId("ai-speech-service")).toContainText("Google's speech service");
    expectNoErrors(consoleErrors);
  });

  test("Ctrl+Shift+M toggles it; Esc stops it before leaving the panel; Apply stops it", async ({ page }) => {
    await installFakeSpeech(page);
    await gotoCanvas(page, SLUG);
    await openAdvanced(page);
    await page.keyboard.press(`${MOD}+Shift+M`);
    await expect(mic(page)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(mic(page)).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("ai-panel")).toBeVisible();

    await page.keyboard.press(`${MOD}+Shift+M`);
    await expect(page.getByTestId("ai-interim")).toContainText("Listening");
    // Words go in at the caret.
    await page.getByTestId("ai-request").fill("Kafka. Postgres");
    await page.getByTestId("ai-request").evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(6, 6));
    await speech(page, "result", [["then a worker", true]]);
    await expect(page.getByTestId("ai-request")).toHaveValue("Kafka. Then a worker Postgres");

    await page.getByTestId("ai-reply").fill('[{ "op": "add_node", "kind": "Kafka topic", "label": "orders" }]');
    await page.getByTestId("ai-apply").click();
    await expect(mic(page)).toHaveAttribute("aria-pressed", "false");
    // The box is clear for the next turn, and dictation starts again straight away.
    await expect(page.getByTestId("ai-request")).toHaveValue("");
    await page.keyboard.press(`${MOD}+Shift+M`);
    await expect(page.getByTestId("ai-interim")).toContainText("Listening");
    await speech(page, "result", [["now add a queue", true]]);
    await expect(page.getByTestId("ai-request")).toHaveValue("Now add a queue");

    await page.keyboard.press("Escape");
    await expect(mic(page)).toHaveAttribute("aria-pressed", "false");
    // The second Esc hands the keyboard back to the canvas; the dock stays (it's part of the tooling).
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("canvas-wrap")).toBeFocused();
    await expect(page.getByTestId("ai-panel")).toBeVisible();
  });

  test("a blocked microphone says how to fix it", async ({ page }) => {
    await installFakeSpeech(page, { deny: true });
    await gotoCanvas(page, SLUG);
    await openAdvanced(page);
    await mic(page).click();
    await expect(page.getByTestId("ai-dictation-message")).toContainText("microphone is blocked");
    await expect(mic(page)).toHaveAttribute("aria-pressed", "false");
  });

  test("no speech is a gentle note and listening goes on; on-device needs no note", async ({ page }) => {
    await installFakeSpeech(page, { onDevice: true });
    await gotoCanvas(page, SLUG);
    await openAdvanced(page);
    await mic(page).click();
    await expect(page.getByTestId("ai-interim")).toContainText("Listening on this device");
    expect((await speechState(page)).config).toMatchObject({ processLocally: true });
    await expect(page.getByTestId("ai-dictation-message")).toHaveCount(0);
    await expect(page.getByTestId("ai-speech-service")).toHaveText("");
    await speech(page, "error", "no-speech");
    await speech(page, "silence");
    await expect(page.getByTestId("ai-dictation-message")).toContainText("Still listening");
    await expect.poll(async () => (await speechState(page)).starts).toBe(2);
    await expect(mic(page)).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("the microphone goes off with the request box", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
  });
  test("folding Advanced stops listening for good: no restart after silence, nothing written", async ({
    page,
    consoleErrors,
  }) => {
    await installFakeSpeech(page);
    await gotoCanvas(page, SLUG);
    await openAdvanced(page);
    await mic(page).click();
    await expect(page.getByTestId("ai-interim")).toContainText("Listening");
    await expect.poll(async () => (await speechState(page)).active).toBe(1);

    await page.getByTestId("ai-advanced-toggle").click();
    await expect(page.getByTestId("ai-request")).toHaveCount(0);
    await expect.poll(async () => (await speechState(page)).active).toBe(0);
    await speech(page, "result", [["late words", true]]);
    await speech(page, "silence");
    await pauseClock(page);
    await page.clock.runFor(200);
    expect((await speechState(page)).starts).toBe(1);

    await page.getByTestId("ai-advanced-toggle").click();
    await expect(mic(page)).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("ai-request")).toHaveValue("");
    // And it starts again as usual.
    await mic(page).click();
    await page.clock.runFor(20);
    await expect.poll(async () => (await speechState(page)).active).toBe(1);
    expectNoErrors(consoleErrors);
  });

  test("folding Advanced while the microphone is still starting starts nothing", async ({ page }) => {
    await installFakeSpeech(page, { deferredAvailability: true });
    await gotoCanvas(page, SLUG);
    await openAdvanced(page);
    await mic(page).click();
    await expect(page.getByTestId("ai-interim")).toContainText("Allow the microphone");
    await page.getByTestId("ai-advanced-toggle").click();
    await speech(page, "resolveAvailability");
    await pauseClock(page);
    await page.clock.runFor(200);
    expect(await speechState(page)).toMatchObject({ starts: 0, active: 0 });
  });

  test("folding the panel or opening another diagram stops it too", async ({ page }) => {
    await installFakeSpeech(page);
    await gotoCanvas(page, SLUG);
    await openAdvanced(page);
    await mic(page).click();
    await expect.poll(async () => (await speechState(page)).active).toBe(1);
    await page.getByTestId("ai-collapse").click();
    await expect.poll(async () => (await speechState(page)).active).toBe(0);

    await openAdvanced(page);
    await mic(page).click();
    await expect.poll(async () => (await speechState(page)).active).toBe(1);
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-new").click();
    await expect(page.getByTestId("start-card")).toBeVisible();
    await expect.poll(async () => (await speechState(page)).active).toBe(0);
    await speech(page, "silence");
    await pauseClock(page);
    await page.clock.runFor(200);
    expect((await speechState(page)).starts).toBe(2);
  });
});

test("the mic is hidden when the browser has no speech recognition", async ({ page, consoleErrors }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  });
  await gotoCanvas(page, SLUG);
  await openAdvanced(page);
  await expect(page.getByTestId("ai-request")).toBeVisible();
  await expect(mic(page)).toHaveCount(0);
  await page.keyboard.press(`${MOD}+Shift+M`);
  await expect(page.getByTestId("ai-interim")).toHaveCount(0);
  expectNoErrors(consoleErrors);
});
