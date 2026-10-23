import {
  test,
  expect,
  gotoLive,
  pauseClock,
  waitForStableViewport,
  expectNoErrors,
  openLiveNodeDetails,
  viewportTransform,
} from "./fixtures";

test("compact card keeps its screen-space bounds across ten seconds of Live", async ({ page, consoleErrors }) => {
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await pauseClock(page);
  await waitForStableViewport(page);
  await page.getByTestId("node-caller").hover();
  const card = page.getByTestId("node-detail-caller");
  await expect(card).toBeVisible();
  await page.getByTestId("live-play").click();
  await page.getByTestId("node-caller").hover();
  await expect(card).toBeVisible();
  const boxes = [];
  for (let second = 0; second <= 10; second++) {
    if (second) await page.clock.runFor(1000);
    boxes.push(await card.boundingBox());
  }
  expect(boxes[0]).toMatchObject({ width: 320, height: 332 });
  expect(boxes.every((box) => JSON.stringify(box) === JSON.stringify(boxes[0]))).toBe(true);
  await expect(card).toHaveAccessibleName("Decision service · Live details");
  await expect(card.getByTestId("planning-arithmetic")).toHaveCount(0);
  await expect(page.getByTestId("hover-history")).toHaveCount(0);
  expectNoErrors(consoleErrors);
});

test("Enter pins, keyboard opens rail details, and Esc restores node focus", async ({ page, consoleErrors }) => {
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  const node = page.getByTestId("node-caller");
  await node.evaluate((el) => el.parentElement?.focus());
  await page.keyboard.press("Enter");
  const card = page.getByTestId("node-detail-caller");
  await expect(card).toHaveAttribute("data-pinned", "true");
  await expect(card).toBeFocused();
  await expect(card.getByTestId(/^hover-attention-/)).toHaveCount(2);
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("hover-section-planning")).toBeFocused();
  await card.focus();
  await page.getByTestId("diagram-title").hover();
  await expect(card).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("hover-section-latency")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("hover-section-threads")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("thread-detail-caller")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  expect(await node.evaluate((el) => el.parentElement === document.activeElement)).toBe(true);
  await expect(page.getByTestId("live-controls")).toBeVisible();
  expectNoErrors(consoleErrors);
});

test("click pins, outside click dismisses, and pinning another item replaces the card", async ({ page }) => {
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await page.getByTestId("node-caller").hover();
  await page.getByTestId("node-detail-caller").click();
  await expect(page.getByTestId("node-detail-caller")).toHaveAttribute("data-pinned", "true");
  await page.getByTestId("node-partner").evaluate((el) => el.parentElement?.focus());
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("node-detail-partner")).toHaveAttribute("data-pinned", "true");
  await expect(page.getByTestId("node-detail-caller")).toHaveCount(0);
  await page.getByTestId("diagram-title").click();
  await expect(page.getByTestId("node-detail-partner")).toHaveCount(0);
});

test("edge line and call pill open the same named card", async ({ page }) => {
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  await page.clock.runFor(2000);
  await page.getByTestId("live-play").click();
  await page.getByTestId("call-pill-call").hover();
  const card = page.getByTestId("edge-detail-call");
  await expect(card).toHaveAccessibleName("Decision service → Partner scoring API · Live details");
  await page.getByTestId("diagram-title").hover();
  await page.getByTestId("edge-call").hover({ force: true });
  await expect(card).toBeVisible();
  await page.getByTestId("hover-section-breaker").click();
  await expect(page.getByTestId("hover-breaker-pending")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("edge-call").evaluate((el) => el.closest<HTMLElement>("[tabindex]")?.focus());
  await page.keyboard.press("Enter");
  await expect(card).toHaveAttribute("data-pinned", "true");
  await expect(card).toBeFocused();
});

test("only the pinned readout records a bounded ten-sample sparkline", async ({ page }) => {
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  await openLiveNodeDetails(page, "caller", "resources");
  await expect(page.getByTestId("hover-history-chart")).toHaveAttribute("aria-label", "Recent throughput · 1 sample");
  await page.clock.runFor(12000);
  await expect(page.getByTestId("hover-history-chart")).toHaveAttribute("aria-label", "Recent throughput · 10 samples");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hover-history")).toHaveCount(0);
});

for (const surface of ["embed", "presentation"])
  test(`pinned ${surface} details do not point to Properties`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoLive(page, `./?${surface === "embed" ? "embed=1" : "view=canvas"}&example=blocking-call&live=1&paused=1`);
    if (surface === "presentation") await page.getByTestId("present-toggle").click();
    await openLiveNodeDetails(page, "caller", "planning");
    const card = page.getByTestId("node-detail-caller");
    await expect(card.getByTestId("planning-arithmetic")).toBeVisible();
    await expect(card.getByTestId("node-detail-more")).toHaveCount(0);
    await expect(card).not.toContainText("Properties");
  });

