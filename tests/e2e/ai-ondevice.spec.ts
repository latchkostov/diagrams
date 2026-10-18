import { currentDiagram, openExample } from "./fixtures";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors } from "./fixtures";
import {
  SLUG,
  fakeModel,
  installFakeLanguageModel,
  modelReply,
  nodeCount,
  openAdvanced,
  openAiPanel,
  releaseModel,
  savedDiagram,
  installFakeSpeech,
  speechState,
} from "./ai-helpers";

// Chrome's built-in model (the Prompt API), faked with an init script: CI has no model. The request box
// shows where the model can run and the person turned it on in Advanced. Selectors are data-testid only.

const DLQ = modelReply("Added a dead-letter queue after Inventory service", [
  { op: "add", kind: "dead-letter queue", label: "inventory-dlq" },
  { op: "connect", from: "Inventory service", to: "inventory-dlq", flow: "message" },
]);

/** The dead-letter queue as the eval scores it: off the topic Inventory service reads, not off the service. */
const DLQ_ON_TOPIC = modelReply("Added a dead-letter queue for orders.created.v1", [
  { op: "add", kind: "dead-letter queue", label: "inventory-dlq" },
  { op: "connect", from: "orders.created.v1", to: "inventory-dlq", flow: "message" },
]);

/** Opens the panel and turns the on-device model on in Advanced. */
async function turnOn(page: Page) {
  await openAdvanced(page);
  await page.getByTestId("ai-ondevice-toggle").check();
  await expect(page.getByTestId("ai-ondevice")).toBeVisible();
}

async function ask(page: Page, text: string) {
  const input = page.getByTestId("ai-ondevice-input");
  await input.fill(text);
  await input.press("Enter");
}

test("without the Prompt API there's no toggle and no box", async ({ page, consoleErrors }) => {
  // Playwright's Chromium has a LanguageModel of its own: take it away.
  await page.addInitScript(() => delete (window as unknown as { LanguageModel?: unknown }).LanguageModel);
  await gotoCanvas(page, SLUG);
  await openAdvanced(page);
  await expect(page.getByTestId("ai-ondevice-pref")).toHaveCount(0);
  await expect(page.getByTestId("ai-ondevice")).toHaveCount(0);
  await expect(page.getByTestId("ai-howto")).toBeVisible();
  expectNoErrors(consoleErrors);
});

test("an unavailable model offers nothing; the how-to shows instead", async ({ page }) => {
  await installFakeLanguageModel(page, { availability: "unavailable" });
  await gotoCanvas(page, SLUG);
  await openAdvanced(page);
  await expect(page.getByTestId("ai-howto")).toBeVisible();
  await expect(page.getByTestId("ai-ondevice-pref")).toHaveCount(0);
  await expect(page.getByTestId("ai-ondevice")).toHaveCount(0);
});

test("available: on by default (round 3), honest label; Advanced turns it off, remembered", async ({ page }) => {
  await installFakeLanguageModel(page);
  await gotoCanvas(page, SLUG);
  await openAiPanel(page);
  await expect(page.getByTestId("ai-ondevice")).toHaveAttribute("data-state", "available");
  await expect(page.getByTestId("ai-ondevice-status")).toHaveText("Runs on this device with Chrome's built-in model");
  await expect(page.getByTestId("ai-empty")).toContainText("Type a change below");
  await openAdvanced(page);
  await expect(page.getByTestId("ai-ondevice-toggle")).toBeChecked();
  await page.getByTestId("ai-ondevice-toggle").uncheck();
  await expect(page.getByTestId("ai-ondevice")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("ai-panel")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("ai-howto")).toBeVisible();
  await expect(page.getByTestId("ai-ondevice")).toHaveCount(0);
});

test("downloadable: a one-time download with progress, then the box", async ({ page }) => {
  await installFakeLanguageModel(page, { availability: "downloadable", downloadStepMs: 400 });
  await gotoCanvas(page, SLUG);
  await turnOn(page);
  await expect(page.getByTestId("ai-ondevice")).toHaveAttribute("data-state", "downloadable");
  await expect(page.getByTestId("ai-ondevice-input")).toHaveCount(0);
  await page.getByTestId("ai-ondevice-download").click();
  await expect(page.getByTestId("ai-ondevice-progress")).toContainText("Downloading the on-device model…");
  await expect(page.getByTestId("ai-ondevice-progress-bar")).toBeVisible();
  await expect(page.getByTestId("ai-ondevice-input")).toBeVisible();
  await expect(page.getByTestId("ai-ondevice")).toHaveAttribute("data-state", "available");
  const lm = await fakeModel(page);
  expect(lm.creates).toBe(1);
  expect(lm.monitored).toBe(true);
});

