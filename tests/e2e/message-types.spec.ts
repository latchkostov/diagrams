import { messageTypesFixture } from "../../src/lab/messageTypesFixture";
import {
  test,
  expect,
  STORAGE_KEYS,
  savedDiagram,
  waitForSelectionSettled,
  fitDiagram,
  gotoLab,
  pauseClock,
  expectNoErrors,
} from "./fixtures";
import type { Page } from "@playwright/test";

for (const preset of ["message-types", "live-message-types"]) {
  test(`${preset} Lab host shows carried types on hover and keyboard focus`, async ({ page }) => {
    await gotoLab(page, preset);
    const label = page.getByTestId("edge-label-send");
    await label.hover();
    await expect(label).toHaveAttribute("title", /Message types: Send, Callback/);
    await page.mouse.move(0, 0);
    await expect(label).not.toHaveAttribute("title", /Message types:/);
    await page.getByTestId("edge-send").evaluate((edge) => edge.parentElement?.focus());
    await expect(page.getByTestId("edge-messages-send")).toContainText("Message types: Send, Callback");
  });
}

test("a deferred vocabulary update preserves the highlighted type in an open picker", async ({ page }) => {
  await page.clock.install();
  await open(page);
  await pauseClock(page);
  await page.getByTestId("inspector-field-emits").click();
  await page.getByTestId("context-menu-item-new").click();
  await page.getByTestId("inspector-emits-new").fill("Aardvark");
  await page.getByTestId("inspector-emits-new").press("Enter");
  await page.getByTestId("inspector-field-emits").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("context-menu-item-1")).toHaveText("Send");
  await expect(page.getByTestId("context-menu-item-1")).toHaveAttribute("data-active", "true");
  await page.clock.runFor(1_500);
  await expect(page.getByTestId("context-menu-item-2")).toHaveText("Send");
  await expect(page.getByTestId("context-menu-item-2")).toHaveAttribute("data-active", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("inspector-field-emits")).toContainText("Send");
  await page.clock.runFor(400);
  await expect
    .poll(async () => (await savedDiagram(page)).edges.find((e) => e.id === "send")?.props?.emits)
    .toBe("Send");
});

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
    await page.getByTestId("inspector-section-edge-messages").click();
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
  // The hover reader is its own chunk (carriedTypes, without the inspector's pickers) in a build and its own module
  // on the dev server.
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
  await page.getByTestId("inspector-section-edge-messages").click();
  await expect(page.getByTestId("inspector-messages")).toBeVisible();
}

