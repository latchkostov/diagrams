import { messageTypesFixture } from "../../src/lab/messageTypesFixture";
import {
  test,
  expect,
  STORAGE_KEYS,
  savedDiagram,
  waitForSelectionSettled,
  fitDiagram,
  expectNoErrors,
} from "./fixtures";
import type { Page } from "@playwright/test";

test("message fields show loading while the inspector chunk is held and recover after release", async ({
  page,
  consoleErrors,
}) => {
  let release!: () => void;
  let requested!: () => void;
  const held = new Promise<void>((resolve) => {
    requested = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    /\/(?:assets\/MessageFields-[\w-]+\.js|src\/canvas\/inspector\/MessageFields\.tsx)(?:\?.*)?$/,
    async (route) => {
      requested();
      await ready;
      await route.continue();
    },
  );
  try {
    await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
      key: STORAGE_KEYS.autosavePrefix + "webhook-ingestion",
      diagram: messageTypesFixture(),
    });
    await page.goto("./?view=canvas&example=webhook-ingestion");
    await page.getByTestId("edge-label-send").click();
    await waitForSelectionSettled(page);
    await page.getByTestId("inspector-section-edge-simulation").click();
    await held;
    await expect(page.getByTestId("message-fields-loading")).toBeVisible();
    await expect(page.getByTestId("inspector-field-label")).toBeEnabled();
    release();
    await expect(page.getByTestId("inspector-carries")).toContainText("Callback");
    expectNoErrors(consoleErrors);
  } finally {
    release();
  }
});

test("hover types load on intent and the canvas stays usable while their chunk is held", async ({
  page,
  consoleErrors,
}) => {
  let release!: () => void;
  let requested!: () => void;
  const held = new Promise<void>((resolve) => {
    requested = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    /\/(?:assets\/carriedTypes-[\w-]+\.js|src\/canvas\/edges\/carriedTypes\.ts)(?:\?.*)?$/,
    async (route) => {
      requested();
      await ready;
      await route.continue();
    },
  );
  try {
    await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
      key: STORAGE_KEYS.autosavePrefix + "webhook-ingestion",
      diagram: messageTypesFixture(),
    });
    await page.mouse.move(0, 0);
    await page.goto("./?view=canvas&example=webhook-ingestion");
    const label = page.getByTestId("edge-label-send");
    await expect(label).toBeVisible();
    await label.hover();
    await held;
    await expect(page.getByTestId("node-api")).toBeVisible();
    await expect(label).not.toHaveAttribute("title", /Message types:/);
    release();
    await expect(label).toHaveAttribute("title", /Message types: Send, Callback/);
    expectNoErrors(consoleErrors);
  } finally {
    release();
  }
});

async function open(page: Page, locale = "en", diagram = messageTypesFixture()) {
  await page.addInitScript(
    ({ key, diagram, locale }) => {
      localStorage.setItem(key, JSON.stringify(diagram));
      localStorage.setItem("diagrams.locale", locale);
    },
    { key: STORAGE_KEYS.autosavePrefix + "webhook-ingestion", diagram, locale },
  );
  await page.goto("./?view=canvas&example=webhook-ingestion");
  await expect(page.getByTestId("node-api")).toBeVisible();
  await page.getByTestId("edge-label-send").click();
  await waitForSelectionSettled(page);
  await page.getByTestId("inspector-section-edge-simulation").click();
  await expect(page.getByTestId("inspector-messages")).toBeVisible();
}

test("the message-loop Check fixes the callback and one Undo restores its settings", async ({
  page,
  consoleErrors,
}) => {
  await open(page);
  await page.getByTestId("checks-count").click();
  const row = page.getByTestId("check-row-message-loop:api");
  await expect(row).toContainText("Callback messages loop back to API: each one is sent again.");
  await page.getByTestId("check-fix-message-loop:api").click();
  // Applying diagram operations clears selection. Reopen the edited edge before inspecting its fields.
  await page.getByTestId("edge-label-send").click();
  await waitForSelectionSettled(page);
  await expect(page.getByTestId("inspector-carries")).toHaveText("Send");
  await expect(row).toHaveCount(0);
  await page.getByTestId("undo-button").click();
  await page.getByTestId("edge-label-send").click();
  await waitForSelectionSettled(page);
  await expect(page.getByTestId("inspector-carries")).toContainText("Callback");
  await expect(row).toBeVisible();
  expectNoErrors(consoleErrors);
});

