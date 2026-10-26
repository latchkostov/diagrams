import type { Page } from "@playwright/test";
import {
  test,
  expect,
  gotoLab,
  gotoCanvas,
  pauseClock,
  expectNoErrors,
  shareVia,
  waitForHtmlTemplate,
} from "./fixtures";
import { mixedBoundaryDragFixture } from "../../src/lab/nestedBoundariesFixture";
import { STORAGE_KEYS, savedDiagram, fitDiagram, waitForSelectionSettled, waitForHistoryIdle } from "./fixtures";

type Box = { x: number; y: number; width: number; height: number };
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

// Toast layering (docs/design-review/2026-10-25-toast-layering.md): the page's notifications sit under every menu and
// modal and step back while one is open; a dialog's own feedback lives in that dialog, beside its panel.

/** Every enabled Tab stop's test id inside `root` (radios not checked are not Tab stops). */
async function tabStops(page: Page, testId: string) {
  return page
    .getByTestId(testId)
    .evaluate((root) =>
      [
        ...root.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ]
        .filter((el) => !el.matches(":disabled") && el.tabIndex >= 0 && el.getClientRects().length > 0)
        .map((el) => el.dataset.testid ?? `<${el.tagName.toLowerCase()}>`),
    );
}

/** Presses Tab `count` times, returning the test id focus reaches each time. */
async function tabThrough(page: Page, count: number) {
  const seen: string[] = [];
  for (let i = 0; i < count; i++) {
    await page.keyboard.press("Tab");
    seen.push(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid ?? ""));
  }
  return seen;
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function agentChange(page: Page, label: string) {
  expect(
    (await callTool(page, "edit_diagram", { ops: [{ op: "add_node", kind: "Redis cache", label }] })).isError,
  ).toBe(false);
}

async function openHtmlExportByKeyboard(page: Page) {
  const template = waitForHtmlTemplate(page);
  await page.keyboard.press("ControlOrMeta+k");
  const search = page.getByTestId("command-input");
  await expect(search).toBeFocused();
  await search.fill("Interactive HTML");
  await search.press("Enter");
  await expect(page.getByTestId("html-export-dialog")).toBeVisible();
  await template;
  await expect(page.getByTestId("html-export-download")).toBeEnabled();
  // The dialog's code arrives on real timers; expiry is held from here on.
  await pauseClock(page);
}

test("layering: an engaged toast never covers or takes the keyboard from an open export dialog", async ({
  page,
  consoleErrors,
}) => {
  await installFakeModelContext(page);
  await gotoCanvas(page, SLUG);
  await expect.poll(() => toolNames(page)).toContain("edit_diagram");
  await page.clock.install();
  await agentChange(page, "Export candidate");
  const undo = page.getByTestId("ai-toast-undo");
  await undo.focus();
  await undo.hover();
  const geometry = await undo.boundingBox();
  // Engaged by every contact; the press outlives hover and focus across the palette and the dialog opening.
  await page.mouse.down();
  await openHtmlExportByKeyboard(page);
  await expect(undo).toBeHidden();
  expect(await undo.boundingBox()).toEqual(geometry);

  // The keyboard: Tab visits every control of the dialog, options included, and never reaches the toast.
  await page.getByTestId("html-export-options-toggle").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("html-export-title")).toBeVisible();
  const controls = await tabStops(page, "html-export-dialog");
  expect(controls).toEqual(expect.arrayContaining(["html-export-password-toggle", "html-export-title"]));
  expect(controls).toEqual(expect.arrayContaining(["html-export-cancel", "html-export-download"]));
  const visited = await tabThrough(page, controls.length * 2);
  expect(new Set(visited)).toEqual(new Set(controls));
  await expect(undo).not.toBeFocused();
  expect(await undo.boundingBox()).toEqual(geometry);

  // The pointer: every control receives the click at its own centre (Playwright's hit-target check), none the toast.
  await page.mouse.up();
  for (const id of controls) await page.getByTestId(id).click({ trial: true });
  await page.getByTestId("html-export-theme-dark").click();
  await expect(page.getByTestId("html-export-theme-dark")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("html-export-title").fill("Layered export");
  // (Download would announce its file, replacing the notification: Cancel closes without a word.)
  await page.getByTestId("html-export-cancel").click();
  await expect(page.getByTestId("html-export-dialog")).toHaveCount(0);

  // Back in front, and its Undo still reverses its own change.
  await expect(undo).toBeVisible();
  await expect(undo).toBeInViewport();
  await undo.click();
  expect((await callTool(page, "describe_diagram")).text).not.toContain("Export candidate");
  expectNoErrors(consoleErrors);
});