test("the message-loop Check warns with manual guidance and no automatic fix", async ({ page, consoleErrors }) => {
  await open(page);
  await page.getByTestId("checks-count").click();
  const row = page.getByTestId("check-row-message-loop:api");
  await expect(row).toContainText("Callback messages loop back to API: each one is sent again.");
  await expect(row).toContainText("Choose where the callback should stop, then check again.");
  await expect(page.getByTestId("check-fix-message-loop:api")).toHaveCount(0);
  await expect(page.getByTestId("inspector-carries")).toContainText("Callback");
  expect((await savedDiagram(page)).edges.find((edge) => edge.id === "send")?.props?.filter).toBeUndefined();
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
  await expect(page.getByTestId("inspector-carries")).toHaveText("Callback");
  await expect
    .poll(async () => (await savedDiagram(page)).edges.find((e) => e.id === "send")?.props?.emits)
    .toBe("Callback");
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

test("Send as persists an edge rename and Undo restores it", async ({ page, consoleErrors }) => {
  await open(page);
  const carries = page.getByTestId("inspector-carries");
  await expect(carries).toHaveText("SendCallback");
  const emits = async () => (await savedDiagram(page)).edges.find((e) => e.id === "send")?.props?.emits;
  expect(await emits()).toBeUndefined();
  await page.getByTestId("inspector-field-emits").click();
  await page.getByTestId("context-menu-item-0").click();
  await expect.poll(emits).toBe("Callback");
  await expect(carries).toHaveText("Callback");
  await page.getByTestId("undo-button").click();
  await expect.poll(emits).toBeUndefined();
  await expect(carries).toHaveText("SendCallback");
  expectNoErrors(consoleErrors);
});

test("changing a rule's incoming type keeps keyboard focus on that rule", async ({ page, consoleErrors }) => {
  const diagram = messageTypesFixture();
  diagram.nodes[1].props = { emits: { Send: "Send", Callback: "Callback" } };
  await open(page, "en", diagram);
  await fitDiagram(page);
  await page.getByTestId("node-api").click();
  await waitForSelectionSettled(page);
  await page.getByTestId("inspector-section-node-simulation").click();
  const receives = page.getByTestId("inspector-field-receives-0");
  const saved = async () => (await savedDiagram(page)).nodes.find((n) => n.id === "api")?.props?.emits;
  // From the menu: Unchanged, Any type, Send.
  await receives.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect.poll(saved).toEqual({ "*": "Send", Callback: "Callback" });
  await expect(receives).toBeFocused();
  // From a new-type draft.
  await page.keyboard.press("Enter");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  const draft = page.getByTestId("inspector-receives-0-new");
  await expect(draft).toBeFocused();
  await draft.fill("Fresh");
  await draft.press("Enter");
  await expect.poll(saved).toEqual({ Fresh: "Send", Callback: "Callback" });
  await expect(receives).toBeFocused();
  expectNoErrors(consoleErrors);
});

test("deselecting a type nothing upstream sends keeps focus among the chips", async ({ page, consoleErrors }) => {
  await open(page);
  await page.getByTestId("inspector-filter-add").click();
  await page.getByTestId("inspector-filter-new").fill("FutureCallback");
  await page.getByTestId("inspector-filter-new").press("Enter");
  // Only FutureCallback passes, so Callback no longer reaches this link: the chips are Send and FutureCallback.
  const custom = page.getByTestId("inspector-filter-option-1");
  await expect(custom).toHaveText("FutureCallback");
  await custom.focus();
  await page.keyboard.press("Space");
  // Passing all again brings Callback back in its place; focus stays on that chip rather than the page.
  await expect(custom).toHaveText("Callback");
  await expect(custom).toBeFocused();
  await expect(page.getByTestId("inspector-filter-option-2")).toHaveCount(0);
  await expect
    .poll(async () => (await savedDiagram(page)).edges.find((e) => e.id === "send")?.props?.filter)
    .toBeUndefined();
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

test("an imported empty filter blocks until explicitly cleared, and Undo restores it", async ({
  page,
  consoleErrors,
}) => {
  const diagram = messageTypesFixture();
  diagram.edges[1].props = { filter: [] };
  await open(page, "en", diagram);
  const carries = page.getByTestId("inspector-carries");
  const filter = async () => (await savedDiagram(page)).edges.find((e) => e.id === "send")?.props?.filter;
  await expect(carries).toContainText("No messages pass");
  await expect.poll(filter).toEqual([]);
  await page.getByTestId("inspector-filter-clear").click();
  await expect.poll(filter).toBeUndefined();
  await expect(carries).toHaveText("SendCallback");
  await page.getByTestId("undo-button").click();
  await expect.poll(filter).toEqual([]);
  await expect(carries).toContainText("No messages pass");
  await expect(page.getByTestId("inspector-filter-clear")).toBeVisible();
  expectNoErrors(consoleErrors);
});

test("Add a rule moves focus into the new rule when the button disables itself", async ({ page, consoleErrors }) => {
  const diagram = messageTypesFixture();
  diagram.nodes.push({ id: "lonely", stencil: "service.go", label: "Lonely", x: 380, y: 400 });
  await open(page, "en", diagram);
  await fitDiagram(page);
  await page.getByTestId("node-lonely").click();
  await waitForSelectionSettled(page);
  await page.getByTestId("inspector-section-node-simulation").click();
  const add = page.getByTestId("inspector-emits-add");
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("inspector-emits-row-0")).toBeVisible();
  await expect(add).toBeDisabled();
  await expect(page.getByTestId("inspector-field-receives-0")).toBeFocused();
  expectNoErrors(consoleErrors);
});

test("hovering an edge leaves Escape to the focused inspector draft", async ({ page, consoleErrors }) => {
  await open(page);
  await page.getByTestId("inspector-filter-add").click();
  const draft = page.getByTestId("inspector-filter-new");
  await expect(draft).toBeFocused();
  await page.getByTestId("edge-label-callback").hover();
  await expect(page.getByTestId("edge-label-callback")).toHaveAttribute("title", /Message types: Callback/);
  await page.keyboard.press("Escape");
  await expect(draft).toHaveCount(0);
  expectNoErrors(consoleErrors);
});

test("selected filters beyond the choice limit remain removable", async ({ page, consoleErrors }) => {
  const diagram = messageTypesFixture();
  // 101 saved-run types reach the send link: more than a picker lists.
  diagram.simulations = [
    {
      id: "many",
      title: "Many types",
      traffic: Array.from({ length: 101 }, (_, i) => ({
        id: `t${i}`,
        node: "client",
        messageType: `Type${i}`,
        shape: { kind: "burst" as const, count: 1 },
      })),
    },
  ];
  diagram.edges[1].props = { filter: ["Type100"] };
  await open(page, "en", diagram);
  const filter = async () => (await savedDiagram(page)).edges.find((e) => e.id === "send")?.props?.filter;
  await expect(page.getByTestId("inspector-filter-more")).toBeVisible();
  // The imported selection renders first, pressed, although it is past the listed choices.
  const imported = page.getByTestId("inspector-filter-option-0");
  await expect(imported).toHaveText("Type100");
  await expect(imported).toHaveAttribute("aria-pressed", "true");
  await imported.click();
  await expect.poll(filter).toBeUndefined();
  await expect(page.getByTestId("inspector-filter-option-0")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("undo-button").click();
  await expect.poll(filter).toEqual(["Type100"]);
  await expect(page.getByTestId("inspector-filter-option-0")).toHaveText("Type100");
  await expect(page.getByTestId("inspector-filter-option-0")).toHaveAttribute("aria-pressed", "true");
  // A newly added custom type is listed with it, and removable too.
  await page.getByTestId("inspector-filter-add").click();
  await page.getByTestId("inspector-filter-new").fill("Custom");
  await page.getByTestId("inspector-filter-new").press("Enter");
  await expect.poll(filter).toEqual(["Type100", "Custom"]);
  const custom = page.getByTestId("inspector-filter-option-1");
  await expect(custom).toHaveText("Custom");
  await expect(custom).toHaveAttribute("aria-pressed", "true");
  await custom.click();
  await expect.poll(filter).toEqual(["Type100"]);
  await page.getByTestId("undo-button").click();
  await expect.poll(filter).toEqual(["Type100", "Custom"]);
  await expect(page.getByTestId("inspector-filter-option-1")).toHaveText("Custom");
  expectNoErrors(consoleErrors);
});

test("a large rename map stays paged: Add shows only the new rule, and more rules take focus", async ({
  page,
  consoleErrors,
}) => {
  const diagram = messageTypesFixture();
  diagram.nodes[1].props = {
    emits: Object.fromEntries(Array.from({ length: 2_000 }, (_, i) => [`T${i}`, `T${i}Out`])),
  };
  await open(page, "en", diagram);
  await fitDiagram(page);
  await page.getByTestId("node-api").click();
  await waitForSelectionSettled(page);
  await page.getByTestId("inspector-section-node-simulation").click();
  const rules = page.locator('[data-testid^="inspector-emits-row-"]');
  await expect(rules).toHaveCount(25);
  await page.getByTestId("inspector-emits-add").click();
  // The new rule (index 2,000) renders after the page and takes focus; nothing in between mounts.
  await expect(page.getByTestId("inspector-emits-row-2000")).toBeVisible();
  await expect(rules).toHaveCount(26);
  await expect(page.getByTestId("inspector-field-receives-2000")).toBeFocused();
  await page.getByTestId("undo-button").click();
  await expect(page.getByTestId("inspector-emits-row-2000")).toHaveCount(0);
  await expect(rules).toHaveCount(25);
  const more = page.getByTestId("inspector-emits-more");
  await expect(more).toHaveText("+25 more");
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(rules).toHaveCount(50);
  await expect(page.getByTestId("inspector-field-receives-25")).toBeFocused();
  expectNoErrors(consoleErrors);
});

test("a 30,000-entry imported filter stays bounded and clears to pass-all in one undoable step", async ({
  page,
  consoleErrors,
}) => {
  const diagram = messageTypesFixture();
  diagram.edges[1].props = { filter: Array.from({ length: 30_000 }, (_, i) => `F${i}`) };
  await open(page, "en", diagram);
  const filter = async () => (await savedDiagram(page)).edges.find((e) => e.id === "send")?.props?.filter;
  const chips = page.locator('[data-testid^="inspector-filter-option-"]');
  await expect(page.getByTestId("inspector-filter-more-selected")).toHaveText("+29,900 selected");
  await expect(chips).toHaveCount(101);
  await page.getByTestId("inspector-filter-clear-all").click();
  await expect.poll(filter).toBeUndefined();
  await expect(page.getByTestId("inspector-carries")).toHaveText("SendCallback");
  await expect(page.getByTestId("inspector-filter-more-selected")).toHaveCount(0);
  await expect(page.getByTestId("inspector-filter-option-0")).toBeFocused();
  await page.getByTestId("undo-button").click();
  await expect.poll(async () => (await filter())?.length).toBe(30_000);
  await expect(chips).toHaveCount(101);
  await expect(page.getByTestId("inspector-filter-more-selected")).toBeVisible();
  expectNoErrors(consoleErrors);
});

test("deselecting a known type beyond the choice limit keeps chip focus", async ({ page, consoleErrors }) => {
  const diagram = messageTypesFixture();
  diagram.simulations = [
    {
      id: "many",
      title: "Many types",
      traffic: Array.from({ length: 101 }, (_, i) => ({
        id: `t${i}`,
        node: "client",
        messageType: `Type${i}`,
        shape: { kind: "burst" as const, count: 1 },
      })),
    },
  ];
  diagram.edges[1].props = { filter: ["Type100"] };
  await open(page, "en", diagram);
  const first = page.getByTestId("inspector-filter-option-0");
  await expect(first).toHaveText("Type100");
  await first.focus();
  await page.keyboard.press("Space");
  await expect
    .poll(async () => (await savedDiagram(page)).edges.find((e) => e.id === "send")?.props?.filter)
    .toBeUndefined();
  // Type100 is past the listed choices once unselected: focus moves to the chip now in its place.
  await expect(page.getByTestId("inspector-filter-option-0")).not.toHaveText("Type100");
  await expect(page.getByTestId("inspector-filter-option-0")).toBeFocused();
  expectNoErrors(consoleErrors);
});

test("an appended paged rule stays visible and focused after rekeying", async ({ page, consoleErrors }) => {
  const diagram = messageTypesFixture();
  diagram.nodes[1].props = {
    emits: Object.fromEntries(Array.from({ length: 2_000 }, (_, i) => [`T${i}`, `T${i}Out`])),
  };
  await open(page, "en", diagram);
  await fitDiagram(page);
  await page.getByTestId("node-api").click();
  await waitForSelectionSettled(page);
  await page.getByTestId("inspector-section-node-simulation").click();
  const rules = page.locator('[data-testid^="inspector-emits-row-"]');
  await page.getByTestId("inspector-emits-add").click();
  const receives = page.getByTestId("inspector-field-receives-2000");
  await expect(receives).toBeFocused();
  // Unchanged, Any message type, Send (its own), Callback.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Home");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => {
      const emits = (await savedDiagram(page)).nodes.find((n) => n.id === "api")?.props?.emits as Record<
        string,
        string
      >;
      return [Object.keys(emits).length, emits.Callback, emits.Send];
    })
    .toEqual([2_001, "Send", undefined]);
  await expect(page.getByTestId("inspector-emits-row-2000")).toBeVisible();
  await expect(rules).toHaveCount(26);
  await expect(receives).toBeFocused();
  await page.getByTestId("undo-button").click();
  await expect
    .poll(
      async () =>
        ((await savedDiagram(page)).nodes.find((n) => n.id === "api")?.props?.emits as Record<string, string>).Send,
    )
    .toBe("Send");
  await expect(page.getByTestId("inspector-emits-row-2000")).toBeVisible();
  await expect(rules).toHaveCount(26);
  await receives.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("inspector-field-receives-2000-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(receives).toBeFocused();
  await page.getByTestId("inspector-emits-remove-0").click();
  await expect(page.getByTestId("inspector-emits-row-1999")).toBeVisible();
  await expect(rules).toHaveCount(26);
  await page.getByTestId("undo-button").click();
  await expect(page.getByTestId("inspector-emits-row-2000")).toBeVisible();
  await expect(rules).toHaveCount(26);
  expectNoErrors(consoleErrors);
});

/** The canvas-wide flow-edge reader: its own chunk in a build, its source module on the dev server. */
const EDGE_READER = /\/(?:assets\/EdgeMessages-[\w-]+\.js|src\/canvas\/edges\/EdgeMessages\.tsx)(?:\?.*)?$/;

async function seed(page: Page) {
  await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    key: STORAGE_KEYS.autosavePrefix + "webhook-ingestion",
    diagram: messageTypesFixture(),
  });
  await page.mouse.move(0, 0);
  await page.goto("./?view=canvas&example=webhook-ingestion");
}

test("the flow-edge reader loads after the first view; a hover made while it is held reads on arrival", async ({
  page,
  consoleErrors,
}) => {
  let requested = false;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(EDGE_READER, async (route) => {
    requested = true;
    await ready;
    await route.continue();
  });
  try {
    await seed(page);
    await expect.poll(() => requested).toBe(true);
    // The canvas works while the reader is held: selection, the inspector, hovering.
    await page.getByTestId("node-api").click();
    await waitForSelectionSettled(page);
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("API");
    const label = page.getByTestId("edge-label-send");
    await label.hover();
    await expect(label).not.toHaveAttribute("title", /Message types:/);
    release();
    // The pointer was already on the label when the reader arrived: no second hover needed.
    await expect(label).toHaveAttribute("title", /Message types: Send, Callback/);
    await page.mouse.move(0, 0);
    await expect(label).not.toHaveAttribute("title", /Message types:/);
    expectNoErrors(consoleErrors);
  } finally {
    release();
  }
});

test("a failed flow-edge reader download offers Retry in a toast, then hovered edges read", async ({ page }) => {
  let fail = true;
  await page.route(EDGE_READER, (route) => (fail ? route.abort("failed") : route.continue()));
  await seed(page);
  await expect(page.getByTestId("toast")).toContainText("Part of the app couldn't be downloaded");
  await expect(page.getByTestId("node-api")).toBeVisible();
  fail = false;
  await page.getByTestId("lazy-load-retry").click();
  const label = page.getByTestId("edge-label-send");
  await label.hover();
  await expect(label).toHaveAttribute("title", /Message types: Send, Callback/);
});

test("several processors edit Emits as text, saved once the map parses", async ({ page, consoleErrors }) => {
  await page.clock.install();
  const diagram = messageTypesFixture();
  diagram.nodes[1].props = { emits: { Send: "OriginalAPI" } };
  diagram.nodes[2].props = { emits: { Callback: "OriginalSender" } };
  await open(page, "en", diagram);
  await fitDiagram(page);
  await page.getByTestId("node-api").click();
  await waitForSelectionSettled(page);
  // Selecting brings API into view; fit again so Sender is on screen too.
  await fitDiagram(page);
  await page.getByTestId("node-sender").click({ modifiers: ["ControlOrMeta"] });
  await waitForSelectionSettled(page);
  await page.getByTestId("inspector-section-multi-simulation").click();
  const emits = page.getByTestId("inspector-field-emits");
  const saved = async () =>
    (await savedDiagram(page)).nodes.filter((n) => n.id === "api" || n.id === "sender").map((n) => n.props?.emits);
  const original = [{ Send: "OriginalAPI" }, { Callback: "OriginalSender" }];
  // Both incomplete syntax and parsed-but-invalid JSON must preserve distinct saved maps.
  for (const draft of ["Send → Order, Callback", '{"Send":', '{"Send": 4}']) {
    await emits.fill(draft);
    await expect(emits).toHaveValue(draft);
    await page.clock.runFor(400);
    await expect.poll(saved).toEqual(original);
  }
  await emits.fill("Send → Order, Callback → Done");
  const map = { Send: "Order", Callback: "Done" };
  await expect.poll(saved).toEqual([map, map]);
  await emits.blur();
  await expect(emits).toHaveValue("Send → Order, Callback → Done");
  await page.getByTestId("undo-button").click();
  await expect.poll(saved).toEqual(original);
  expectNoErrors(consoleErrors);
});

test("overflow filter selections are searchable and individually removable with keyboard focus", async ({ page }) => {
  const diagram = messageTypesFixture();
  diagram.edges[1].props = { filter: Array.from({ length: 30_000 }, (_, i) => `F${i}`) };
  await open(page, "en", diagram);
  const search = page.getByTestId("inspector-filter-search");
  await search.fill("F29999");
  const chip = page.getByTestId("inspector-filter-option-0");
  await expect(chip).toHaveText("F29999");
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId(/^inspector-filter-option-/)).toHaveCount(1);
  await search.press("Tab");
  await expect(chip).toBeFocused();
  await page.keyboard.press("Space");
  await expect
    .poll(async () => (await savedDiagram(page)).edges[1].props?.filter)
    .toEqual(Array.from({ length: 29_999 }, (_, i) => `F${i}`));
  await expect(page.getByTestId("inspector-filter-add")).toBeFocused();
  await search.fill("");
  await expect(page.getByTestId(/^inspector-filter-option-/)).toHaveCount(101);
});

