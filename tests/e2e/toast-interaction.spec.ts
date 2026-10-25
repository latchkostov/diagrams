import { test, expect, gotoLab, gotoCanvas, pauseClock, expectNoErrors } from "./fixtures";
import { mixedBoundaryDragFixture } from "../../src/lab/nestedBoundariesFixture";
import { STORAGE_KEYS, savedDiagram, fitDiagram, waitForSelectionSettled, waitForHistoryIdle } from "./fixtures";
import { SLUG, callTool, installFakeModelContext, toolNames } from "./ai-helpers";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  for (const contact of ["hover", "focus", "press"] as const) {
    test(`${contact}: Undo stays put across a notification and bar movement (${reducedMotion})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
      await gotoLab(page, "toast-interaction");
      await page.clock.install();
      await pauseClock(page);
      await page.getByTestId("toast-lab-first").click();
      const undo = page.getByTestId("toast-lab-undo");
      if (contact === "focus") await undo.focus();
      else await undo.hover();
      const before = await undo.boundingBox();
      if (!before) throw new Error("Expected Undo on screen");
      const point = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
      if (contact === "press") await page.mouse.down();
      // An external notification arrives while the user's pointer/key/press remains on Undo.
      await page.getByTestId("toast-lab-next").evaluate((button: HTMLButtonElement) => button.click());
      await page.getByTestId("toast-lab-bar").evaluate((button: HTMLButtonElement) => button.click());
      await expect(page.getByTestId("toast-lab-avoid")).toHaveCSS("bottom", "100px");
      // Advance placement and expiry together, proving neither can invalidate the engaged target.
      await page.clock.fastForward(7000);
      await expect(undo).toBeVisible();
      expect(await undo.boundingBox()).toEqual(before);
      await expect(page.getByTestId("toast")).toHaveAttribute("aria-live", "polite");
      if (reducedMotion === "reduce") await expect(page.getByTestId("toast")).toHaveCSS("animation-name", "none");
      if (contact === "focus") await page.keyboard.press("Enter");
      else if (contact === "press") await page.mouse.up();
      else await page.mouse.click(point.x, point.y);
      await expect(page.getByTestId("toast-lab-undos")).toHaveText("1");
      await expect(page.getByTestId("toast")).toContainText("Second notification");
      // Released toasts follow the bar again; no permanent frozen stack or notification loss.
      await expect(page.getByTestId("toast")).toHaveCSS("bottom", "140px");
    });
  }
}

for (const contact of ["hover", "focus"] as const) {
  test(`stale Undo: retained agent change A cannot undo B (${contact})`, async ({ page, consoleErrors }) => {
    await installFakeModelContext(page);
    await gotoCanvas(page, SLUG);
    await expect.poll(() => toolNames(page)).toContain("edit_diagram");
    await page.clock.install();
    await pauseClock(page);
    const edit = (label: string) =>
      callTool(page, "edit_diagram", {
        ops: [{ op: "add_node", kind: "Redis cache", label }],
      });
    expect((await edit("change-a")).isError).toBe(false);
    const undo = page.getByTestId("ai-toast-undo");
    if (contact === "hover") await undo.hover();
    else await undo.focus();
    const before = await undo.boundingBox();
    expect((await edit("change-b")).isError).toBe(false);
    await expect(undo).toHaveAttribute("aria-disabled", "true");
    await expect(undo).toHaveAccessibleDescription("Undo unavailable: the diagram changed.");
    expect(await undo.boundingBox()).toEqual(before);
    if (contact === "focus") {
      await expect(undo).toBeFocused();
      await page.keyboard.press("Enter");
    } else await undo.evaluate((button: HTMLButtonElement) => button.click());
    // Both actual editor changes survive activation of A's obsolete action.
    const described = await callTool(page, "describe_diagram");
    expect(described.text).toContain("change-a");
    expect(described.text).toContain("change-b");
    if (contact === "hover") await page.getByTestId("ai-rail-open").hover();
    else await page.keyboard.press("Tab");
    // Tab first reaches Dismiss, which still engages the same toast; leave it too.
    if (contact === "focus") await page.keyboard.press("Tab");
    await expect(undo).not.toHaveAttribute("aria-disabled", "true");
    await undo.click();
    const after = await callTool(page, "describe_diagram");
    expect(after.text).toContain("change-a");
    expect(after.text).not.toContain("change-b");
    expectNoErrors(consoleErrors);
  });
}

for (const end of ["up", "cancel"] as const) {
  test(`press alone retains the toast after pointer and focus leave until ${end}`, async ({ page }) => {
    await gotoLab(page, "toast-interaction");
    await page.clock.install();
    await pauseClock(page);
    await page.getByTestId("toast-lab-first").click();
    const undo = page.getByTestId("toast-lab-undo");
    await undo.hover();
    const before = await undo.boundingBox();
    await page.mouse.down();
    await page.getByTestId("toast-lab-next").focus();
    await page.getByTestId("toast-lab-next").hover();
    await expect(page.getByTestId("toast-lab-next")).toBeFocused();
    await page.getByTestId("toast-lab-next").evaluate((button: HTMLButtonElement) => button.click());
    await page.getByTestId("toast-lab-bar").evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByTestId("toast-lab-avoid")).toHaveCSS("bottom", "100px");
    await page.clock.fastForward(7000);
    await expect(undo).toBeVisible();
    expect(await undo.boundingBox()).toEqual(before);
    if (end === "up") await page.mouse.up();
    else await page.getByTestId("toast-lab-next").dispatchEvent("pointercancel");
    await expect(page.getByTestId("toast")).toContainText("Second notification");
    await expect(page.getByTestId("toast")).toHaveCSS("bottom", "140px");
    await expect(page.getByTestId("toast-lab-undos")).toHaveText("0");
  });
}

for (const contact of ["hover", "focus"] as const) {
  for (const queued of [false, true]) {
    test(`disengagement: ${contact} release resumes ${queued ? "queued notifications and placement" : "expiry"}`, async ({
      page,
    }) => {
      await gotoLab(page, "toast-interaction");
      await page.clock.install();
      await pauseClock(page);
      await page.getByTestId("toast-lab-first").click();
      const undo = page.getByTestId("toast-lab-undo");
      if (contact === "hover") await undo.hover();
      else await undo.focus();
      if (queued) await page.getByTestId("toast-lab-next").evaluate((button: HTMLButtonElement) => button.click());
      await page.getByTestId("toast-lab-bar").evaluate((button: HTMLButtonElement) => button.click());
      await expect(page.getByTestId("toast-lab-avoid")).toHaveCSS("bottom", "100px");
      await page.clock.fastForward(7000);
      await expect(undo).toBeVisible();
      if (contact === "hover") await page.getByTestId("toast-lab-next").hover();
      else {
        await page.keyboard.press("Tab");
        await expect(page.getByTestId("toast-dismiss")).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(page.getByTestId("toast-dismiss")).not.toBeFocused();
      }
      if (queued) {
        await expect(page.getByTestId("toast")).toContainText("Second notification");
        await page.clock.fastForward(250);
        await expect(page.getByTestId("toast")).toHaveCSS("bottom", "140px");
      } else {
        await page.clock.fastForward(250);
        await expect(page.getByTestId("toast")).toHaveCSS("bottom", "140px");
        await page.clock.fastForward(7000);
        await expect(page.getByTestId("toast")).toHaveCount(0);
      }
      await expect(page.getByTestId("toast-lab-undos")).toHaveText("0");
    });
  }
}

test("mixed boundary drop binds Undo after all drag settlement", async ({ page, consoleErrors }) => {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    STORAGE_KEYS.autosavePrefix + SLUG,
    JSON.stringify(mixedBoundaryDragFixture),
  ] as const);
  await gotoCanvas(page, SLUG);
  await page.getByTestId("node-sibling").click();
  await page.getByTestId("group-label-child").click({ modifiers: ["Shift"] });
  await waitForSelectionSettled(page);
  await fitDiagram(page);
  await waitForHistoryIdle(page);
  const before = await savedDiagram(page);
  const node = await page.getByTestId("node-sibling").boundingBox();
  const child = await page.getByTestId("group-child").boundingBox();
  const parent = await page.getByTestId("group-grp-core").boundingBox();
  if (!node || !child || !parent) throw new Error("Missing drag geometry");
  const x = node.x + node.width / 2;
  const y = node.y + node.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + parent.y + parent.height - child.y + 30, { steps: 10 });
  await page.mouse.up();
  await waitForHistoryIdle(page);
  await expect
    .poll(async () => (await savedDiagram(page)).groups?.find((g) => g.id === "child")?.group)
    .toBeUndefined();
  await expect
    .poll(async () => (await savedDiagram(page)).nodes.find((n) => n.id === "sibling")?.group)
    .toBeUndefined();
  // Stop expiry only after the drop's real frame callbacks have committed their complete step.
  await page.clock.install();
  await pauseClock(page);
  const undo = page.getByTestId("membership-undo");
  await expect(undo).toBeVisible();
  await expect(undo).not.toHaveAttribute("aria-disabled", "true");
  await undo.click();
  await expect(undo).toHaveCount(0);
  await page.clock.resume();
  await expect
    .poll(async () => {
      const after = await savedDiagram(page);
      return { nodes: after.nodes, groups: after.groups, annotations: after.annotations };
    })
    .toEqual({ nodes: before.nodes, groups: before.groups, annotations: before.annotations });
  expectNoErrors(consoleErrors);
});

for (const cancel of ["keyboard", "pointer"] as const) {
  test(`retained toast leaves palette export and Cancel accessible (${cancel})`, async ({ page, consoleErrors }) => {
    await installFakeModelContext(page);
    await gotoCanvas(page, SLUG);
    await expect.poll(() => toolNames(page)).toContain("edit_diagram");
    expect(
      (
        await callTool(page, "edit_diagram", {
          ops: [{ op: "add_node", kind: "Redis cache", label: "Export candidate" }],
        })
      ).isError,
    ).toBe(false);
    const undo = page.getByTestId("ai-toast-undo");
    await undo.focus();
    await undo.hover();
    const geometry = await undo.boundingBox();
    // A press can outlive both hover and focus; retain it across the modal handoff too.
    if (cancel === "keyboard") await page.mouse.down();
    await page.keyboard.press("ControlOrMeta+k");
    const search = page.getByTestId("command-input");
    await expect(search).toBeFocused();
    await expect(undo).toBeHidden();
    // Modal controls remain both tabbable and pointer-accessible while the toast retains its rectangle.
    expect(await undo.boundingBox()).toEqual(geometry);
    await page.keyboard.press("Tab");
    await expect(undo).not.toBeFocused();
    if (cancel === "pointer") await search.click();
    else await search.focus();
    await search.fill("Export PNG");
    const release = Promise.withResolvers<undefined>();
    let stalled = false;
    await page.route(/(?:\/image-[^/]+\.js|\/src\/interop\/image\.ts)(?:\?|$)/, async (route) => {
      stalled = true;
      await release.promise;
      await route.abort();
    });
    const downloads: string[] = [];
    page.on("download", (download) => downloads.push(download.suggestedFilename()));
    try {
      await search.press("Enter");
      const button = page.getByTestId("image-export-cancel");
      await expect(button).toBeVisible();
      await expect(button).toBeFocused();
      await expect.poll(() => stalled).toBe(true);
      await page.keyboard.press("Tab");
      await expect(button).toBeFocused();
      if (cancel === "keyboard") await page.keyboard.press("Enter");
      else await button.click();
      await expect(button).toHaveCount(0);
      if (cancel === "keyboard") {
        await page.mouse.move(0, 0);
        await page.mouse.up();
      }
      await page.getByTestId("file-button").click();
      await expect(page.getByTestId("export-png")).toBeVisible();
      expect(downloads).toEqual([]);
    } finally {
      release.resolve(undefined);
    }
    expectNoErrors(consoleErrors);
  });
}