for (const outcome of ["copied", "refused"] as const) {
  test(`layering: a dialog's own feedback (${outcome}) is visible, announced and clear of its controls`, async ({
    page,
    context,
    consoleErrors,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await installFakeModelContext(page);
    await gotoCanvas(page, SLUG);
    await expect.poll(() => toolNames(page)).toContain("edit_diagram");
    await page.clock.install();
    await pauseClock(page);
    await agentChange(page, "Behind the dialog");
    const pageToast = page.getByTestId("ai-toast-undo");
    await expect(pageToast).toBeVisible();
    const behind = await pageToast.boundingBox();
    await shareVia(page, "link");
    const dialog = page.getByTestId("share-link-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("share-link-url")).toHaveValue(/#d=/);
    await expect(pageToast).toBeHidden();
    // Stepped back: out of reach, but its rectangle kept.
    expect(await pageToast.boundingBox()).toEqual(behind);
    if (outcome === "refused")
      await page.evaluate(() => {
        navigator.clipboard.writeText = () => Promise.reject(new DOMException("Denied", "NotAllowedError"));
        document.execCommand = () => false;
      });
    await page.getByTestId("share-link-copy").click();

    const feedback = dialog.getByTestId("toast");
    await expect(feedback).toBeVisible();
    await expect(feedback).toBeInViewport();
    await expect(feedback).toHaveAttribute("data-layer", "dialog");
    if (outcome === "copied") {
      await expect(feedback).toHaveRole("status");
      await expect(feedback).toHaveAttribute("aria-live", "polite");
      await expect(feedback).toContainText("Share link copied.");
    } else {
      await expect(feedback).toHaveRole("alert");
      await expect(feedback).toHaveAttribute("aria-live", "assertive");
      await expect(feedback).toContainText("Couldn't copy automatically.");
    }
    // Beside the panel, never over it; every control of the dialog still receives the pointer.
    const panel = await dialog.boundingBox();
    const box = await feedback.boundingBox();
    if (!panel || !box) throw new Error("Expected the dialog and its feedback on screen");
    expect(overlaps(panel, box)).toBe(false);
    for (const id of await tabStops(page, "share-link-dialog")) {
      if (!id.startsWith("toast")) await page.getByTestId(id).click({ trial: true });
    }

    // The keyboard reaches its Dismiss inside the dialog's Tab cycle; dismissing keeps the dialog's keyboard.
    const dismiss = feedback.getByTestId("toast-dismiss");
    await page.getByTestId("share-link-copy").focus();
    for (let i = 0; i < 8 && !(await dismiss.evaluate((el) => el === document.activeElement)); i++)
      await page.keyboard.press("Tab");
    await expect(dismiss).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(feedback).toHaveCount(0);
    await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // The page's notification comes back (not engaged, it follows the bars again), its Undo bound to its change.
    await expect(pageToast).toBeVisible();
    await expect(pageToast).toBeInViewport();
    await expect(pageToast).not.toHaveAttribute("aria-disabled", "true");
    await pageToast.click();
    expect((await callTool(page, "describe_diagram")).text).not.toContain("Behind the dialog");
    expectNoErrors(consoleErrors);
  });
}

test("layering: engaged dialog feedback stays put while the next one waits", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await gotoCanvas(page, SLUG);
  await page.clock.install();
  await pauseClock(page);
  await shareVia(page, "link");
  const dialog = page.getByTestId("share-link-dialog");
  await expect(page.getByTestId("share-link-url")).toHaveValue(/#d=/);
  await page.getByTestId("share-link-copy").click();
  const feedback = dialog.getByTestId("toast");
  await expect(feedback).toContainText("Share link copied.");
  const dismiss = feedback.getByTestId("toast-dismiss");
  await dismiss.hover();
  const before = await dismiss.boundingBox();
  // A second outcome arrives while the pointer rests on the first (a click the pointer didn't make).
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new DOMException("Denied", "NotAllowedError"));
    document.execCommand = () => false;
  });
  await page.getByTestId("share-link-copy").evaluate((button: HTMLButtonElement) => button.click());
  await page.clock.fastForward(9000);
  await expect(feedback).toContainText("Share link copied.");
  expect(await dismiss.boundingBox()).toEqual(before);
  await page.getByTestId("share-link-url").hover();
  await expect(feedback).toContainText("Couldn't copy automatically.");
  await expect(feedback).toHaveRole("alert");
});