test("a request becomes one turn with a working Undo", async ({ page, consoleErrors }) => {
  await installFakeLanguageModel(page, { replies: [DLQ] });
  await gotoCanvas(page, SLUG);
  await turnOn(page);
  const before = await nodeCount(page);
  await ask(page, "Add a dead-letter queue after Inventory service");
  const turn = page.getByTestId("ai-turn-0");
  await expect(turn).toHaveAttribute("data-engine", "on-device");
  await expect(turn).toContainText("Add a dead-letter queue after Inventory service");
  await expect(page.getByTestId("ai-turn-0-who")).toContainText("On this device");
  await expect(page.getByTestId("ai-turn-0-summary")).toContainText("+1 node, +1 connection");
  await expect(page.getByTestId("ai-ondevice-input")).toHaveValue("");
  expect(await nodeCount(page)).toBe(before + 1);
  await expect.poll(async () => (await savedDiagram(page))?.nodes.some((n) => n.label === "inventory-dlq")).toBe(true);

  // The model got the diagram (by labels), the request and the reply schema.
  const lm = await fakeModel(page);
  expect(lm.prompts[0]).toContain("- Inventory service: Java Service");
  expect(lm.prompts[0]).toContain("Request: Add a dead-letter queue after Inventory service");
  expect(lm.constraints).toBe(1);

  await page.getByTestId("ai-turn-0-undo").click();
  await expect.poll(() => nodeCount(page)).toBe(before);
  await expect(page.getByTestId("ai-turn-0-undone")).toBeVisible();
  expectNoErrors(consoleErrors);
});

test("a reply that doesn't fit is retried once with the error, then applied", async ({ page }) => {
  const bad = modelReply("Removed it", [{ op: "remove", target: "Shipping service" }]);
  await installFakeLanguageModel(page, { replies: [bad, DLQ] });
  await gotoCanvas(page, SLUG);
  await turnOn(page);
  await ask(page, "Add a dead-letter queue after Inventory service");
  await expect(page.getByTestId("ai-turn-0")).toHaveAttribute("data-engine", "on-device");
  const lm = await fakeModel(page);
  expect(lm.prompts).toHaveLength(2);
  expect(lm.prompts[1]).toMatch(/^That failed: /);
});

test("without clone(), every request gets a session of its own, the next diagram's included", async ({ page }) => {
  const bad = modelReply("", [{ op: "connect", from: "Nowhere", to: "Inventory service" }]);
  const queue = modelReply("Added a queue", [{ op: "add", kind: "queue", label: "billing-queue" }]);
  await installFakeLanguageModel(page, { replies: [DLQ, bad, bad, "hang", queue], noClone: true });
  await gotoCanvas(page, SLUG);
  await turnOn(page);
  /** The session that took each prompt so far. */
  const sessions = async () => (await fakeModel(page)).promptSessions;

  // Succeeds.
  await ask(page, "Add a dead-letter queue after Inventory service");
  await expect(page.getByTestId("ai-turn-0")).toHaveAttribute("data-engine", "on-device");
  const [first] = await sessions();
  // Fails (the reply and its one retry share a session: it's one request).
  await ask(page, "Connect nowhere to inventory");
  await expect(page.getByTestId("ai-ondevice-error")).toHaveText("Couldn't apply that. Try rephrasing.");
  const [, second, retry] = await sessions();
  expect(retry).toBe(second);
  // Cancelled.
  await ask(page, "Add a cache");
  await expect.poll(async () => (await sessions()).length).toBe(4);
  await page.getByTestId("ai-ondevice-stop").click();
  await expect(page.getByTestId("ai-ondevice-send")).toBeVisible();
  const third = (await sessions())[3];

  // Another diagram, opened in the same page (the model's sessions live as long as the page): its request reaches
  // none of those sessions, and they're all gone.
  const title = await page.getByTestId("diagram-title").innerText();
  await openExample(page, "aws-serverless-orders");
  await expect(page.getByTestId("diagram-title")).not.toHaveText(title);
  await expect(page.getByTestId("ai-ondevice")).toBeVisible();
  await ask(page, "Add a billing queue");
  await expect(page.getByTestId("ai-turn-0")).toHaveAttribute("data-engine", "on-device");
  const lm = await fakeModel(page);
  const fourth = lm.promptSessions[4];
  expect(new Set([first, second, third, fourth]).size).toBe(4);
  expect(lm.destroyedSessions).toEqual(expect.arrayContaining([first, second, third]));
});

