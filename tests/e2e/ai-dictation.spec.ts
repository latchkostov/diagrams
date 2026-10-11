import { test, expect, gotoCanvas, expectNoErrors } from "./fixtures";
import { MOD, SLUG, installFakeSpeech, openAiFromFileMenu, speech, speechState } from "./ai-helpers";

// Dictation in "Build with AI", against a fake SpeechRecognition installed before the app loads.
// Selectors are data-testid only.

const mic = (page: import("@playwright/test").Page) => page.getByTestId("ai-mic");

test.describe("Dictate", () => {
  test("start, interim words, final words at the caret, stop", async ({ page, consoleErrors }) => {
    await installFakeSpeech(page);
    await gotoCanvas(page, SLUG);
    await openAiFromFileMenu(page);

    await expect(mic(page)).toHaveAttribute("aria-label", "Dictate");
    await mic(page).click();
    await expect(mic(page)).toHaveAttribute("aria-pressed", "true");
    await expect(mic(page)).toHaveAttribute("aria-label", "Stop dictating");
    await expect(page.getByTestId("ai-interim")).toContainText("Listening");
    const { config } = await speechState(page);
    expect(config).toMatchObject({ continuous: true, interimResults: true });
    // First use of the browser's speech service: say where audio goes, once.
    await expect(page.getByTestId("ai-dictation-message")).toContainText("speech service");

    await speech(page, "result", [["a kafka topic orders", false]]);
    await expect(page.getByTestId("ai-interim")).toHaveText("a kafka topic orders");
    await expect(page.getByTestId("ai-request")).toHaveValue("");

    await speech(page, "result", [
      ["a kafka topic orders", true],
      [" consumed by", false],
    ]);
    await expect(page.getByTestId("ai-request")).toHaveValue("A kafka topic orders");
    await expect(page.getByTestId("ai-interim")).toHaveText("consumed by");

    // The browser ends the session on silence: dictation carries on in a new one.
    await speech(page, "silence");
    await expect.poll(async () => (await speechState(page)).starts).toBe(2);
    await expect(mic(page)).toHaveAttribute("aria-pressed", "true");
    await speech(page, "result", [["consumed by billing-worker", true]]);
    await expect(page.getByTestId("ai-request")).toHaveValue("A kafka topic orders consumed by billing-worker");

    await mic(page).click();
    await expect(mic(page)).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("ai-interim")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("Ctrl+Shift+M toggles it; Esc stops it before closing; Apply stops it", async ({ page }) => {
    await installFakeSpeech(page);
    await gotoCanvas(page, SLUG);
    await openAiFromFileMenu(page);
    await page.keyboard.press(`${MOD}+Shift+M`);
    await expect(mic(page)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(mic(page)).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("ai-dialog")).toBeVisible();

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
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ai-dialog")).toHaveCount(0);
  });

  test("a blocked microphone says how to fix it", async ({ page }) => {
    await installFakeSpeech(page, { deny: true });
    await gotoCanvas(page, SLUG);
    await openAiFromFileMenu(page);
    await mic(page).click();
    await expect(page.getByTestId("ai-dictation-message")).toContainText("microphone is blocked");
    await expect(mic(page)).toHaveAttribute("aria-pressed", "false");
  });

  test("no speech is a gentle note and listening goes on; on-device needs no note", async ({ page }) => {
    await installFakeSpeech(page, { onDevice: true });
    await gotoCanvas(page, SLUG);
    await openAiFromFileMenu(page);
    await mic(page).click();
    await expect(page.getByTestId("ai-interim")).toContainText("Listening on this device");
    expect((await speechState(page)).config).toMatchObject({ processLocally: true });
    await expect(page.getByTestId("ai-dictation-message")).toHaveCount(0);
    await speech(page, "error", "no-speech");
    await speech(page, "silence");
    await expect(page.getByTestId("ai-dictation-message")).toContainText("Still listening");
    await expect.poll(async () => (await speechState(page)).starts).toBe(2);
    await expect(mic(page)).toHaveAttribute("aria-pressed", "true");
  });
});

test("the mic is hidden when the browser has no speech recognition", async ({ page, consoleErrors }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  });
  await gotoCanvas(page, SLUG);
  await openAiFromFileMenu(page);
  await expect(page.getByTestId("ai-request")).toBeVisible();
  await expect(mic(page)).toHaveCount(0);
  await page.keyboard.press(`${MOD}+Shift+M`);
  await expect(page.getByTestId("ai-interim")).toHaveCount(0);
  expectNoErrors(consoleErrors);
});
