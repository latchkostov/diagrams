import { openLiveNodeDetails } from "./fixtures";
import payment from "../../src/examples/slow-payment-provider.json" with { type: "json" };
import { waitingFixture } from "../../src/lab/waitingFixture";
import { waitForBackgroundChecks } from "./checks-readiness";
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  pauseClock,
  savedDiagram,
  STORAGE_KEYS,
  waitForStableViewport,
  fitDiagram,
} from "./fixtures";

test("call fields take the first keyboard pass while planning downloads, with stable CSS and export", async ({
  page,
}) => {
  const d = waitingFixture();
  d.planning = { ...d.planning, requestRoutes: [] };
  // Isolate planner arrival from the independent background Checks card's findings above the fields.
  d.checks = { off: ["call-timeout"] };
  d.edges[1].props = { ...d.edges[1].props, caller: { poolConnections: 40 } };
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    d,
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route(/\/(?:assets\/ui-[\w-]+\.js|src\/planning\/ui\.tsx)(?:\?.*)?$/, async (route) => {
    requested = true;
    await held;
    await route.continue();
  });
  try {
    await gotoCanvas(page, "blocking-call");
    await waitForStableViewport(page);
    await page.getByTestId("edge-call").dblclick();
    const section = page.getByTestId("inspector-section-edge-simulation");
    await section.focus();
    await section.press("Enter");
    // This case holds planning, while the independently loaded Request fields must be ready for its first Tab.
    await expect(page.getByTestId("inspector-field-wait")).toBeVisible();
    await expect(section).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("inspector-field-wait")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("inspector-field-deadlineMs")).toBeFocused();
    await page.keyboard.press("Tab");
    const pool = page.getByTestId("inspector-field-poolConnections");
    await expect(pool).toBeFocused();
    await expect(page.getByTestId("inspector-hint-poolConnections")).toBeVisible();
    await expect.poll(() => requested).toBe(true);
    // The roomier Inspector needs scrolling to reach Appearance & routing. Put that click target in view before
    // measuring, so navigation scroll is separate from the exact planner-arrival position check below.
    await page.getByTestId("inspector-section-edge-advanced").scrollIntoViewIfNeeded();
    await expect(pool).toBeFocused();
    const before = await pool.boundingBox();
    expect(before).not.toBeNull();
    expect(await pool.evaluate((el) => getComputedStyle(el).borderStyle)).toBe("solid");
    await page.getByTestId("inspector-section-edge-advanced").click();
    await expect(page.getByTestId("inspector-prop-caller")).toHaveCount(0);
    await expect(page.getByTestId("inspector-prop-requestFilter")).toHaveCount(0);
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    await page.getByTestId("export-image").click();
    await page.getByTestId("image-options-toggle").click();
    await page.getByTestId("image-format-svg").click();
    const downloaded = page.waitForEvent("download");
    await page.getByTestId("image-export").click();
    expect((await downloaded).suggestedFilename()).toMatch(/\.svg$/);
    await page.keyboard.press("Escape");
    await pool.focus();
    release();
    await expect(page.getByTestId("edge-request-route")).toBeVisible();
    await expect(pool).toHaveValue("40");
    // Loading the optional planner cannot shift the call controls after the user reaches them.
    const after = await pool.boundingBox();
    expect(after).not.toBeNull();
    expect(after).toEqual(before);
  } finally {
    release();
  }
});

test("Add a timeout names the saved simulation and edge, exposes the override, and offers Undo", async ({ page }) => {
  const d = structuredClone(payment);
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "slow-payment-provider",
    d,
  });
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=slow-payment-provider&live=1&paused=1&sim=no-timeouts");
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  // The first complete diagnosis window is enough; assert the same fix earlier rather than replaying extra frames.
  await page.clock.runFor(11000);
  await page.getByTestId("live-play").click();
  await expect(page.getByTestId("trouble-callout")).toHaveAttribute("data-kind", "threads-exhausted");
  await expect(page.getByTestId("trouble-detail")).toContainText("gave up after 5 s (504)");
  // The callout offers Events until the checks worker's same-seed replay confirms the fix (real time, not the page's
  // clock): press the confirmed Add a timeout, never the Events it replaces.
  await expect(page.getByTestId("trouble-action")).toHaveAttribute("data-action", "add-timeout");
  await page.getByTestId("trouble-action").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("toast")).toContainText(
    "Added a 600 ms timeout to Checkout → Payment provider in “No timeouts”",
  );
  await page.clock.runFor(400);
  await expect
    .poll(async () => (await savedDiagram(page)).simulations?.[0].setup?.edges?.pay.caller?.deadlineMs)
    .toBe(600);
  await page.getByTestId("edge-pay").dblclick();
  await page.getByTestId("inspector-section-edge-simulation").click();
  await expect(page.getByTestId("inspector-field-deadlineMs")).toHaveValue("600");
  await expect(page.getByTestId("call-override-deadlineMs")).toHaveText("In this simulation · diagram: No timeout");
  await page.getByTestId("add-timeout-undo").click();
  await page.clock.runFor(400);
  await expect
    .poll(async () => (await savedDiagram(page)).simulations?.[0].setup?.edges?.pay.caller?.deadlineMs)
    .toBeUndefined();
});

