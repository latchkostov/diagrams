import { goToNode, waitForCameraIdle } from "./fixtures";
import { breakerFixture } from "../../src/lab/resilienceFixture";
import type { Locator } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { deflateRawSync } from "node:zlib";
import {
  test,
  expect,
  gotoLive,
  pauseClock,
  waitForStableViewport,
  expectNoErrors,
  openLiveNodeDetails,
  viewportTransform,
  STORAGE_KEYS,
  gotoCanvas,
  waitForHtmlTemplate,
  liveKeyLevels,
  interactionJournalMark,
  edgePoint,
} from "./fixtures";

async function sectionsInsideClip(card: Locator) {
  const clip = await card.getByTestId("hover-sections").boundingBox();
  const rows = await card.getByTestId(/^hover-section-/).evaluateAll((els) =>
    els.map((el) => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
  return rows.map(
    (r) =>
      !!clip &&
      r.x >= clip.x &&
      r.y >= clip.y &&
      r.x + r.width <= clip.x + clip.width &&
      r.y + r.height <= clip.y + clip.height,
  );
}

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
  const rates = [];
  for (let second = 0; second <= 10; second++) {
    if (second) await page.clock.runFor(1000);
    boxes.push(await card.boundingBox());
    rates.push(await card.getByTestId("hover-vital-rate").innerText());
  }
  expect(boxes[0]).toMatchObject({ width: 320, height: 332 });
  expect(boxes.every((box) => JSON.stringify(box) === JSON.stringify(boxes[0]))).toBe(true);
  expect(new Set(rates).size).toBeGreaterThan(1);
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
  await openLiveNodeDetails(page, "caller", "outcomes");
  await expect(page.getByTestId("hover-history-scope")).toHaveText("Last 10 seconds while pinned");
  await expect(page.getByTestId("hover-history-chart")).toHaveAttribute("aria-label", "Recent throughput · 1 sample");
  await page.clock.runFor(500);
  await expect(page.getByTestId("hover-history-chart")).toHaveAttribute("aria-label", "Recent throughput · 1 sample");
  await page.clock.runFor(1000);
  await expect(page.getByTestId("hover-history-chart")).toHaveAttribute("aria-label", "Recent throughput · 2 samples");
  await page.clock.runFor(1000);
  await expect(page.getByTestId("hover-history-chart")).toHaveAttribute("aria-label", "Recent throughput · 3 samples");
  await page.clock.runFor(9500);
  await expect(page.getByTestId("hover-history-chart")).toHaveAttribute("aria-label", "Recent throughput · 10 samples");
  // The plotted history is text too: a visible summary and every value, both describing the chart.
  const chart = page.getByTestId("hover-history-chart");
  await expect(page.getByTestId("hover-history-summary")).toHaveText(
    /^Now \u2068\S+\/s\u2069 · low \u2068\S+\/s\u2069 · peak \u2068\S+\/s\u2069$/,
  );
  await expect(page.getByTestId("hover-history-values")).toHaveText(
    /^Throughput each second, oldest first: (\S+\/s, ){9}\S+\/s$/,
  );
  await expect(chart).toHaveAccessibleDescription(/^Now .* peak .* oldest first: /);
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

test("a flow connection label opens its live readout", async ({ page, consoleErrors }) => {
  await gotoLive(page, "./?view=canvas&example=webhook-ingestion&live=1&paused=1");
  await waitForStableViewport(page);
  await goToNode(page, "dlq");
  await page.getByTestId("canvas-wrap").press("Shift+Digit2");
  await waitForCameraIdle(page);
  await page.getByTestId("diagram-title").hover();
  await page.getByTestId("edge-label-queue-to-dlq").hover();
  const card = page.getByTestId("edge-detail-queue-to-dlq");
  await expect(card).toHaveAttribute("data-pinned", "false");
  await expect(card).toBeVisible();
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
  await page.keyboard.press("F2");
  await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByTestId("inspector-toggle").click();
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

test("edge card reflects breaker runtime transitions", async ({ page, consoleErrors }) => {
  await page.clock.install();
  // A slow callee: test calls stay in flight until the caller's 200 ms deadline, so Testing lasts that long.
  const diagram = breakerFixture();
  diagram.nodes[2].props = { ...diagram.nodes[2].props, latencyMs: 1000 };
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    d: diagram,
  });
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await pauseClock(page);
  const edge = page.getByTestId("edge-call"),
    card = page.getByTestId("edge-detail-call"),
    readout = page.getByTestId("edge-breaker-call"),
    pill = page.getByTestId("call-pill-call");
  const inspect = async () => {
    await edge.evaluate((el) => el.closest<HTMLElement>("[tabindex]")?.focus());
    await page.keyboard.press("Enter");
    await expect(card).toHaveAttribute("data-pinned", "true");
    await page.getByTestId("hover-section-breaker").click();
    await expect(page.getByTestId("hover-breaker-pending")).toHaveCount(0);
    await expect(page.getByTestId("hover-breaker-none")).toHaveCount(0);
  };
  // Before any call: the configured breaker is closed.
  await inspect();
  await expect(readout).toHaveAttribute("data-state", "closed");
  await expect(readout).toContainText("Breaker: Closed");
  await expect(page.getByTestId("hover-section-breaker")).toContainText("Closed");
  await page.keyboard.press("Escape");
  // Every call fails: it opens, and the card says so with the pill.
  await page.getByTestId("live-play").click();
  await page.clock.runFor(500);
  await page.getByTestId("live-play").click();
  await expect(pill).toContainText("● Open");
  await inspect();
  await expect(readout).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("breaker-open-call")).toContainText("Tests the callee again in");
  await expect(card.getByTestId("hover-verdict")).toContainText("Breaker open: calls fail fast with 503");
  await page.keyboard.press("Escape");
  // Its open time over, it lets test calls through.
  const play = page.getByTestId("live-play");
  await play.click();
  await expect(play).toHaveAttribute("data-state", "playing");
  // Simulated time moves only with the fake clock: step it until the pill reports the test calls.
  await expect
    .poll(
      async () => {
        await page.clock.runFor(50);
        return (await pill.textContent()) ?? "";
      },
      { intervals: [0] },
    )
    .toContain("Testing");
  await play.click();
  await expect(play).not.toHaveAttribute("data-state", "playing");
  await expect(pill).toContainText("Testing");
  await inspect();
  await expect(readout).toHaveAttribute("data-state", "half-open");
  await expect(readout).toContainText("Breaker: Testing");
  await expect(page.getByTestId("breaker-probes-call")).toContainText(/\d+ of 5 test calls settled/);
  await expect(card.getByTestId("hover-verdict")).toContainText("Breaker testing the callee");
  expectNoErrors(consoleErrors);
});

test("non-Request edges omit caller semantics", async ({ page, consoleErrors }) => {
  const callerWords = /Holds a thread|Frees the thread|Timeouts|Retries|Requests|Goodput|Breaker/;
  // An active Message out of a service that makes waiting calls.
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await page.getByTestId("edge-publish").evaluate((el) => el.closest<HTMLElement>("[tabindex]")?.focus());
  await page.keyboard.press("Enter");
  const message = page.getByTestId("edge-detail-publish");
  await expect(message).toHaveAttribute("data-pinned", "true");
  await expect(message.getByTestId("hover-verdict")).toHaveText(/the sender doesn't wait for a reply/);
  await expect(message.getByTestId("hover-vitals")).toContainText("Delivered");
  await expect(message).not.toContainText(callerWords);
  await expect(message.getByTestId(/^hover-section-/)).toHaveCount(0);
  // Config and secret dependencies carry no traffic at all; a sync flow in a model without waiting callers holds none.
  await gotoLive(page, "./?view=canvas&example=aks-app-config-key-vault&live=1&paused=1");
  for (const [id, verdict] of [
    ["api-to-appcfg", /no messages or requests flow over it/],
    ["appcfg-to-kv", /no messages or requests flow over it/],
    ["fd-to-api", /no caller thread is held/],
  ] as const) {
    await page.getByTestId(`edge-${id}`).evaluate((el) => el.closest<HTMLElement>("[tabindex]")?.focus());
    await page.keyboard.press("Enter");
    const card = page.getByTestId(`edge-detail-${id}`);
    await expect(card).toHaveAttribute("data-pinned", "true");
    await expect(card.getByTestId("hover-verdict")).toHaveText(verdict);
    await expect(card).not.toContainText(callerWords);
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
  }
  expectNoErrors(consoleErrors);
});

test("Escape on a summary reached with Tab gives focus back to its node", async ({ page, consoleErrors }) => {
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await page.getByTestId("node-caller").evaluate((el) => el.parentElement?.focus());
  const card = page.getByTestId("node-detail-caller");
  // Focus shows the summary (its code loads on first use); Tab steps into it.
  await expect(card).toHaveAttribute("data-pinned", "false");
  await page.keyboard.press("Tab");
  await expect(card).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect.poll(() => focusedStop(page)).toBe("node-caller");
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-interaction-state", "idle");
  expectNoErrors(consoleErrors);
});

for (const pinned of [false, true])
  test(`Tab exits the final Live readout (${pinned ? "pinned" : "unpinned"}) to the frame credit`, async ({
    page,
    consoleErrors,
  }) => {
    await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
    await page.getByTestId("node-store").evaluate((el) => el.parentElement?.focus());
    const card = page.getByTestId("node-detail-store");
    await expect(card).toHaveAttribute("data-pinned", "false");
    await page.keyboard.press(pinned ? "Enter" : "Tab");
    await expect(card).toBeFocused();
    await expect(card).toHaveAttribute("data-pinned", String(pinned));
    // Past its sections (pinned) or at once (a summary is one stop), Tab leaves the canvas from the last node.
    const stops: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const stop = await focusedStop(page);
      stops.push(stop);
      if (!/^(node-detail-store|hover-section-)/.test(stop)) break;
    }
    expect(stops.at(-1)).toBe("react-flow-credit");
    expect(stops.filter((stop) => stop === "node-detail-store")).toEqual([]);
    expect(stops).not.toContain("BODY");
    await expect(card).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

test("Enter pins the hovered card instead of pressing the focused Live button", async ({ page, consoleErrors }) => {
  await gotoCanvas(page, "blocking-call");
  const toggle = page.getByTestId("live-toggle");
  await toggle.click();
  await expect(page.getByTestId("live-controls")).toBeVisible();
  // Live started from its button, which keeps keyboard focus; then the pointer opens a card.
  await expect(toggle).toBeFocused();
  await page.getByTestId("node-caller").hover();
  const card = page.getByTestId("node-detail-caller");
  await expect(card).toHaveAttribute("data-pinned", "false");
  await expect(card).toContainText("Enter or click to pin");
  await page.keyboard.press("Enter");
  await expect(card).toHaveAttribute("data-pinned", "true");
  await expect(card).toBeFocused();
  await expect(page.getByTestId("live-controls")).toBeVisible();
  expectNoErrors(consoleErrors);
});

test("Enter completes inspector editing while another card is hovered", async ({ page, consoleErrors }) => {
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await page.getByTestId("node-caller").dblclick();
  await page.keyboard.press("F2");
  const name = page.getByTestId("inspector-field-label");
  await expect(name).toBeFocused();
  await page.getByTestId("node-applications").hover();
  await expect(page.getByTestId("node-detail-applications")).toHaveAttribute("data-pinned", "false");
  await name.focus();
  await page.keyboard.press("Enter");
  // The field handled its Enter: naming is done and focus is back on the node it named.
  await expect.poll(() => focusedStop(page)).toBe("node-caller");
  await expect(page.getByTestId("live-controls")).toBeVisible();
  const pinned = await page
    .getByTestId(/^(node|edge)-detail-/)
    .evaluateAll((cards) => cards.filter((card) => card.getAttribute("data-pinned") === "true").length);
  expect(pinned).toBe(0);
  expectNoErrors(consoleErrors);
});

for (const item of ["node-caller", "edge-call"]) {
  test(`Enter on an unpinned ${item} summary section keeps focus in its pinned card`, async ({
    page,
    consoleErrors,
  }) => {
    await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
    await page.getByTestId(item).evaluate((el) => el.closest<HTMLElement>("[tabindex]")?.focus());
    const card = page.getByTestId(item.replace("-", "-detail-"));
    await expect(card).toHaveAttribute("data-pinned", "false");
    await page.keyboard.press("Tab");
    await expect(card).toBeFocused();
    await page.keyboard.press("ArrowDown");
    const row = card.getByTestId(/^hover-section-/).first();
    await expect(row).toBeFocused();
    const section = await row.getAttribute("data-testid");
    // The pointer moves over the card after the last key: the focused button still owns Enter.
    await row.hover();
    await page.keyboard.press("Enter");
    // The button ran: its section is open (activating a section also pins its card, as a click does).
    await expect(page.getByTestId(section ?? "")).toHaveAttribute("aria-expanded", "true");
    await expect(card).toHaveAttribute("data-pinned", "true");
    await expect(card).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(card.getByTestId(/^hover-section-/).first()).toBeFocused();
    expectNoErrors(consoleErrors);
  });
}

for (const slug of ["retry-storm", "webhook-ingestion"])
  test(`hover summaries never scroll at 1280×800 (${slug})`, async ({ page, consoleErrors }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoLive(page, `./?view=canvas&example=${slug}&live=1&paused=1`);
    await waitForStableViewport(page);
    const items =
      slug === "retry-storm"
        ? ["node-checkout", "node-payments", "node-orders", "edge-checkouts", "edge-pay", "edge-orders-flow"]
        : ["node-receiver", "node-exchange", "node-queue", "node-dlq", "node-workers", "edge-queue-to-dlq"];
    for (const item of items) {
      await page.getByTestId("diagram-title").hover();
      if (item.startsWith("edge-")) {
        // Overview omits dormant paths. Focus this path's source before inspecting it.
        if (item === "edge-queue-to-dlq") {
          await goToNode(page, "queue");
          await expect
            .poll(() => page.getByTestId(item).evaluate((edge) => getComputedStyle(edge).visibility))
            .toBe("visible");
        }
        const point = await edgePoint(page, item.slice(5));
        await page.mouse.move(point.x, point.y);
      } else await page.getByTestId(item).hover({ force: true });
      const card = page.getByTestId(item.replace(/^(node|edge)-/, "$1-detail-"));
      await expect(card).toHaveAttribute("data-pinned", "false");
      // The card is its own scroll container: a summary fits it in both directions, so no scroll bar shows.
      const fit = await card.evaluate((el) => ({
        height: el.scrollHeight <= el.clientHeight,
        width: el.scrollWidth <= el.clientWidth,
      }));
      expect(fit, item).toEqual({ height: true, width: true });
      const required = item.startsWith("node-") || item === "edge-checkouts" || item === "edge-pay" ? 3 : 0;
      await expect(card.getByTestId(/^hover-section-/)).toHaveCount(required);
      expect((await sectionsInsideClip(card)).every(Boolean), item).toBe(true);
    }
    expectNoErrors(consoleErrors);
  });

test("the clipping assertion detects a section hidden inside a non-scrolling summary", async ({ page }) => {
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await page.getByTestId("node-caller").hover();
  const card = page.getByTestId("node-detail-caller");
  await expect(card).toBeVisible();
  expect(await sectionsInsideClip(card)).toEqual([true, true, true]);
  await card.getByTestId("hover-sections").evaluate((el) => {
    el.style.maxHeight = `${el.clientHeight / 2}px`;
  });
  expect((await sectionsInsideClip(card)).every(Boolean)).toBe(false);
  expect(await card.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
});

test("a no-room summary leaves Enter to the focused Live control", async ({ page, consoleErrors }) => {
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await page.getByTestId("live-play").focus();
  await page.getByTestId("canvas-wrap").evaluate((wrap) => {
    const obstacle = document.createElement("div");
    obstacle.dataset.canvasOverlay = "";
    obstacle.style.cssText = "position:absolute;inset:0;pointer-events:none";
    wrap.append(obstacle);
  });
  await page.getByTestId("node-caller").hover();
  const card = page.getByTestId("node-detail-caller");
  await expect(card).toHaveCSS("visibility", "hidden");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
  await expect(card).toHaveAttribute("data-pinned", "false");
  expectNoErrors(consoleErrors);
});

for (const key of ["Tab", "Escape"])
  test(`a focused summary survives pointer movement before ${key}`, async ({ page, consoleErrors }) => {
    await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
    await page.getByTestId("node-caller").evaluate((el) => el.parentElement?.focus());
    const card = page.getByTestId("node-detail-caller");
    await expect(card).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(card).toBeFocused();
    await page.getByTestId("node-partner").hover();
    await expect(card).toBeFocused();
    await expect(card).toHaveAttribute("data-pinned", "false");
    await expect(page.getByTestId("node-detail-partner")).toHaveCount(0);
    await page.keyboard.press(key);
    await expect.poll(() => focusedStop(page)).toBe(key === "Tab" ? "node-partner" : "node-caller");
    await expect(card).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

test("an inert node and an annotation never own a hidden readout", async ({ page, consoleErrors }) => {
  const diagram = breakerFixture();
  diagram.nodes.push({
    id: "inert",
    stencil: "kafka.schema-registry",
    label: "Documentation",
    x: 0,
    y: 400,
  });
  diagram.annotations = [{ id: "note", kind: "note", text: "Notes", x: 330, y: 400, width: 220, height: 100 }];
  await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    diagram,
  });
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  for (const id of ["node-inert", "annotation-note"]) {
    await page.getByTestId(id).evaluate((el) => el.parentElement?.focus());
    const mark = await interactionJournalMark(page);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId(/^(node|edge)-detail-/)).toHaveCount(0);
    await page.keyboard.press("Escape");
    // Enter may select the wrapper, so Escape can clear selection. Neither key belongs to a phantom card.
    const levels = await liveKeyLevels(page, mark);
    expect(levels).not.toContain("enter:pin-readout");
    expect(levels).not.toContain("escape:close-readout");
  }
  expectNoErrors(consoleErrors);
});

for (const kind of ["node", "edge"] as const)
  test(`removing a focused ${kind} readout target recovers canvas focus`, async ({ page, consoleErrors }) => {
    await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
    const id = kind === "node" ? "caller" : "call";
    const item = page.getByTestId(`${kind}-${id}`);
    await item.click({ force: true });
    if (kind === "node") {
      await expect(page.getByTestId("dock-live-identity")).toBeVisible();
      await page.getByTestId("inspector-toggle").click();
      await item.hover({ force: true });
    }
    const card = page.getByTestId(`${kind}-detail-${id}`);
    await card.click();
    await card
      .getByTestId(/^hover-section-/)
      .first()
      .focus();
    await expect(card).toHaveAttribute("data-pinned", "true");
    // Deliver a model edit through the selected item's deletion handler without moving focus out of the card.
    await item.dispatchEvent("keydown", { key: "Delete", code: "Delete", bubbles: true });
    await expect(item).toHaveCount(0);
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId("canvas-wrap")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(item).toHaveCount(1);

    // Undo restores the canvas before Live syncs its snapshot; only then can a node own a readout.
    if (kind === "node") await expect(page.getByTestId(`node-badge-${id}`)).toBeVisible();
    await item.hover({ force: true });
    await expect(card).toHaveAttribute("data-pinned", "false");
    expectNoErrors(consoleErrors);
  });

for (const kind of ["node", "edge"] as const)
  test(`deleting a pinned ${kind} closes its readout and Undo restores an unpinned target`, async ({
    page,
    consoleErrors,
  }) => {
    await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
    const id = kind === "node" ? "caller" : "call";
    const item = page.getByTestId(`${kind}-${id}`);
    await item.click({ force: true });
    if (kind === "node") {
      await expect(page.getByTestId("dock-live-identity")).toBeVisible();
      await page.getByTestId("inspector-toggle").click();
      await item.hover({ force: true });
    }
    const card = page.getByTestId(`${kind}-detail-${id}`);
    await expect(card).toBeVisible();
    await card.click();
    await expect(card).toHaveAttribute("data-pinned", "true");
    await item.evaluate((el) => el.closest<HTMLElement>("[tabindex]")?.focus());
    await page.keyboard.press("Delete");
    await expect(item).toHaveCount(0);
    await expect(card).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(item).toHaveCount(1);

    await item.hover({ force: true });
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-pinned", "false");
    expectNoErrors(consoleErrors);
  });

test("edge-card dispatch accepts lone UTF-16 surrogates in serialized IDs", async ({ page, consoleErrors }) => {
  const diagram = breakerFixture();
  const id = "call\ud800-\udfff";
  diagram.edges[1].id = id;
  await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    diagram,
  });
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  // Read the original attribute directly: selectors must not normalize the serialized identifier.
  await page.getByTestId(/^edge-/).evaluateAll((els, id) => {
    const el = els.find((e) => e.getAttribute("data-testid") === `edge-${id}`);
    if (!el) throw new Error("Missing original edge ID");
    el.closest<HTMLElement>("[tabindex]")?.focus();
  }, id);
  const card = page.getByTestId(/^edge-detail-/);
  await expect(card).toBeVisible();
  expect(await card.getAttribute("data-item")).toBe(id);
  await page.keyboard.press("Enter");
  await expect(card).toHaveAttribute("data-pinned", "true");
  await expect(card).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  expectNoErrors(consoleErrors);
});

test("a pinned card follows moving anchor geometry without panning", async ({ page }) => {
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await page.getByTestId("node-caller").hover();
  const card = page.getByTestId("node-detail-caller");
  await card.click();
  await expect(card).toBeFocused();
  const before = await card.boundingBox();
  const viewport = await viewportTransform(page);
  await page.getByTestId("node-caller").evaluate((el) => {
    if (!el.parentElement) throw new Error("Missing node wrapper");
    el.parentElement.style.translate = "0px 120px";
  });
  await expect.poll(() => card.boundingBox()).not.toEqual(before);
  expect(await viewportTransform(page)).toBe(viewport);
  await expect(card).toBeFocused();
});

for (const surface of ["embed", "export"])
  test(`readout Tab traversal works forward and backward in the ${surface} viewer`, async ({ page, consoleErrors }) => {
    // Serialize the last node first: native Tab must not re-enter it at either reading-order boundary.
    const diagram = breakerFixture();
    diagram.nodes = diagram.nodes.filter((node) => node.id === "caller" || node.id === "partner").reverse();
    diagram.edges = diagram.edges.filter((edge) => edge.id === "call");
    await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
      key: STORAGE_KEYS.autosavePrefix + "blocking-call",
      diagram,
    });
    if (surface === "embed") {
      const payload = deflateRawSync(JSON.stringify(diagram)).toString("base64url");
      await gotoLive(page, `./?embed=1&live=1&paused=1#d=${payload}`);
    } else {
      await gotoCanvas(page, "blocking-call");
      const template = waitForHtmlTemplate(page);
      await page.getByTestId("file-button").click();
      await page.getByTestId("file-more-formats").click();
      await page.getByTestId("export-html").click();
      await template;
      const download = page.waitForEvent("download");
      await page.getByTestId("html-export-download").click();
      const file = await download;
      const path = test.info().outputPath(file.suggestedFilename());
      await file.saveAs(path);
      await page.goto(pathToFileURL(path).href);
      await expect(page.getByTestId("live-controls")).toBeVisible();
    }
    await page.getByTestId("node-caller").evaluate((el) => el.parentElement?.focus());
    const card = page.getByTestId("node-detail-caller");
    await expect(card).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(card).toBeFocused();
    await page.keyboard.press("Tab");
    await expect.poll(() => focusedStop(page)).toBe("node-partner");
    await page.keyboard.press("Shift+Tab");
    await expect(card).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect.poll(() => focusedStop(page)).toBe("node-caller");
    await page.getByTestId("node-caller").evaluate((el) => el.parentElement?.focus());
    await page.keyboard.press("Shift+Tab");
    await expect.poll(() => focusedStop(page)).not.toMatch(/^node-/);
    await page.getByTestId("node-partner").evaluate((el) => el.parentElement?.focus());
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("node-detail-partner")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("live-toggle")).toBeFocused();
    await expect(page.getByTestId("node-detail-partner")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

test("P2 queued Tab then Shift+Tab resolves from the pending readout before frames advance", async ({ page }) => {
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await page.getByTestId("node-caller").evaluate((el) => el.parentElement?.focus());
  const card = page.getByTestId("node-detail-caller");
  await expect(card).toBeVisible();
  await pauseClock(page);
  await page.getByTestId("node-caller").evaluate((el) => {
    const owner = el.parentElement;
    if (!owner) throw new Error("Missing focus owner");
    owner.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }),
    );
  });
  await page.clock.runFor(100);
  await expect.poll(() => focusedStop(page)).toBe("node-caller");
  // Shift+Tab opens the previous readout after a commit. A second queued Shift+Tab starts there.
  await page.clock.resume();
  await page.keyboard.press("Tab");
  await expect(card).toBeFocused();
  await page.keyboard.press("Tab");
  await expect.poll(() => focusedStop(page)).toBe("node-partner");
  await expect(page.getByTestId("node-detail-partner")).toBeVisible();
  await pauseClock(page);
  await page.getByTestId("node-partner").evaluate((el) => {
    const owner = el.parentElement;
    if (!owner) throw new Error("Missing focus owner");
    for (let i = 0; i < 2; i++)
      owner.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }),
      );
  });
  await page.clock.runFor(100);
  await expect.poll(() => focusedStop(page)).toBe("node-caller");
});