test("Only pass selects a known message type without typing, updates Carries and undoes once", async ({
  page,
  consoleErrors,
}) => {
  await open(page);
  const carries = page.getByTestId("inspector-carries");
  await expect(carries).toContainText("Send");
  await expect(carries).toContainText("Callback");
  const send = page.getByTestId("inspector-filter-option-0");
  await expect(send).toHaveText("Send");
  await send.click();
  await expect(send).toHaveAttribute("aria-pressed", "true");
  await expect(carries).toHaveText("Send");
  await expect
    .poll(async () => (await savedDiagram(page)).edges.find((e) => e.id === "send")?.props?.filter)
    .toEqual(["Send"]);
  await page.getByTestId("undo-button").click();
  await expect(carries).toContainText("Callback");
  await expect(send).toHaveAttribute("aria-pressed", "false");
  expectNoErrors(consoleErrors);
});

test("adds a new type with feedback, and the keyboard walks and toggles chip choices", async ({
  page,
  consoleErrors,
}) => {
  await open(page);
  const first = page.getByTestId("inspector-filter-option-0");
  const second = page.getByTestId("inspector-filter-option-1");
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(second).toBeFocused();
  await page.keyboard.press("Space");
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Space");
  await expect(second).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("inspector-filter-add").focus();
  await page.keyboard.press("Enter");
  const input = page.getByTestId("inspector-filter-new");
  await expect(input).toBeFocused();
  await input.fill("FutureCallback");
  await input.press("Enter");
  await expect(page.getByTestId("inspector-filter-unknown")).toContainText("Nothing upstream sends this type yet");
  await expect(page.getByTestId("inspector-carries")).toContainText("No messages pass");
  await expect
    .poll(async () => (await savedDiagram(page)).edges.find((e) => e.id === "send")?.props?.filter)
    .toEqual(["FutureCallback"]);
  expectNoErrors(consoleErrors);
});

test("Send as and source Sends pick existing types; processor Emits edits and removes a row", async ({
  page,
  consoleErrors,
}) => {
  await open(page);
  await page.getByTestId("inspector-field-emits").click();
  await page.getByTestId("context-menu-item-0").click();
  await expect(page.getByTestId("inspector-carries")).toContainText("Callback");
  await fitDiagram(page);
  await page.getByTestId("node-client").click();
  await waitForSelectionSettled(page);
  await page.getByTestId("inspector-section-node-simulation").click();
  await page.getByTestId("inspector-field-messageType").click();
  await page.getByTestId("context-menu-item-0").click();
  await expect
    .poll(async () => (await savedDiagram(page)).nodes.find((n) => n.id === "client")?.props?.messageType)
    .toBe("Callback");
  await fitDiagram(page);
  await page.getByTestId("node-api").click();
  await waitForSelectionSettled(page);
  await page.getByTestId("inspector-emits-add").click();
  await expect(page.getByTestId("inspector-emits-row-0")).toBeVisible();
  await page.getByTestId("inspector-field-sends-0").click();
  await page.getByTestId("context-menu-item-new").click();
  await page.getByTestId("inspector-sends-0-new").fill("Processed");
  await page.getByTestId("inspector-sends-0-new").press("Enter");
  await expect
    .poll(async () => (await savedDiagram(page)).nodes.find((n) => n.id === "api")?.props?.emits)
    .toEqual({ Callback: "Processed" });
  await page.getByTestId("inspector-emits-remove-0").click();
  await expect(page.getByTestId("inspector-emits-row-0")).toHaveCount(0);
  await expect(page.getByTestId("inspector-emits-add")).toBeFocused();
  await page.getByTestId("undo-button").click();
  await expect(page.getByTestId("inspector-emits-row-0")).toContainText("Processed");
  expectNoErrors(consoleErrors);
});