test("layering: a press-retained Undo goes stale under a dialog; the next change's Undo reverses only it", async ({
  page,
  consoleErrors,
}) => {
  await installFakeModelContext(page);
  await gotoCanvas(page, SLUG);
  await expect.poll(() => toolNames(page)).toContain("edit_diagram");
  await page.clock.install();
  await agentChange(page, "change-a");
  const undo = page.getByTestId("ai-toast-undo");
  await undo.hover();
  const geometry = await undo.boundingBox();
  await page.mouse.down();
  await openHtmlExportByKeyboard(page);
  // The agent keeps working while the dialog is open: its notification waits behind the retained one.
  await agentChange(page, "change-b");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("html-export-dialog")).toHaveCount(0);
  await expect(undo).toBeVisible();
  expect(await undo.boundingBox()).toEqual(geometry);
  await expect(undo).toHaveAttribute("aria-disabled", "true");
  await expect(undo).toHaveAccessibleDescription("Undo unavailable: the diagram changed.");
  // Releasing on A's stale Undo does nothing; then B's notification takes the place.
  await page.mouse.up();
  await page.getByTestId("ai-rail-open").hover();
  await expect(undo).not.toHaveAttribute("aria-disabled", "true");
  await undo.click();
  const after = (await callTool(page, "describe_diagram")).text;
  expect(after).toContain("change-a");
  expect(after).not.toContain("change-b");
  expectNoErrors(consoleErrors);
});

for (const height of [900, 420, 340] as const) {
  test(`layering: dialog feedback never moves or covers a control (window ${height}px tall)`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width: 1280, height });
    await gotoCanvas(page, SLUG);
    await shareVia(page, "link");
    const dialog = page.getByTestId("share-link-dialog");
    await expect(page.getByTestId("share-link-url")).toHaveValue(/#d=/);
    const ids = (await tabStops(page, "share-link-dialog")).filter((id) => id.startsWith("share-link"));
    const boxes = async () => Promise.all(ids.map((id) => page.getByTestId(id).boundingBox()));
    // Measured once the dialog's own entrance (a short rise) has finished.
    await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
    const before = await boxes();
    await page.clock.install();
    await page.getByTestId("share-link-copy").click();
    const feedback = dialog.getByTestId("toast");
    await expect(feedback).toBeVisible();
    await pauseClock(page);
    // Every control keeps its place, and the feedback lies on none of them.
    expect(await boxes()).toEqual(before);
    const box = await feedback.boundingBox();
    if (!box) throw new Error("Expected the feedback on screen");
    for (const control of before) if (control) expect(overlaps(control, box)).toBe(false);
    await expect(feedback).toBeInViewport({ ratio: 1 });
    // Room below a short window's dialog runs out: the feedback takes the body's room instead.
    await expect(feedback).toHaveAttribute("data-place", height === 900 ? "below" : "inside");
    for (const id of ids) await page.getByTestId(id).click({ trial: true });
  });
}