test("Scale on busy threads keeps selection, focuses the changed target, and supports the unit toggle from the keyboard", async ({
  page,
}, info) => {
  await gotoCanvas(page, "scale-on-busy-threads");
  await page.getByTestId("node-caller").dblclick();
  await expect(page.getByTestId("planning-contributors")).toBeHidden();
  await page.getByTestId("planning-more-toggle").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("planning-contributors")).toBeVisible();
  const fix = page.getByTestId("inspector-check-fix-blocked-threads:caller");
  await waitForBackgroundChecks(page);
  await expect(fix).toHaveText("Scale on busy threads");
  await fix.focus();
  await fix.press("Enter");
  await expect(page.getByTestId("inspector-field-label")).toHaveValue("Decision service");
  const target = page.getByTestId("autoscaling-target");
  await expect(target).toBeFocused();
  await expect(target).toHaveAccessibleName("Busy threads (% of threads per pod)");
  await expect(page.getByTestId("inspector-check-row-blocked-threads:caller")).toHaveCount(0);
  await expect(page.getByTestId("inspector-check-row-scaling-blind:caller")).toHaveCount(0);
  await expect(page.getByTestId("inspector-findings").getByTestId(/^inspector-check-row-/)).toHaveCount(1);
  await expect(page.getByTestId("inspector-check-row-call-timeout:call")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("autoscaling-busy-unit-utilization")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("autoscaling-busy-unit-averageValue")).toBeFocused();
  await expect(target).toHaveAccessibleName("Busy threads per pod");
  await expect(target).toHaveValue("4");
  await page.screenshot({ path: info.outputPath("busy-thread-target.png") });
});

for (const locale of ["ar", "en-XA"]) {
  test(`call settings, overrides and visible hints work in ${locale}`, async ({ page }, info) => {
    await page.addInitScript((code) => localStorage.setItem("diagrams.locale", code), locale);
    await page.clock.install();
    await gotoLive(page, "./?view=canvas&example=slow-payment-provider&live=1&paused=1&sim=timeout-600");
    await page.getByTestId("edge-pay").dblclick();
    await page.getByTestId("inspector-section-edge-simulation").click();
    await expect(page.getByTestId("inspector-field-deadlineMs")).toHaveValue("600");
    await expect(page.getByTestId("inspector-hint-deadlineMs")).toBeVisible();
    await expect(page.getByTestId("call-override-deadlineMs")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dir)).toBe(locale === "ar" ? "rtl" : "ltr");
    const text = await page.getByTestId("call-override-deadlineMs").innerText();
    expect(text).not.toBe("In this simulation · diagram: No timeout");
    await page.screenshot({ path: info.outputPath(`call-settings-${locale}.png`) });
  });
}

test("edge Simulation submenu keeps editing within the menu budget and returns focus with Escape", async ({ page }) => {
  await gotoCanvas(page, "slow-payment-provider");
  await waitForStableViewport(page);
  await page.getByTestId("edge-pay").click({ button: "right" });
  const menu = page.getByTestId("context-menu");
  expect(
    await menu.evaluate((el) => el.querySelectorAll('[data-testid^="context-menu-item-"]').length),
  ).toBeLessThanOrEqual(12);
  const sim = page.getByTestId("context-menu-item-edge.simulation");
  await menu.press("Home");
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
  await expect(sim).toHaveAttribute("data-active", "true");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("context-menu-item-edge.toggle-dlq")).toBeVisible();
  await expect(page.getByTestId("context-menu-item-edge.consumer-group")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(sim).toHaveAttribute("data-active", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

test("pool readouts scale in presentation across meeting sizes", async ({ page }, info) => {
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=slow-payment-provider&live=1&paused=1&sim=pool-40");
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  await page.clock.runFor(8000);
  await page.getByTestId("live-play").click();
  await page.getByTestId("node-checkout").hover();
  await openLiveNodeDetails(page, "checkout", "threads");
  await expect(page.getByTestId("pool-detail-pay")).toContainText("40 calls to Payment provider in flight");
  await expect(page.getByTestId("pool-detail-pay")).toContainText("queued for a connection (pool of 40)");
  await expect(page.getByTestId("thread-ceiling")).toContainText("Connection pool limits calls to 200 req/s");
  await page.getByTestId("present-toggle").click();
  const pill = page.getByTestId("call-pill-pay");
  for (const width of [1280, 1440, 1920, 2560]) {
    await page.setViewportSize({ width, height: Math.round(width * 0.625) });
    await fitDiagram(page);
    await expect(pill).toContainText("40 of 40 connections");
    await expect(pill).toContainText("queued");
    expect(
      await pill.evaluate((el) => el.getBoundingClientRect().height / (el as HTMLElement).offsetHeight),
    ).toBeGreaterThan(1);
    await page.screenshot({ path: info.outputPath(`pool-presentation-${width}.png`) });
  }
});

for (const stencil of ["generic.service", "azure.logic-apps"]) {
  test(`pool hover resolves omitted waiting policy for ${stencil}`, async ({ page }) => {
    const d = waitingFixture();
    d.nodes[0].props = { ...d.nodes[0].props, ratePerSec: 120 };
    d.nodes[1].stencil = stencil;
    d.nodes[1].props = { ...d.nodes[1].props, concurrency: 100 };
    d.edges[1].props = { ...d.edges[1].props, caller: { poolConnections: 40 } };
    await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
      key: STORAGE_KEYS.autosavePrefix + "blocking-call",
      d,
    });
    await page.clock.install();
    await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
    await pauseClock(page);
    await page.getByTestId("live-play").click();
    await page.clock.runFor(1000);
    await page.getByTestId("live-play").click();
    await page.getByTestId("node-caller").hover();
    await openLiveNodeDetails(page, "caller", "threads");
    const detail = page.getByTestId("pool-detail-call");
    await expect(detail).toBeVisible();
    if (stencil === "azure.logic-apps") await expect(detail).toContainText("no thread held");
    else {
      await expect(detail).toContainText("waiting on Partner scoring API");
      await expect(detail).not.toContainText("no thread held");
    }
  });
}
