import { test, expect, gotoLab, gotoCanvas, pauseClock, expectNoErrors } from "./fixtures";
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
