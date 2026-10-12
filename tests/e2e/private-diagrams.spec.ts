import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors } from "./fixtures";
import {
  MOD,
  SLUG,
  installFakeLanguageModel,
  installFakeModelContext,
  installFakeSpeech,
  fakeModel,
  modelReply,
  nodeCount,
  openAdvanced,
  openAiPanel,
  releaseModel,
  speech,
  speechState,
  toolNames,
} from "./ai-helpers";

// Private diagrams (docs/DESIGN-REVIEW.md, round 12): the Private switch keeps a diagram on this device:
// no share links or embeds, no cloud saves, no AI. Every diagram here is synthetic and public.

const PRIVATE_SHARE = "Private diagrams can't be shared as links. Export a file instead.";

const work = (title: string) => ({
  format: "diagrams/v1",
  title,
  nodes: [
    { id: "intake", stencil: "generic.service", label: "Intake service", x: 0, y: 0 },
    { id: "ledger", stencil: "postgres", label: "Ledger", x: 320, y: 0 },
  ],
  edges: [{ id: "intake-to-ledger", from: "intake", to: "ledger" }],
});

/** Imports a synthetic diagram into Your diagrams and returns its slug. */
async function importDiagram(page: Page, title: string, extra: object = {}) {
  await page.getByTestId("import-input").setInputFiles({
    name: "work.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...work(title), ...extra })),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText(title);
  const slug = await page.getByTestId("example-picker").inputValue();
  expect(slug).toMatch(/^my-/);
  return slug;
}

async function openPrivacyMenu(page: Page) {
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-privacy").click();
  await expect(page.getByTestId("file-privacy-menu")).toBeVisible();
}

/** File ▸ Privacy ▸ Private diagram. */
async function togglePrivate(page: Page) {
  await openPrivacyMenu(page);
  await page.getByTestId("privacy-diagram").click();
}

async function makePrivate(page: Page) {
  await togglePrivate(page);
  await expect(page.getByTestId("private-badge")).toBeVisible();
}

const entry = (page: Page, slug: string) =>
  page.evaluate((s) => JSON.parse(localStorage.getItem(`diagrams.library-entry.v1:${s}`) ?? "null"), slug);

test("the Private switch: badge, library marker, and one confirmation to turn it off", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, SLUG);
  const slug = await importDiagram(page, "Payroll flow");
  await expect(page.getByTestId("private-badge")).toHaveCount(0);
  await openPrivacyMenu(page);
  await expect(page.getByTestId("privacy-diagram")).toHaveAttribute("aria-checked", "false");
  for (const id of ["privacy-diagram", "privacy-new-diagrams"])
    await expect(page.getByTestId(id)).toHaveAttribute("role", "menuitemcheckbox");
  await page.getByTestId("privacy-diagram").click();
  await expect(page.getByTestId("private-badge")).toHaveText("Private");
  expect((await entry(page, slug)).private).toBe(true);
  // The File menu says so, and the library row too.
  await page.getByTestId("file-button").click();
  await expect(page.getByTestId("file-privacy")).toContainText("This diagram is private");
  await page.getByTestId("file-library").click();
  await expect(page.getByTestId(`library-private-${slug}`)).toBeVisible();
  await page.keyboard.press("Escape");

  // The badge explains; Keep private is the default and changes nothing.
  await page.getByTestId("private-badge").click();
  await expect(page.getByTestId("privacy-dialog")).toBeVisible();
  await expect(page.getByTestId("privacy-keep")).toBeFocused();
  await page.getByTestId("privacy-keep").click();
  await expect(page.getByTestId("privacy-dialog")).toHaveCount(0);
  await expect(page.getByTestId("private-badge")).toBeVisible();

  // From the badge, by keyboard: the badge goes with Private, and focus lands on the canvas, not the page.
  await page.getByTestId("private-badge").focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("privacy-turn-off").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("private-badge")).toHaveCount(0);
  await expect(page.getByTestId("canvas-wrap")).toBeFocused();
  await makePrivate(page);

  // Unchecking in the File menu asks the same question first.
  await togglePrivate(page);
  await expect(page.getByTestId("privacy-dialog")).toBeVisible();
  await page.getByTestId("privacy-turn-off").click();
  await expect(page.getByTestId("private-badge")).toHaveCount(0);
  expect((await entry(page, slug)).private).toBeUndefined();

  // Ctrl+K finds the switch too.
  await page.getByTestId("canvas-wrap").click({ position: { x: 700, y: 420 } });
  await page.keyboard.press(`${MOD}+k`);
  await expect(page.getByTestId("command-input")).toBeFocused();
  await page.getByTestId("command-input").fill("make this diagram private");
  await expect(page.getByTestId("command-item-action:file.private")).toBeVisible();
  await page.getByTestId("command-item-action:file.private").click();
  await expect(page.getByTestId("private-badge")).toBeVisible();
  expectNoErrors(consoleErrors);
});