for (const locale of ["ar", "en-XA"])
  test(`message pickers fit the inspector in ${locale}`, async ({ page, consoleErrors }) => {
    await open(page, locale);
    await expect(page.getByTestId("inspector-filter-option-0")).toBeVisible();
    await page.getByTestId("inspector-filter-option-0").click();
    await expect(page.getByTestId("inspector-carries")).toHaveText("Send");
    const box = await page
      .getByTestId("inspector-messages")
      .evaluate((element) => ({ width: element.clientWidth, content: element.scrollWidth }));
    expect(box.content).toBeLessThanOrEqual(box.width);
    expectNoErrors(consoleErrors);
  });

test("a new-type draft focuses once and does not steal focus from another field", async ({ page, consoleErrors }) => {
  await open(page);
  await page.getByTestId("inspector-filter-add").click();
  await expect(page.getByTestId("inspector-filter-new")).toBeFocused();
  const label = page.getByTestId("inspector-field-label");
  await label.focus();
  await label.fill("Dispatch renamed");
  await expect(label).toBeFocused();
  await label.press("End");
  await label.press("x");
  await expect(label).toHaveValue("Dispatch renamedx");
  expectNoErrors(consoleErrors);
});

test("removing a processor rule discards its draft and both removal paths restore focus", async ({
  page,
  consoleErrors,
}) => {
  const diagram = messageTypesFixture();
  diagram.nodes[1].props = { emits: { Send: "Send", Callback: "Callback" } };
  await open(page, "en", diagram);
  await fitDiagram(page);
  await page.getByTestId("node-api").click();
  await waitForSelectionSettled(page);
  await page.getByTestId("inspector-section-node-simulation").click();
  await page.getByTestId("inspector-field-sends-0").click();
  await page.getByTestId("context-menu-item-new").click();
  await page.getByTestId("inspector-sends-0-new").fill("DiscardedDraft");
  await page.getByTestId("inspector-emits-remove-0").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("inspector-emits-row-1")).toHaveCount(0);
  await expect(page.getByTestId("inspector-sends-0-new")).toHaveCount(0);
  await expect(page.getByTestId("inspector-field-receives-0")).toBeFocused();
  await page.getByTestId("inspector-field-sends-0").press("Enter");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("inspector-emits-row-0")).toHaveCount(0);
  await expect(page.getByTestId("inspector-emits-add")).toBeFocused();
  expectNoErrors(consoleErrors);
});

test("keyboard-focused flow edges show and announce carried message types", async ({ page, consoleErrors }) => {
  await open(page);
  await fitDiagram(page);
  const node = page.getByTestId("node-api");
  await node.click();
  await waitForSelectionSettled(page);
  // Keyboard navigation focuses the React Flow edge wrapper, the canvas's own Tab stop.
  // eslint-disable-next-line no-restricted-syntax -- Canvas navigation uses literal Ctrl+Alt on every OS.
  await page.keyboard.press("Control+Alt+BracketRight");
  const tip = page.getByTestId("edge-messages-send");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("Message types: Send, Callback");
  expect(
    await page.getByTestId("edge-send").evaluate((element) => {
      const wrapper = element.parentElement;
      return (
        wrapper === document.activeElement &&
        wrapper?.getAttribute("aria-describedby")?.split(" ").includes("edge-messages-send")
      );
    }),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);
  await node.click();
  await waitForSelectionSettled(page);
  // eslint-disable-next-line no-restricted-syntax -- Canvas navigation uses literal Ctrl+Alt on every OS.
  await page.keyboard.press("Control+Alt+BracketRight");
  await expect(tip).toBeVisible();
  await page.getByTestId("inspector-field-label").focus();
  await expect(tip).toHaveCount(0);
  expectNoErrors(consoleErrors);
});