for (const locale of ["ar", "en-XA"])
  test(`pinned details fit at 1280 px in ${locale} with reduced motion`, async ({ page, consoleErrors }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript((locale) => localStorage.setItem("diagrams.locale", locale), locale);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
    await page.getByTestId("node-caller").evaluate((el) => el.parentElement?.focus());
    await page.keyboard.press("Enter");
    const card = page.getByTestId("node-detail-caller");
    await expect(card).toBeFocused();
    const bounds = await card.boundingBox();
    if (!bounds) throw new Error("Missing pinned card geometry");
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1280);
    expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await card.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    if (locale === "ar") expect(await card.evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
    else await expect(card).toContainText("[");
    expectNoErrors(consoleErrors);
  });

test("a held detail chunk preserves focus, cursor, CSS and export; failed download offers Retry", async ({ page }) => {
  let requested = false,
    fail = true;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    /\/(?:assets\/NodeDetailSections-[\w-]+\.js|src\/live\/NodeDetailSections\.tsx)(?:\?.*)?$/,
    async (route) => {
      requested = true;
      await held;
      if (fail) await route.abort("failed");
      else await route.continue();
    },
  );
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await page.getByTestId("node-caller").evaluate((el) => el.parentElement?.focus());
  await page.keyboard.press("Enter");
  await page.getByTestId("hover-section-threads").click();
  await expect.poll(() => requested).toBe(true);
  await expect(page.getByTestId("hover-details-loading")).toBeVisible();
  await expect(page.getByTestId("hover-section-threads")).toBeFocused();
  const card = page.getByTestId("node-detail-caller");
  expect(await card.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
  expect(await page.getByTestId("hover-section-threads").evaluate((el) => getComputedStyle(el).cursor)).toBe("pointer");
  const download = page.waitForEvent("download");
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-share").click();
  await page.getByTestId("share-option-file").click();
  expect((await download).suggestedFilename()).toBe("blocking-call.diagram.json");
  await page.getByTestId("node-caller").evaluate((el) => el.parentElement?.focus());
  await page.keyboard.press("Enter");
  await page.getByTestId("hover-section-threads").click();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await page.keyboard.press("Enter");
  await page.getByTestId("hover-section-threads").click();
  release();
  await expect(page.getByTestId("hover-details-retry")).toBeVisible();
  fail = false;
  await page.getByTestId("hover-details-retry").click();
  await expect(page.getByTestId("thread-detail-caller")).toBeVisible();
});

test("Escape dismisses an unpinned card until the pointer leaves its item", async ({ page }) => {
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  const node = page.getByTestId("node-caller"),
    card = page.getByTestId("node-detail-caller");
  await node.hover();
  await expect(card).toHaveAttribute("data-pinned", "false");
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await node.hover();
  await expect(card).toHaveCount(0);
  await page.getByTestId("diagram-title").hover();
  await node.hover();
  await expect(card).toBeVisible();
  await expect(page.getByTestId("live-controls")).toBeVisible();
});

test("edge card reflects simulation caller overrides", async ({ page }) => {
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&sim=free-thread&paused=1");
  const edge = page.getByTestId("edge-call"),
    card = page.getByTestId("edge-detail-call");
  await edge.evaluate((el) => el.closest<HTMLElement>("[tabindex]")?.focus());
  await page.keyboard.press("Enter");
  await expect(card.getByTestId("hover-verdict")).toHaveText(/Frees the thread/);
  await page.keyboard.press("Escape");
  await page.getByTestId("live-sim-picker").selectOption("blocking");
  await edge.evaluate((el) => el.closest<HTMLElement>("[tabindex]")?.focus());
  await page.keyboard.press("Enter");
  await expect(card.getByTestId("hover-verdict")).toHaveText(/Holds a thread/);
});

test("arrow navigation reveals section buttons without moving the canvas", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await openLiveNodeDetails(page, "caller", "threads");
  const card = page.getByTestId("node-detail-caller");
  await expect(page.getByTestId("thread-detail-caller")).toBeVisible();
  await waitForStableViewport(page);
  const before = await viewportTransform(page);
  await card.focus();
  await page.keyboard.press("ArrowUp");
  const row = page.getByTestId("hover-section-planning");
  await expect(row).toBeFocused();
  const button = await row.boundingBox(),
    box = await card.boundingBox();
  if (!button || !box) throw new Error("Missing section or card geometry");
  expect(button.y).toBeGreaterThanOrEqual(box.y);
  expect(button.y + button.height).toBeLessThanOrEqual(box.y + box.height);
  expect(await viewportTransform(page)).toEqual(before);
});