test("two bad replies apply nothing and say so", async ({ page }) => {
  const bad = modelReply("", [{ op: "connect", from: "Nowhere", to: "Inventory service" }]);
  await installFakeLanguageModel(page, { replies: [bad, bad] });
  await gotoCanvas(page, SLUG);
  await turnOn(page);
  const before = await nodeCount(page);
  await ask(page, "Connect nowhere to inventory");
  await expect(page.getByTestId("ai-ondevice-error")).toHaveText("Couldn't apply that. Try rephrasing.");
  await expect(page.getByTestId("ai-turn-0")).toHaveCount(0);
  expect(await nodeCount(page)).toBe(before);
  // The request stays, to rephrase.
  await expect(page.getByTestId("ai-ondevice-input")).toHaveValue("Connect nowhere to inventory");
});

test("Stop cancels a request: nothing applied, no error", async ({ page }) => {
  await installFakeLanguageModel(page, { replies: ["hang"] });
  await gotoCanvas(page, SLUG);
  await turnOn(page);
  const before = await nodeCount(page);
  await ask(page, "Add a cache");
  await expect(page.getByTestId("ai-ondevice-status")).toHaveText("Thinking…");
  await page.getByTestId("ai-ondevice-stop").click();
  await expect(page.getByTestId("ai-ondevice-send")).toBeVisible();
  await expect(page.getByTestId("ai-ondevice-error")).toHaveCount(0);
  await expect(page.getByTestId("ai-turn-0")).toHaveCount(0);
  expect(await nodeCount(page)).toBe(before);
  expect((await fakeModel(page)).aborted).toBe(1);
});

test("in live view the box is off until back to editing", async ({ page }) => {
  await installFakeLanguageModel(page);
  await gotoCanvas(page, SLUG);
  await turnOn(page);
  await page.getByTestId("live-toggle").click();
  await expect(page.getByTestId("ai-ondevice-input")).toBeDisabled();
  await expect(page.getByTestId("ai-ondevice-input")).toHaveAttribute(
    "placeholder",
    "Back to editing to change the diagram",
  );
  await page.getByTestId("live-toggle").click();
  await expect(page.getByTestId("ai-ondevice-input")).toBeEnabled();
});

test("the Lab's eval runner scores the cases through the model and copies a table", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await installFakeLanguageModel(page, { replies: Array.from({ length: 80 }, () => DLQ_ON_TOPIC) });
  await page.goto("./?view=lab&preset=ondevice-evals");
  await expect(page.getByTestId("ondevice-evals-availability")).toHaveText("available");
  await page.getByTestId("ondevice-evals-run").click();
  await expect(page.getByTestId("ondevice-evals-run")).toHaveText("Run evals", { timeout: 20_000 });
  // The canned reply fits only the dead-letter-queue case.
  await expect(page.getByTestId("ondevice-evals-edit-dlq")).toContainText("pass");
  await expect(page.getByTestId("ondevice-evals-edit-rename")).toContainText("FAIL");
  await expect(page.getByTestId("ondevice-evals-rate")).toContainText(/^\d+\/\d+ passed/);
  await page.getByTestId("ondevice-evals-copy").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^Pass rate: \*\*/);
});