test("Carries search reveals omitted names while broad matches stay bounded", async ({ page }) => {
  const diagram = messageTypesFixture();
  diagram.edges = diagram.edges.slice(0, 2);
  diagram.simulations = [
    {
      id: "types",
      title: "Vocabulary",
      traffic: Array.from({ length: 250 }, (_, i) => ({
        id: `t${i}`,
        node: "client",
        messageType: `Type${i}`,
        shape: { kind: "burst" as const, count: 1 },
      })),
    },
  ];
  await open(page, "en", diagram);
  const search = page.getByTestId("inspector-carries-search");
  const chips = page.getByTestId("inspector-carries-type");
  await expect(chips).toHaveCount(100);
  await search.focus();
  await page.keyboard.type("Type249");
  await expect(chips).toHaveText(["Type249"]);
  await search.fill("Type");
  await expect(chips).toHaveCount(100);
  await expect(page.getByTestId("inspector-carries-more")).toHaveText("+150 more");
  await expect(search).toBeFocused();
  // A narrower filter hides the search control: its old query must no longer hide the remaining type.
  await search.fill("Type249");
  await page.getByTestId("inspector-filter-search").fill("Type0");
  await page.getByTestId("inspector-filter-option-0").click();
  await expect(chips).toHaveText(["Type0"]);
  await expect(search).toHaveCount(0);
});