test("Escape dismisses an unpinned card before clearing the selected node", async ({ page }) => {
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  const node = page.getByTestId("node-caller"),
    card = page.getByTestId("node-detail-caller");
  await node.dblclick();
  await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  await page.keyboard.press("Enter");
  await node.hover();
  await expect(card).toHaveAttribute("data-pinned", "false");
  expect(await node.evaluate((el) => el.parentElement?.classList.contains("selected"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await waitForStableViewport(page);
  expect(await node.evaluate((el) => el.parentElement?.classList.contains("selected"))).toBe(true);
  await expect(page.getByTestId("live-controls")).toBeVisible();
});

/** The keyboard's stop, by test id: a node (its focusable wrapper's body), a readout card, or a control in one. */
const focusedStop = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "BODY";
    const own = el.getAttribute("data-testid") ?? "";
    if (/^(node|edge)-detail-|^hover-section-/.test(own)) return own;
    return el.querySelector(':scope > [data-testid^="node-"]')?.getAttribute("data-testid") ?? (own || el.tagName);
  });

test("Tab crosses an unpinned readout between canvas nodes, and Shift+Tab retraces it", async ({
  page,
  consoleErrors,
}) => {
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await page.getByTestId("node-caller").evaluate((el) => el.parentElement?.focus());
  const card = page.getByTestId("node-detail-caller");
  await expect(card).toHaveAttribute("data-pinned", "false");
  // An unpinned summary is one stop: its section rows stay out of the Tab order until it is pinned.
  await expect(card.getByTestId(/^hover-section-/).first()).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("Tab");
  await expect(card).toBeFocused();
  await page.keyboard.press("Tab");
  await expect.poll(() => focusedStop(page)).toBe("node-partner");
  await expect(page.getByTestId("node-detail-partner")).toHaveAttribute("data-pinned", "false");
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-interaction-state", "idle");
  // Back the same way: the previous node's readout, then the node itself.
  await page.keyboard.press("Shift+Tab");
  await expect(card).toBeFocused();
  await expect(card).toHaveAttribute("data-pinned", "false");
  await expect(page.getByTestId("node-detail-partner")).toHaveCount(0);
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => focusedStop(page)).toBe("node-caller");
  await expect(card).toBeVisible();
  // The summary Tab reached is pinned by Enter, as its footer says, and keeps focus.
  await page.keyboard.press("Tab");
  await expect(card).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(card).toHaveAttribute("data-pinned", "true");
  await expect(card).toBeFocused();
  await expect(page.getByTestId("hover-section-latency")).toHaveAttribute("tabindex", "0");
  expectNoErrors(consoleErrors);
});

test("Tab leaves a pinned readout's sections for the next node, and Shift+Tab returns through the card", async ({
  page,
  consoleErrors,
}) => {
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await page.getByTestId("node-caller").evaluate((el) => el.parentElement?.focus());
  await page.keyboard.press("Enter");
  const card = page.getByTestId("node-detail-caller");
  await expect(card).toHaveAttribute("data-pinned", "true");
  await expect(card).toBeFocused();
  // Shift+Tab from the first section goes back through the card to its node.
  await page.keyboard.press("Tab");
  const sections = await card
    .getByTestId(/^hover-section-/)
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-testid") ?? ""));
  expect(sections.length).toBeGreaterThan(2);
  await expect.poll(() => focusedStop(page)).toBe(sections[0]);
  await page.keyboard.press("Shift+Tab");
  await expect(card).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => focusedStop(page)).toBe("node-caller");
  await expect(card).toHaveAttribute("data-pinned", "true");
  // Forward through every section, an expanded one included, then on to the next node.
  await page.keyboard.press("Tab");
  await expect(card).toBeFocused();
  await page.keyboard.press("Tab");
  await page.getByTestId("hover-section-threads").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("thread-detail-caller")).toBeVisible();
  await page.getByTestId(sections[0]).focus();
  for (const section of sections) {
    await expect.poll(() => focusedStop(page)).toBe(section);
    await page.keyboard.press("Tab");
  }
  await expect.poll(() => focusedStop(page)).toBe("node-partner");
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId("node-detail-partner")).toHaveAttribute("data-pinned", "false");
  // Reverse: the previous node's readout (no longer pinned), then that node.
  await page.keyboard.press("Shift+Tab");
  await expect(card).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => focusedStop(page)).toBe("node-caller");
  expectNoErrors(consoleErrors);
});