test("share links are off, saying why, embeds are the private kind, and a private example becomes a private copy", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, SLUG);
  // An example isn't yours to change: Private saves a private copy.
  await makePrivate(page);
  await expect(page.getByTestId("example-picker")).toHaveValue(/^my-/);
  await expect(page.getByTestId("toast").last()).toContainText("private copy");

  await page.getByTestId("file-button").click();
  const link = page.getByTestId("export-share-link");
  await expect(link).toBeDisabled();
  await expect(link).toContainText(PRIVATE_SHARE);
  // Embeds stay: the kind whose diagram the host's own page supplies (nothing of it goes in a URL).
  await expect(page.getByTestId("export-embed")).toBeEnabled();
  await expect(page.getByTestId("export-embed")).toContainText("Your app supplies it");
  await page.getByTestId("export-embed").click();
  await expect(page.getByTestId("embed-dialog")).toBeVisible();
  await expect(page.getByTestId("embed-source-host")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("embed-source-inline")).toBeDisabled();
  await expect(page.getByTestId("embed-host-note")).toBeVisible();
  await expect(page.getByTestId("embed-snippet")).toHaveValue(/<live-diagram /);
  expect(await page.getByTestId("embed-snippet").inputValue()).not.toMatch(/#[de]=|embed=1&example/);
  await expect(page.getByTestId("embed-open")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("embed-dialog")).toHaveCount(0);

  // The canvas right-click's Export ▸ shows them off too.
  await page.getByTestId("canvas-wrap").click({ button: "right", position: { x: 700, y: 60 } });
  await page.getByTestId("context-menu-item-canvas.export").hover();
  await expect(page.getByTestId("context-menu-item-export:share")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("context-menu-item-export:embed")).not.toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("context-menu-item-export:json")).not.toHaveAttribute("aria-disabled", "true");
  expectNoErrors(consoleErrors);
});

test("cloud saves are blocked; this device still saves", async ({ page, consoleErrors }) => {
  await page.goto(`./?view=canvas&example=${SLUG}&storage=test`);
  await expect(page.getByTestId("canvas-view")).toBeVisible();
  await importDiagram(page, "Vendor contracts");
  // Saved to the cloud while public: Save goes back there.
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-save-to").click();
  await page.getByTestId("save-to-test").click();
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-provider", "test");
  const files = () => page.evaluate(() => JSON.parse(localStorage.getItem("diagrams.test-storage.v1") ?? "[]").length);
  expect(await files()).toBe(1);

  await makePrivate(page);
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-save-to").click();
  await expect(page.getByTestId("save-to-test")).toBeDisabled();
  await expect(page.getByTestId("save-to-test")).toContainText("Off for private diagrams");
  await expect(page.getByTestId("save-to-device")).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  // Ctrl+S to the bound cloud file says why and offers this device.
  await page.getByTestId("canvas-wrap").click({ position: { x: 700, y: 400 } });
  await page.keyboard.press(`${MOD}+s`);
  await expect(page.getByTestId("toast").last()).toContainText("Private diagrams aren't saved to");
  await expect(page.getByTestId("toast-private-save-device")).toBeVisible();
  expect(await files()).toBe(1);
  expectNoErrors(consoleErrors);
});