test("focused message cards wrap long tokens in a short viewport", async ({ page }) => {
  const diagram = messageTypesFixture();
  diagram.nodes[0].props = { messageType: "X".repeat(200) };
  diagram.edges = diagram.edges.slice(0, 2);
  await open(page, "en", diagram);
  await page.setViewportSize({ width: 1280, height: 500 });
  await page.mouse.move(0, 0);
  const edge = page.getByTestId("edge-send");
  await edge.evaluate((el) => el.parentElement?.focus());
  const card = page.getByTestId("edge-messages-send");
  await expect(card).toContainText("X".repeat(200));
  const dimensions = await card.evaluate((el) => ({
    width: el.clientWidth,
    scroll: el.scrollWidth,
    height: el.clientHeight,
    line: parseFloat(getComputedStyle(el).lineHeight),
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
  expect(dimensions.height).toBeGreaterThan(dimensions.line * 2);
  const box = await card.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(340);
});

test("focused message cards take Escape before canvas selection", async ({ page }) => {
  await open(page);
  await page.mouse.move(0, 0);
  const edge = page.getByTestId("edge-send");
  await edge.evaluate((el) => el.parentElement?.focus());
  const card = page.getByTestId("edge-messages-send");
  await expect(card).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId("inspector-messages")).toBeVisible();
  await expect.poll(() => edge.evaluate((el) => document.activeElement === el.parentElement)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("inspector-messages")).toHaveCount(0);
});

test("two canvases with overlapping edge IDs keep hover titles and focused cards local", async ({ page }) => {
  await gotoLab(page, "message-readers");
  const west = page.getByTestId("message-reader-West");
  const east = page.getByTestId("message-reader-East");
  await west.getByTestId("edge-label-send").hover();
  await expect(west.getByTestId("edge-label-send")).toHaveAttribute("title", /Message types: West, WestCallback/);
  await expect(east.getByTestId("edge-label-send")).not.toHaveAttribute("title", /Message types:/);
  await east.getByTestId("edge-send").evaluate((el) => el.parentElement?.focus());
  await expect(east.getByTestId("edge-messages-send")).toContainText("Message types: East, EastCallback");
  await expect(west.getByTestId("edge-messages-send")).toHaveCount(0);
  await expect(west.getByTestId("edge-label-send")).toHaveAttribute("title", /Message types: West, WestCallback/);
  await expect(east.getByTestId("edge-label-send")).toHaveAttribute("title", /Message types: East, EastCallback/);
});