test.describe("a request in flight", () => {
  test("entering Live cancels it: nothing commits, even when the reply comes", async ({ page }) => {
    await installFakeLanguageModel(page, { replies: [`hold:${DLQ}`] });
    await gotoCanvas(page, SLUG);
    await turnOn(page);
    const before = await nodeCount(page);
    await ask(page, "Add a dead-letter queue after Inventory service");
    await expect(page.getByTestId("ai-ondevice-status")).toHaveText("Thinking…");
    await page.getByTestId("live-toggle").click();
    await expect.poll(async () => (await fakeModel(page)).aborted).toBe(1);
    await releaseModel(page);
    await expect.poll(async () => (await fakeModel(page)).destroyed).toBeGreaterThan(0);
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("ai-ondevice-send")).toBeVisible();
    await expect(page.getByTestId("ai-turn-0")).toHaveCount(0);
    expect(await nodeCount(page)).toBe(before);
    // Cancellation must leave the example unpromoted, with no persisted edit to read.
    expect(await currentDiagram(page)).toBe(SLUG);
  });

  test("Esc cancels it first, before the panel's own Esc", async ({ page }) => {
    await installFakeLanguageModel(page, { replies: ["hang"] });
    await gotoCanvas(page, SLUG);
    await turnOn(page);
    await ask(page, "Add a cache");
    await expect(page.getByTestId("ai-ondevice-status")).toHaveText("Thinking…");
    await page.getByTestId("ai-ondevice-input").press("Escape");
    await expect(page.getByTestId("ai-ondevice-send")).toBeVisible();
    expect((await fakeModel(page)).aborted).toBe(1);
    // The keyboard stays in the box; a second Esc goes back to the canvas as usual.
    await expect(page.getByTestId("ai-ondevice-input")).toBeFocused();
    await page.getByTestId("ai-ondevice-input").press("Escape");
    await expect(page.getByTestId("canvas-wrap")).toBeFocused();
  });

  test("Stop cancels during session start-up: idle at once, no prompt, no turn", async ({ page }) => {
    await installFakeLanguageModel(page, { replies: [DLQ], deferCreate: true });
    await gotoCanvas(page, SLUG);
    await turnOn(page);
    const before = await nodeCount(page);
    await ask(page, "Add a dead-letter queue after Inventory service");
    await expect(page.getByTestId("ai-ondevice-status")).toHaveText("Thinking…");
    await page.getByTestId("ai-ondevice-stop").click();
    await expect(page.getByTestId("ai-ondevice-send")).toBeVisible();
    await releaseModel(page, "create");
    await page.waitForTimeout(300);
    const lm = await fakeModel(page);
    expect(lm.prompts).toEqual([]);
    await expect(page.getByTestId("ai-turn-0")).toHaveCount(0);
    expect(await nodeCount(page)).toBe(before);
  });
});

test.describe("dictation in the box", () => {
  test("says before use when speech leaves the device, and shows errors", async ({ page }) => {
    await installFakeLanguageModel(page);
    await installFakeSpeech(page, { deny: true });
    await gotoCanvas(page, SLUG);
    await turnOn(page);
    await expect(page.getByTestId("ai-ondevice-speech-note")).toHaveText(
      "Dictation: What you say may be sent to Google's speech service.",
    );
    await page.getByTestId("ai-ondevice-mic").click();
    await expect(page.getByTestId("ai-ondevice-dictation-message")).toHaveAttribute("role", "alert");
  });

  test("on-device speech needs no note; Listening on this device…", async ({ page }) => {
    await installFakeLanguageModel(page);
    await installFakeSpeech(page, { onDevice: true });
    await gotoCanvas(page, SLUG);
    await turnOn(page);
    await page.getByTestId("ai-ondevice-mic").click();
    await expect(page.getByTestId("ai-ondevice-interim")).toHaveText("Listening on this device…");
    await expect(page.getByTestId("ai-ondevice-speech-note")).toHaveCount(0);
  });

  test("entering Live stops it", async ({ page }) => {
    await installFakeLanguageModel(page);
    await installFakeSpeech(page, { onDevice: true });
    await gotoCanvas(page, SLUG);
    await turnOn(page);
    await page.getByTestId("ai-ondevice-mic").click();
    await expect(page.getByTestId("ai-ondevice-mic")).toHaveAttribute("data-status", "listening");
    await page.getByTestId("live-toggle").click();
    await expect.poll(async () => (await speechState(page)).active).toBe(0);
    await expect(page.getByTestId("ai-ondevice-mic")).toHaveCount(0);
  });
});