test("AI is off: no WebMCP tools, Copy for AI and copied prompts off; the on-device model only when allowed", async ({
  page,
  context,
  consoleErrors,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await installFakeModelContext(page);
  await installFakeLanguageModel(page);
  await page.addInitScript(() => localStorage.setItem("diagrams.ai-ondevice.v1", "1"));
  await gotoCanvas(page, SLUG);
  await importDiagram(page, "Payments review");
  await expect.poll(() => toolNames(page)).toHaveLength(7);
  await makePrivate(page);
  await expect.poll(() => toolNames(page)).toEqual([]);

  await openAiPanel(page);
  await expect(page.getByTestId("ai-privacy-note")).toContainText("AI is off for this private diagram");
  await expect(page.getByTestId("ai-agent-status")).toContainText("off for this private diagram");
  await expect(page.getByTestId("ai-ondevice")).toHaveCount(0);
  await openAdvanced(page);
  await expect(page.getByTestId("ai-copy-prompt")).toBeDisabled();
  await expect(page.getByTestId("ai-private-hint")).toHaveText("Off for this private diagram.");
  await expect(page.getByTestId("ai-request")).toBeDisabled();

  // Copy for AI is off on the right-click, and copies nothing.
  await page.evaluate(() => navigator.clipboard.writeText("before"));
  await page.getByTestId("node-intake").click({ button: "right" });
  await expect(page.getByTestId("context-menu-item-item.copy-for-ai")).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("before");

  // The on-device model runs on this device: allowed per diagram, it comes back.
  await page.getByTestId("ai-private-ondevice-toggle").check();
  await expect(page.getByTestId("ai-ondevice-input")).toBeEnabled();
  await expect(page.getByTestId("ai-ondevice-speech-note")).toHaveCount(0);
  // ...and the page's tools stay off.
  expect(await toolNames(page)).toEqual([]);
  await page.getByTestId("ai-private-ondevice-toggle").uncheck();
  await expect(page.getByTestId("ai-ondevice")).toHaveCount(0);
  expectNoErrors(consoleErrors);
});

test("Duplicate and pasted nodes keep the diagram private; an example refuses the paste", async ({
  page,
  context,
  consoleErrors,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await gotoCanvas(page, SLUG);
  const plain = await importDiagram(page, "Plain diagram");
  const secret = await importDiagram(page, "Secret diagram");
  await makePrivate(page);

  // Duplicate in Your diagrams.
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-library").click();
  await page.getByTestId(`library-duplicate-${secret}`).click();
  await page.getByTestId("duplicate-open").click();
  await expect(page.getByTestId("diagram-title")).toHaveText("Secret diagram (copy)");
  await expect(page.getByTestId("private-badge")).toHaveAttribute("data-kind", "private");
  const copy = await page.getByTestId("example-picker").inputValue();
  expect((await entry(page, copy)).private).toBe(true);

  // Copy a node from the private diagram...
  await page.getByTestId("node-intake").click();
  await page.keyboard.press(`${MOD}+c`);
  // ...an example won't take it...
  await page.getByTestId("example-picker").selectOption(SLUG);
  await expect(page.getByTestId("node-orders")).toBeVisible();
  const before = await page.getByTestId(/^node-(?!tooltip$|editor-)/).count();
  await page.getByTestId("canvas-wrap").click({ position: { x: 700, y: 420 } });
  await page.keyboard.press(`${MOD}+v`);
  await expect(page.getByTestId("toast").last()).toContainText("came from a private diagram");
  await expect(page.getByTestId(/^node-(?!tooltip$|editor-)/)).toHaveCount(before);
  await expect(page.getByTestId("private-badge")).toHaveCount(0);

  // ...and your own diagram becomes private with it.
  await page.getByTestId("example-picker").selectOption(plain);
  await expect(page.getByTestId("diagram-title")).toHaveText("Plain diagram");
  await expect(page.getByTestId("private-badge")).toHaveCount(0);
  await page.getByTestId("canvas-wrap").click({ position: { x: 700, y: 420 } });
  await page.keyboard.press(`${MOD}+v`);
  await expect(page.getByTestId("node-intake-1")).toBeVisible();
  await expect(page.getByTestId("private-badge")).toHaveAttribute("data-kind", "private");
  expect((await entry(page, plain)).private).toBe(true);
  expectNoErrors(consoleErrors);
});

test("an exported private diagram says so, and importing it again keeps it private", async ({
  page,
  consoleErrors,
}, info) => {
  await gotoCanvas(page, SLUG);
  await importDiagram(page, "Board deck");
  await makePrivate(page);
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-json").click()]);
  const file = info.outputPath("private.diagram.json");
  await download.saveAs(file);
  const exported = JSON.parse(readFileSync(file, "utf8"));
  expect(exported.private).toBe(true);
  expect(exported.title).toBe("Board deck");

  await page.getByTestId("import-input").setInputFiles(file);
  await expect(page.getByTestId("toast").last()).toContainText("Imported");
  const again = await page.getByTestId("example-picker").inputValue();
  await expect(page.getByTestId("private-badge")).toBeVisible();
  expect((await entry(page, again)).private).toBe(true);
  // A public diagram's export never says private.
  await importDiagram(page, "Public deck");
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  const [plain] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-json").click()]);
  const plainFile = info.outputPath("public.diagram.json");
  await plain.saveAs(plainFile);
  expect(JSON.parse(readFileSync(plainFile, "utf8"))).not.toHaveProperty("private");
  expectNoErrors(consoleErrors);
});

test("New diagrams are private: a remembered setting, off by default", async ({ page, consoleErrors }) => {
  await gotoCanvas(page, SLUG);
  await openPrivacyMenu(page);
  await expect(page.getByTestId("privacy-new-diagrams")).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("privacy-new-diagrams").click();
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-new").click();
  // A blank private diagram shows its lock at once, and AI is off for it.
  await expect(page.getByTestId("private-badge")).toBeVisible();
  await openPrivacyMenu(page);
  await expect(page.getByTestId("privacy-diagram")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("privacy-new-diagrams")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  // Imports from this device start private too.
  await importDiagram(page, "Imported while on");
  await expect(page.getByTestId("private-badge")).toBeVisible();
  await page.reload();
  await openPrivacyMenu(page);
  await expect(page.getByTestId("privacy-new-diagrams")).toHaveAttribute("aria-checked", "true");
  expectNoErrors(consoleErrors);
});

test("a diagram made private clears a share fragment from the address bar", async ({ page, consoleErrors }) => {
  await gotoCanvas(page, SLUG);
  await importDiagram(page, "Hiring plan");
  await page.evaluate(() => history.replaceState(history.state, "", `${location.pathname}${location.search}#d=stale`));
  expect(await page.evaluate(() => location.hash)).toBe("#d=stale");
  await makePrivate(page);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  // The diagram is still the one open (nothing navigated).
  await expect(page.getByTestId("diagram-title")).toHaveText("Hiring plan");
  expectNoErrors(consoleErrors);
});

for (const onDevice of [false, true]) {
  test(`a private diagram dictates only on this device (speech on the device: ${onDevice})`, async ({
    page,
    consoleErrors,
  }) => {
    await installFakeLanguageModel(page);
    await installFakeSpeech(page, { onDevice });
    await page.addInitScript(() => localStorage.setItem("diagrams.ai-ondevice.v1", "1"));
    await gotoCanvas(page, SLUG);
    await importDiagram(page, "Dictated plan");
    await makePrivate(page);
    await openAiPanel(page);
    await page.getByTestId("ai-private-ondevice-toggle").check();
    await page.getByTestId("ai-ondevice-mic").click();
    if (onDevice) {
      await expect.poll(async () => (await speechState(page)).starts).toBe(1);
      expect((await speechState(page)).config).toMatchObject({ processLocally: true });
    } else {
      await expect(page.getByTestId("ai-ondevice-dictation-message")).toContainText("this diagram is private");
      expect((await speechState(page)).starts).toBe(0);
    }
    expectNoErrors(consoleErrors);
  });
}

const testFile = (page: Page) =>
  page.evaluate(
    () =>
      (JSON.parse(localStorage.getItem("diagrams.test-storage.v1") ?? "[]") as { text: string; modified: string }[])[0],
  );

/** An imported diagram saved once to Test storage (bound: Ctrl+S goes back there). */
async function savedToTestStorage(page: Page, title: string) {
  await page.goto(`./?view=canvas&example=${SLUG}&storage=test`);
  await expect(page.getByTestId("canvas-view")).toBeVisible();
  await importDiagram(page, title);
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-save-to").click();
  await page.getByTestId("save-to-test").click();
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-provider", "test");
}

/** An edit the cloud copy doesn't have yet. */
async function deleteIntake(page: Page) {
  await page.getByTestId("node-intake").click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("node-intake")).toHaveCount(0);
  await page.waitForTimeout(400); // the autosave
}

test("private Ctrl+S leaves the bound cloud file unchanged", async ({ page, consoleErrors }) => {
  await savedToTestStorage(page, "Bound plan");
  await deleteIntake(page);
  await makePrivate(page);
  const before = await testFile(page);
  expect(before.text).toContain("intake");
  await page.getByTestId("canvas-wrap").click({ position: { x: 700, y: 420 } });
  await page.keyboard.press(`${MOD}+s`);
  await expect(page.getByTestId("toast-private-save-device")).toBeVisible();
  await page.waitForTimeout(300);
  expect(await testFile(page)).toEqual(before);
  expectNoErrors(consoleErrors);
});

test("a cloud save still pending when the diagram becomes private never lands", async ({ page, consoleErrors }) => {
  await savedToTestStorage(page, "Pending plan");
  await deleteIntake(page);
  const before = await testFile(page);
  // A slow sign-in or upload: the save waits, and meanwhile the diagram becomes private.
  await page.evaluate(() => localStorage.setItem("diagrams.test-storage.delay", "1500"));
  await page.getByTestId("canvas-wrap").click({ position: { x: 700, y: 420 } });
  await page.keyboard.press(`${MOD}+s`);
  await makePrivate(page);
  await expect(page.getByTestId("toast").filter({ hasText: "became private" })).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(500);
  expect(await testFile(page)).toEqual(before);
  expectNoErrors(consoleErrors);
});

test("a share dialog left open closes when another tab makes the diagram private", async ({
  page,
  context,
  consoleErrors,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await gotoCanvas(page, SLUG);
  const slug = await importDiagram(page, "Shared plan");
  await page.getByTestId("file-button").click();
  await page.getByTestId("export-share-link").click();
  await page.getByTestId("toast-share-details").click();
  await expect(page.getByTestId("share-link-dialog")).toBeVisible();

  const other = await context.newPage();
  await gotoCanvas(other, slug);
  await expect(other.getByTestId("diagram-title")).toHaveText("Shared plan");
  await makePrivate(other);

  await expect(page.getByTestId("share-link-dialog")).toHaveCount(0);
  await expect(page.getByTestId("toast").filter({ hasText: PRIVATE_SHARE })).toBeVisible();
  // ...and the File menu's link rows here are off too.
  await page.getByTestId("file-button").click();
  await expect(page.getByTestId("export-share-link")).toBeDisabled();
  await other.close();
  expectNoErrors(consoleErrors);
});

test("a fix-up prompt left from a failed reply is off once the diagram is private", async ({
  page,
  context,
  consoleErrors,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await gotoCanvas(page, SLUG);
  await importDiagram(page, "Fix-up plan");
  await openAdvanced(page);
  await page.getByTestId("ai-request").fill("Remove the gateway");
  await page.getByTestId("ai-reply").fill('[{"op":"remove","targets":["no-such-node"]}]');
  await page.getByTestId("ai-apply").click();
  await expect(page.getByTestId("ai-copy-fix")).toBeEnabled();
  await makePrivate(page);
  await expect(page.getByTestId("ai-copy-fix")).toBeDisabled();
  await page.evaluate(() => navigator.clipboard.writeText("before"));
  await page.getByTestId("ai-copy-fix").click({ force: true });
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("before");
  expectNoErrors(consoleErrors);
});

const RENAME = modelReply("Added a queue after the intake", [
  { op: "add", kind: "queue", label: "intake-queue" },
  { op: "connect", from: "Intake service", to: "intake-queue", flow: "message" },
]);

async function privateWithModel(page: Page, replies: string[]) {
  await installFakeLanguageModel(page, { replies });
  await page.addInitScript(() => localStorage.setItem("diagrams.ai-ondevice.v1", "1"));
  await gotoCanvas(page, SLUG);
  await importDiagram(page, "Model plan");
  await makePrivate(page);
  await openAiPanel(page);
  await page.getByTestId("ai-private-ondevice-toggle").check();
  await expect(page.getByTestId("ai-ondevice-input")).toBeEnabled();
}

test("allowed, the on-device model changes a private diagram as one undoable turn", async ({ page, consoleErrors }) => {
  await privateWithModel(page, [RENAME]);
  await page.getByTestId("ai-ondevice-input").fill("Add a queue after Intake service");
  await page.getByTestId("ai-ondevice-input").press("Enter");
  await expect(page.getByTestId("ai-turn-0")).toBeVisible();
  await expect(page.getByTestId("ai-turn-0-who")).toContainText("On this device");
  await expect.poll(() => nodeCount(page)).toBe(3);
  await page.getByTestId("ai-turn-0-undo").click();
  await expect.poll(() => nodeCount(page)).toBe(2);
  expect((await fakeModel(page)).prompts).toHaveLength(1);
  // The page's tools stay off throughout.
  await expect(page.getByTestId("ai-agent-status")).toContainText("off for this private diagram");
  expectNoErrors(consoleErrors);
});

test("revoking the on-device permission cancels a pending reply", async ({ page }) => {
  await privateWithModel(page, [`hold:${RENAME}`]);
  await page.getByTestId("ai-ondevice-input").fill("Add a queue after Intake service");
  await page.getByTestId("ai-ondevice-input").press("Enter");
  await expect(page.getByTestId("ai-ondevice-status")).toHaveText("Thinking…");
  await page.getByTestId("ai-private-ondevice-toggle").uncheck();
  await expect(page.getByTestId("ai-ondevice")).toHaveCount(0);
  await expect.poll(async () => (await fakeModel(page)).aborted).toBe(1);
  await releaseModel(page);
  await page.waitForTimeout(300);
  await expect(page.getByTestId("ai-turn-0")).toHaveCount(0);
  expect(await nodeCount(page)).toBe(2);
});

test("private dictation never falls back to the speech service when the local language pack fails", async ({
  page,
  consoleErrors,
}) => {
  await installFakeLanguageModel(page);
  await installFakeSpeech(page, { onDevice: true });
  await page.addInitScript(() => localStorage.setItem("diagrams.ai-ondevice.v1", "1"));
  await gotoCanvas(page, SLUG);
  await importDiagram(page, "Spoken plan");
  await makePrivate(page);
  await openAiPanel(page);
  await page.getByTestId("ai-private-ondevice-toggle").check();
  await page.getByTestId("ai-ondevice-mic").click();
  await expect.poll(async () => (await speechState(page)).starts).toBe(1);
  expect((await speechState(page)).config).toMatchObject({ processLocally: true });
  // The on-device pack goes missing mid-session; a public diagram would carry on with the browser's service.
  await speech(page, "error", "language-not-supported");
  await speech(page, "silence");
  await expect(page.getByTestId("ai-ondevice-dictation-message")).toContainText("this diagram is private");
  await expect(page.getByTestId("ai-ondevice-mic")).toHaveAttribute("data-status", "idle");
  await page.waitForTimeout(300);
  expect((await speechState(page)).starts).toBe(1);
  expectNoErrors(consoleErrors);
});

for (const [format, item, file] of [
  ["draw.io", "export-drawio", "private.drawio"],
  ["Mermaid", "export-mermaid-download", "private.mmd"],
] as const) {
  test(`a private diagram exported to ${format} stays private when it's imported again`, async ({
    page,
    consoleErrors,
  }, info) => {
    await gotoCanvas(page, SLUG);
    await importDiagram(page, `${format} plan`);
    await makePrivate(page);
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId(item).click()]);
    const path = info.outputPath(file);
    await download.saveAs(path);
    await page.getByTestId("import-input").setInputFiles(path);
    await expect(page.getByTestId("toast").last()).toContainText("Imported");
    const again = await page.getByTestId("example-picker").inputValue();
    await expect(page.getByTestId("private-badge")).toHaveAttribute("data-kind", "private");
    expect((await entry(page, again)).private).toBe(true);
    expectNoErrors(consoleErrors);
  });
}

test("a private diagram gets no password link: the rows are off, and an open dialog closes without copying", async ({
  page,
  context,
  consoleErrors,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // Hold encryption (after PBKDF2) so the diagram can turn private while a link is being made.
  await context.addInitScript(() => {
    const w = window as unknown as { __holdEncrypt?: boolean; __releaseEncrypt?: () => void; __encrypting?: number };
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle) as (...a: unknown[]) => Promise<ArrayBuffer>;
    Object.defineProperty(crypto.subtle, "encrypt", {
      configurable: true,
      value: async (...args: unknown[]) => {
        if (w.__holdEncrypt) {
          w.__encrypting = (w.__encrypting ?? 0) + 1;
          await new Promise<void>((resolve) => (w.__releaseEncrypt = resolve));
        }
        return encrypt(...args);
      },
    });
  });
  await gotoCanvas(page, SLUG);
  const slug = await importDiagram(page, "Password plan");
  await page.evaluate(() => navigator.clipboard.writeText("before"));
  await page.getByTestId("file-button").click();
  await page.getByTestId("export-share-link-password").click();
  await page.getByTestId("password-link-input").fill("plum orbit lantern 42");
  await page.evaluate(() => ((window as unknown as { __holdEncrypt: boolean }).__holdEncrypt = true));
  await page.getByTestId("password-link-copy").click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __encrypting?: number }).__encrypting ?? 0), {
      timeout: 15_000,
    })
    .toBe(1);

  // Another tab makes it private while the link is being encrypted.
  const other = await context.newPage();
  await gotoCanvas(other, slug);
  await expect(other.getByTestId("diagram-title")).toHaveText("Password plan");
  await makePrivate(other);
  await expect(page.getByTestId("password-link-dialog")).toHaveCount(0);
  await expect(page.getByTestId("toast").filter({ hasText: PRIVATE_SHARE })).toBeVisible();
  await page.evaluate(() => (window as unknown as { __releaseEncrypt?: () => void }).__releaseEncrypt?.());
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("before");

  // Its menu rows are off, here and in the right-click's Export ▸.
  await page.getByTestId("file-button").click();
  await expect(page.getByTestId("export-share-link-password")).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByTestId("canvas-wrap").click({ button: "right", position: { x: 700, y: 60 } });
  await page.getByTestId("context-menu-item-canvas.export").hover();
  await expect(page.getByTestId("context-menu-item-export:share-password")).toHaveAttribute("aria-disabled", "true");
  await other.close();
  expectNoErrors(consoleErrors);
});
