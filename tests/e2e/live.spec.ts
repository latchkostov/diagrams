import { savedDiagram } from "./fixtures";
import { currentDiagram } from "./fixtures";
import { openExample } from "./fixtures";
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  gotoCanvas,
  gotoLab,
  expectNoErrors,
  pageLoadTimeout,
  gotoLive,
  pauseClock,
  waitForStableViewport,
} from "./fixtures";

// Live view: the toggle, injection from the context menu, saved simulations, narration, the storm
// flow, presentation mode and the Lab presets. Selectors are data-testid only. Runs are seeded, and
// the URL's `speed` param plays them faster.

const KAFKA = "kafka-order-pipeline";

test("Escape still leaves live when an earlier handler commits a host render", async ({ page }) => {
  await gotoLab(page, "live-keyboard");
  await expect(page.getByTestId("live-controls")).toBeVisible({ timeout: pageLoadTimeout() });
  await page.getByTestId("live-keyboard-arm").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("live-keyboard-host")).toHaveAttribute("data-revision", "1");
  await expect(page.getByTestId("live-controls")).toHaveCount(0);
  await expect(page.getByTestId("live-toggle")).toHaveAttribute("aria-pressed", "false");
});

for (const presenting of [false, true]) {
  test(`Enter continues a waiting narration with a selected node (${presenting ? "presenting" : "live"})`, async ({
    page,
    consoleErrors,
  }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&sim=payments-outage&speed=8`);
    const play = page.getByTestId("live-play");
    await expect(play).toHaveAttribute("data-state", "waiting");
    if (presenting) {
      await page.getByTestId("present-toggle").click();
      await expect(page.getByTestId("present-exit")).toBeVisible();
    }
    await waitForStableViewport(page);
    await page.clock.install();
    await pauseClock(page);
    const node = page.getByTestId("node-payments");
    await node.click();
    await expect.poll(() => node.evaluate((el) => !!document.activeElement?.contains(el))).toBe(true);
    await page.keyboard.press("F2");
    const label = page.getByTestId("inspector-field-label");
    if (!presenting) {
      await expect(label).toBeFocused();
      await page.keyboard.press("Escape");
      await expect.poll(() => node.evaluate((el) => !!document.activeElement?.contains(el))).toBe(true);
    } else await expect(label).toHaveCount(0);
    await expect(play).toHaveAttribute("data-state", "waiting");
    await page.keyboard.press("Enter");
    await expect(play).toHaveAttribute("data-state", "playing");
    if (presenting) await expect(label).toHaveCount(0);
    else await expect(label).not.toBeFocused();
    expectNoErrors(consoleErrors);
  });
}
const menuItem = (page: Page, id: string) => page.getByTestId(`context-menu-item-${id}`);

/**
 * Opens a node's menu and chooses `actionId` (or, with `click` false, waits for it to show). A Simulation action
 * waits for the live session first: its code loads on first use (seconds on a busy dev server), and a menu opened
 * before it arrives has no Simulation items and doesn't grow them. Then retried whole: a fit or the inspector
 * resizing can dismiss the menu.
 */
async function openNodeMenu(page: Page, nodeId: string, actionId?: string, click = true) {
  if (actionId?.startsWith("sim."))
    await expect(page.getByTestId("live-controls")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(async () => {
    await page.getByTestId(`node-${nodeId}`).click({ button: "right" });
    await expect(page.getByTestId("context-menu")).toBeVisible({ timeout: 1000 });
    if (!actionId) return;
    if (click) await menuItem(page, actionId).click({ timeout: 1000 });
    else await expect(menuItem(page, actionId)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

const processed = async (page: Page, nodeId: string) =>
  Number(await page.getByTestId(`node-badge-${nodeId}`).getAttribute("data-processed"));

test.describe("live view", () => {
  test("the Live toggle (and L) shows and hides the controls", async ({ page, consoleErrors }) => {
    await page.clock.install();
    await gotoCanvas(page, KAFKA);
    await expect(page.getByTestId("live-controls")).toHaveCount(0);
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await expect(page.getByTestId("live-toggle")).toHaveAttribute("aria-pressed", "true");
    // Free play starts playing with gentle source traffic.
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
    // The less common controls live behind "⋯".
    await expect(page.getByTestId("live-traffic")).toHaveCount(0);
    await page.getByTestId("live-more").click();
    await expect(page.getByTestId("live-traffic")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("live-more").click();
    await expect(page.getByTestId("live-sim-picker")).toHaveValue("");
    await expect(page).toHaveURL(/live=1/);

    await page.keyboard.press("l");
    await expect(page.getByTestId("live-controls")).toHaveCount(0);
    await expect(page).not.toHaveURL(/live=1/);
    await page.keyboard.press("l");
    await expect(page.getByTestId("live-controls")).toBeVisible();
    // Esc backs out of live view when nothing else (menu, selection, dialog) claims it.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("live-controls")).toHaveCount(0);
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-controls")).toHaveCount(0);

    // Let the exit refit finish: viewport movement closes any open context menu.
    await page.clock.runFor(1000);
    // The Simulation menu section exists only while live.
    await openNodeMenu(page, "payments");
    await expect(page.getByTestId("context-menu")).not.toContainText("Simulation");
    expectNoErrors(consoleErrors);
  });

  test("Inject 10 at a node updates its badge and processed counts appear downstream", async ({
    page,
    consoleErrors,
  }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0&speed=4`);
    await expect(page.getByTestId("live-in-system")).toHaveAttribute("data-count", "0");

    await openNodeMenu(page, "inventory", "sim.storm", false);
    await menuItem(page, "sim.inject").click();
    await menuItem(page, "sim.inject:10").click();

    await expect.poll(() => processed(page, "inventory"), { timeout: 10_000 }).toBe(10);
    await expect.poll(() => processed(page, "stock-db"), { timeout: 10_000 }).toBe(10);
    // One primary metric per node; the breakdown appears on hover.
    await expect(page.getByTestId("node-metric-inventory")).toBeVisible();
    await page.getByTestId("node-inventory").hover();
    await expect(page.getByTestId("node-detail-inventory")).toContainText("Processed");
    await expect(page.getByTestId("live-in-system")).toHaveAttribute("data-count", "0");

    // Killing a node shows on its badge, and the event log can filter to it.
    await openNodeMenu(page, "payments", "sim.kill");
    await expect(page.getByTestId("node-badge-payments")).toHaveAttribute("data-status", "down");
    await openNodeMenu(page, "inventory", "sim.behaviour");
    await menuItem(page, "sim.events").click();
    await expect(page.getByTestId("live-events")).toBeVisible();
    await expect(page.getByTestId("live-events-filter")).toHaveValue("inventory");
    await expect(page.getByTestId("live-events-list")).toContainText("Inventory service");
    expectNoErrors(consoleErrors);
  });

  test("a saved simulation runs to done with every expectation passing", async ({ page, consoleErrors }) => {
    test.setTimeout(60_000);
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&sim=black-friday&speed=8`);
    await expect(page.getByTestId("live-sim-picker")).toHaveValue("black-friday");
    await expect(page.getByTestId("live-timeline")).toBeVisible();
    await expect(page.getByTestId("expectation-stock")).toHaveAttribute("data-status", "pending");
    await expect(page.getByTestId("live-done")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("live-done")).toHaveAttribute("data-status", "pass");
    for (const id of ["stock", "payments", "notifications", "orders", "no-dlq", "no-drop"]) {
      await expect(page.getByTestId(`expectation-${id}`)).toHaveAttribute("data-status", "pass");
    }
    await expect(page.getByTestId("expectation-stock")).toHaveAttribute("data-value", "20000");
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "done");
    // Each dot is 50 orders, but the badges count real messages and agree with the expectations.
    await expect(page.getByTestId("node-badge-stock-db")).toHaveAttribute("data-processed", "20000");
    await expect(page.getByTestId("node-badge-shopper")).toHaveAttribute("data-processed", "20000");
    await page.getByTestId("node-stock-db").hover();
    await expect(page.getByTestId("node-detail-stock-db")).toContainText("20k");
    await page.getByTestId("live-more").click();
    await page.getByTestId("live-events-toggle").click();
    await expect(page.getByTestId("live-events-scale")).toContainText("about 50 messages");
    expectNoErrors(consoleErrors);
  });

  test("a pausing note waits for Continue", async ({ page, consoleErrors }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&sim=payments-outage&speed=8`);
    await expect(page.getByTestId("live-note-continue")).toBeVisible();
    await expect(page.getByTestId("live-note")).toContainText("Payments is offline");
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "waiting");
    const clock = page.getByTestId("live-clock");
    const at = await clock.getAttribute("data-ms");
    if (at === null) throw new Error("Live clock has no timestamp");
    await page.waitForTimeout(800);
    await expect(clock).toHaveAttribute("data-ms", at);

    await page.getByTestId("live-note-continue").click();
    await expect(page.getByTestId("live-note-continue")).toHaveCount(0);
    await expect.poll(async () => Number(await clock.getAttribute("data-ms"))).toBeGreaterThan(Number(at));
    expectNoErrors(consoleErrors);
  });

  test("Start a storm here creates a simulation that persists across reload", async ({ page, consoleErrors }) => {
    test.slow(); // Two complete live page loads, including cold dev modules after reload.
    await gotoLive(page, "./?view=canvas&example=azure-service-bus-integration&live=1&traffic=0");
    await openNodeMenu(page, "ingest", "sim.storm");

    const panel = page.getByTestId("sim-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("sim-panel-traffic-0-count")).toHaveValue("100");
    await expect(page.getByTestId("sim-panel-traffic-0-node")).toHaveValue("ingest");
    // Shape, timeline and expectations wait behind disclosures.
    await expect(page.getByTestId("sim-panel-traffic-0-sparkline")).toBeHidden();
    await page.getByTestId("sim-panel-traffic-0-advanced-toggle").click();
    await expect(page.getByTestId("sim-panel-traffic-0-sparkline")).toBeVisible();
    await expect(page.getByTestId("sim-panel-add-expectation")).toBeHidden();
    // The storm is already pouring through the diagram.
    await expect
      .poll(async () => Number(await page.getByTestId("live-in-system").getAttribute("data-count")))
      .toBeGreaterThan(0);

    await page.getByTestId("sim-panel-title").fill("Month-end storm");
    await page.getByTestId("sim-panel-traffic-0-type").fill("MemberJoined");
    await expect(page.getByTestId("sim-panel-dirty")).toBeVisible();
    await page.getByTestId("sim-panel-save").click();
    await expect(page.getByTestId("sim-panel-dirty")).toHaveCount(0);
    await expect(page.getByTestId("live-sim-picker")).toContainText("Month-end storm");

    await expect
      .poll(async () =>
        (await savedDiagram(page)).simulations?.some(
          (sim) => sim.title === "Month-end storm" && sim.traffic[0].messageType === "MemberJoined",
        ),
      )
      .toBe(true);
    await page.reload();
    await expect(page.getByTestId("live-controls")).toBeVisible({ timeout: pageLoadTimeout() });
    await expect(page.getByTestId("live-sim-picker")).toContainText("Month-end storm");
    expectNoErrors(consoleErrors);
  });

  test("presentation + live from the URL: notes, Space to pause, Esc leaves presentation only", async ({
    page,
    consoleErrors,
  }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&present=1&sim=black-friday`);
    await expect(page.getByTestId("present-exit")).toBeVisible();
    await expect(page.getByTestId("topbar")).toHaveCount(0);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await expect(page.getByTestId("live-note")).toContainText("20,000 checkouts");
    await expect(page.getByTestId("live-edit-sims")).toHaveCount(0);
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");

    await page.getByTestId("canvas-wrap").click({ position: { x: 700, y: 60 } });
    await page.keyboard.press("Space");
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
    await page.keyboard.press("Space");
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("present-exit")).toHaveCount(0);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("Trace this path dims everything that isn't downstream", async ({ page, consoleErrors }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await page.getByTestId("edge-label-order-events-to-payments").click({ button: "right" });
    await menuItem(page, "sim.trace").click();
    await expect(page.getByTestId("live-trace")).toBeVisible();
    const unrelatedNode = page.getByTestId("node-inventory");
    const downstreamNode = page.getByTestId("node-payments");
    const unrelatedEdge = page.getByTestId("edge-order-events-to-inventory");
    const tracedEdge = page.getByTestId("edge-order-events-to-payments");
    const nodeDecoration = (id: string) =>
      page.getByTestId(id).evaluate((el) => ({
        dim: el.closest("[data-id]")?.getAttribute("data-live-dim"),
        opacity: getComputedStyle(el.closest("[data-id]") ?? el).opacity,
      }));
    const edgeDecoration = (id: string) =>
      page.getByTestId(id).evaluate((el) => {
        const edge = el.closest("[data-id]") ?? el;
        return {
          dim: edge.getAttribute("data-live-dim"),
          trace: edge.getAttribute("data-live-trace"),
          opacity: getComputedStyle(edge).opacity,
        };
      });
    await expect(unrelatedNode).toBeVisible();
    await expect(downstreamNode).toBeVisible();
    await expect(unrelatedEdge).toBeVisible();
    await expect(tracedEdge).toBeVisible();
    await expect.poll(() => nodeDecoration("node-inventory")).toMatchObject({ dim: "1" });
    await expect.poll(() => nodeDecoration("node-payments")).toMatchObject({ dim: null, opacity: "1" });
    await expect.poll(() => edgeDecoration("edge-order-events-to-inventory")).toMatchObject({ dim: "1" });
    await expect
      .poll(() => edgeDecoration("edge-order-events-to-payments"))
      .toMatchObject({ dim: null, trace: "1", opacity: "1" });
    await expect
      .poll(() => edgeDecoration("edge-payments-to-payment-db"))
      .toMatchObject({ dim: null, trace: "1", opacity: "1" });
    // The dim attribute precedes the CSS transition's first frame; wait for the rendered result too.
    await expect.poll(async () => Number((await nodeDecoration("node-inventory")).opacity)).toBeLessThan(1);
    await expect
      .poll(async () => Number((await edgeDecoration("edge-order-events-to-inventory")).opacity))
      .toBeLessThan(1);
    await page.getByTestId("live-trace-clear").click();
    await expect(page.getByTestId("live-trace")).toHaveCount(0);
    await expect.poll(() => nodeDecoration("node-inventory")).toMatchObject({ dim: null, opacity: "1" });
    await expect
      .poll(() => edgeDecoration("edge-order-events-to-inventory"))
      .toMatchObject({ dim: null, opacity: "1" });
    await expect.poll(() => edgeDecoration("edge-order-events-to-payments")).toMatchObject({ trace: null });
    await expect.poll(() => edgeDecoration("edge-payments-to-payment-db")).toMatchObject({ trace: null, opacity: "1" });
    expectNoErrors(consoleErrors);
  });

  test("keyboard focus exposes detailed metrics and their description", async ({ page }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    const node = page.getByTestId("node-inventory");
    await node.evaluate((el) => el.closest<HTMLElement>("[data-id]")?.focus());
    await expect(page.getByTestId("node-detail-inventory")).toBeVisible();
    await expect(page.getByTestId("node-detail-inventory")).toContainText("In flight");
    const tooltip = await page.getByTestId("node-detail-inventory").getAttribute("id");
    expect(tooltip).toBeTruthy();
    expect(await node.evaluate((el) => el.closest("[data-id]")?.getAttribute("aria-describedby"))).toContain(tooltip);
    await page.getByTestId("live-play").focus();
    await page.mouse.move(0, 0);
    await expect(page.getByTestId("node-detail-inventory")).toHaveCount(0);
    expect(await node.evaluate((el) => el.closest("[data-id]")?.getAttribute("aria-describedby"))).not.toContain(
      tooltip,
    );
  });

  test("timeline action controls have accessible names", async ({ page }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await openNodeMenu(page, "inventory", "sim.storm");
    await page.getByTestId("sim-panel-section-timeline-toggle").click();
    await page.getByTestId("sim-panel-add-step").click();
    const action = page.getByTestId("sim-panel-step-0-action");
    await expect(action).toHaveAccessibleName("Action");
    await action.selectOption("status");
    await expect(page.getByTestId("sim-panel-step-0-node")).toHaveAccessibleName("Target node");
    await expect(page.getByTestId("sim-panel-step-0-status")).toHaveAccessibleName("Status");
    await action.selectOption("props");
    await expect(page.getByTestId("sim-panel-step-0-prop")).toHaveAccessibleName("Property");
  });

  test("leaving live authoring restores the inspector preference", async ({ page }) => {
    // Three full page loads: give it room when the whole suite shares one dev server.
    test.setTimeout(60_000);
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await openNodeMenu(page, "inventory", "sim.storm");
    await expect(page.getByTestId("sim-panel")).toBeVisible();
    // The authoring panel starts below the Live toggle, so leaving live view stays one click away.
    await page.getByTestId("live-toggle").click();
    await expect
      .poll(() =>
        page.evaluate(() => JSON.parse(localStorage.getItem("diagrams.editor.v1") ?? "{}").inspector as boolean),
      )
      .toBe(true);
    await page.reload();
    // Below 1680px the inspector waits for a selection; the preference itself survived.
    await page.getByTestId("node-inventory").click();
    await expect(page.getByTestId("inspector-title")).toBeVisible();
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await openNodeMenu(page, "inventory", "sim.storm");
    await openExample(page, "azure-service-bus-integration");
    await expect
      .poll(() =>
        page.evaluate(() => JSON.parse(localStorage.getItem("diagrams.editor.v1") ?? "{}").inspector as boolean),
      )
      .toBe(true);
  });

  test("read-only embeds require live=1 to expose Live", async ({ page }) => {
    // Three full page loads: give it room when the whole suite shares one dev server.
    test.setTimeout(60_000);
    await page.goto(`./?embed=1&example=${KAFKA}`);
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    await expect(page.getByTestId("live-toggle")).toHaveCount(0);
    await page.keyboard.press("l");
    await expect(page.getByTestId("live-controls")).toHaveCount(0);
    await page.goto(`./?embed=1&example=${KAFKA}&sim=black-friday`);
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    await expect(page.getByTestId("live-controls")).toHaveCount(0);
    await page.goto(`./?embed=1&example=${KAFKA}&live=1`);
    await expect(page.getByTestId("live-toggle")).toBeVisible();
    await expect(page.getByTestId("live-controls")).toBeVisible();
  });

  test("custom injection is a labelled modal that traps focus and restores it on close", async ({ page }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    const open = async () => {
      await openNodeMenu(page, "inventory", "sim.inject");
      await menuItem(page, "sim.inject:custom").click();
    };
    await open();
    const dialog = page.getByTestId("live-inject-dialog");
    await expect(dialog).toHaveAttribute("role", "dialog");
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog).toHaveAccessibleName(/Inject at Inventory/);
    await expect(page.getByTestId("live-inject-count")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByTestId("live-inject-submit")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("live-inject-count")).toBeFocused();
    expect(await page.getByTestId("live-play").evaluate((el) => !!el.closest("[inert]"))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(
      await page.getByTestId("node-inventory").evaluate((el) => el.closest("[data-id]") === document.activeElement),
    ).toBe(true);
    expect(await page.getByTestId("live-play").evaluate((el) => !!el.closest("[inert]"))).toBe(false);
    await open();
    await page.getByTestId("live-inject-cancel").click();
    await expect(dialog).toHaveCount(0);
    expect(
      await page.getByTestId("node-inventory").evaluate((el) => el.closest("[data-id]") === document.activeElement),
    ).toBe(true);
  });

  test("scrubbing previews without replaying until pointer or keyboard release", async ({ page }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&sim=black-friday&paused=1`);
    const input = page.getByTestId("live-timeline-input");
    const clock = page.getByTestId("live-clock");
    await expect(input).toBeVisible();
    const start = await clock.getAttribute("data-ms");
    await input.focus();
    for (const fraction of [300, 450, 600]) {
      await input.evaluate((el, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, String(value));
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }, fraction);
    }
    await expect(input).toHaveValue("600");
    if (start === null) throw new Error("Missing clock");
    await expect(clock).toHaveAttribute("data-ms", start);
    await input.dispatchEvent("pointerup");
    await expect.poll(async () => Number(await clock.getAttribute("data-ms"))).toBeGreaterThan(1000);
    const committed = await clock.getAttribute("data-ms");
    await page.keyboard.down("ArrowLeft");
    if (committed === null) throw new Error("Missing clock");
    await expect(clock).toHaveAttribute("data-ms", committed);
    await page.keyboard.up("ArrowLeft");
    await expect.poll(() => clock.getAttribute("data-ms")).not.toBe(committed);
  });

  test("saved simulation survives immediate diagram navigation", async ({ page }) => {
    // The clock goes in before the app loads, so every timer is a fake one. Installed later, a
    // debounced autosave scheduled before the install stayed a native timer that the faked
    // clearTimeout couldn't cancel: it fired after Save with a stale diagram and erased the new
    // simulation (only under load, when it was still pending at install time).
    await page.clock.install();
    await gotoLive(page, "./?view=canvas&example=azure-service-bus-integration&live=1&traffic=0");
    await openNodeMenu(page, "ingest", "sim.storm");
    await page.getByTestId("sim-panel-title").fill("Immediate storm");
    await page.getByTestId("sim-panel-traffic-0-type").fill("ImmediateEvent");
    await page.getByTestId("sim-panel-traffic-0-count").fill("37");
    await page.getByTestId("sim-panel-traffic-0-spread").fill("2.5");
    // No timer runs from here until after the round trip: the save must not depend on one.
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.getByTestId("sim-panel-save").click();
    // Wait for each diagram to be on screen. The canvas stays mounted until the requested example has
    // loaded, so switching back before the other one arrived (a slow import on the dev server) kept
    // this canvas and its live session, and the round trip never reloaded the saved diagram.
    const title = page.getByTestId("diagram-title");
    const copy = await currentDiagram(page);
    await openExample(page, KAFKA);
    await expect(title).toHaveText("Kafka order pipeline");
    await openExample(page, copy);
    await expect(title).toHaveText("Azure invoice integration (copy)");
    await page.clock.resume();
    // A freshly opened diagram starts out of live view (switching diagrams drops the live URL params).
    await expect(page.getByTestId("live-controls")).toHaveCount(0);
    await page.getByTestId("live-toggle").click();
    await page.getByTestId("live-more").click();
    await page.getByTestId("live-edit-sims").click();
    await page.getByTestId(/^sim-panel-edit-storm-/).click();
    await expect(page.getByTestId("sim-panel-title")).toHaveValue("Immediate storm");
    await expect(page.getByTestId("sim-panel-traffic-0-type")).toHaveValue("ImmediateEvent");
    await expect(page.getByTestId("sim-panel-traffic-0-count")).toHaveValue("37");
    await expect(page.getByTestId("sim-panel-traffic-0-spread")).toHaveValue("2.5");
  });

  test("Esc backs out of the simulation panel one level at a time, then leaves live", async ({ page }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await page.getByTestId("live-more").click();
    await page.getByTestId("live-edit-sims").click();
    await expect(page.getByTestId("sim-panel")).toBeVisible();
    await page.getByTestId("sim-panel-new").click();
    // A node picker is the innermost level: Esc cancels it and keeps the panel.
    await page.getByTestId("sim-panel-add-traffic").click();
    await page.getByTestId("sim-panel-traffic-0-node-pick").click();
    await expect(page.getByTestId("sim-panel-picking")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sim-panel-picking")).toHaveCount(0);
    await expect(page.getByTestId("sim-panel")).toBeVisible();
    // Next, the panel closes and focus returns to the live bar; live view stays on.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sim-panel")).toHaveCount(0);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await expect(page.getByTestId("live-more")).toBeFocused();
    // Then live view itself.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("live-controls")).toHaveCount(0);
  });

  test("live node menus lead with live actions and stay within the chrome budget", async ({ page }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await page.getByTestId("node-inventory").click({ button: "right" });
    await expect(menuItem(page, "sim.inject")).toBeVisible();
    // Editing that doesn't fit a running simulation waits for edit mode.
    await expect(menuItem(page, "item.duplicate")).toHaveCount(0);
    await expect(menuItem(page, "node.properties")).toBeVisible();
    const countLevel = async () => {
      const counts = await page
        .getByTestId(/^context-menu(?:-sub)*$/)
        .evaluateAll((menus) =>
          menus.map((menu) => menu.querySelectorAll('[data-testid^="context-menu-item-"]').length),
        );
      expect(counts.length).toBeGreaterThan(0);
      for (const count of counts) {
        expect(count).toBeGreaterThan(0);
        expect(count).toBeLessThanOrEqual(12);
      }
    };
    await countLevel();
    await menuItem(page, "sim.behaviour").click();
    await countLevel();
    await menuItem(page, "sim.concurrency").click();
    await countLevel();
  });

  test("filled live badges meet AA contrast throughout the heat gradient in both themes", async ({ page }) => {
    await gotoLab(page, "live-badge-states");
    const metric = page.getByTestId("node-metric-orders");
    const alert = page.getByTestId("node-alert-worker");
    await expect(metric).toBeVisible();
    await expect(alert).toBeVisible();
    await page.getByTestId("live-play").click();
    for (const theme of ["light", "dark"]) {
      await expect(page.getByTestId("theme-toggle")).toHaveAccessibleName(
        theme === "light" ? "Switch to dark theme" : "Switch to light theme",
      );
      const contrasts = await metric.evaluate((el) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Missing color context");
        const luminance = (color: string) => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          const channels = Array.from(ctx.getImageData(0, 0, 1, 1).data)
            .slice(0, 3)
            .map((channel) => {
              const c = channel / 255;
              return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            });
          return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        };
        const metric = el as HTMLElement;
        metric.style.transition = "none";
        const values = [];
        for (let step = 0; step <= 100; step++) {
          metric.style.setProperty("--heat", String(step / 100));
          const bg = luminance(getComputedStyle(metric).backgroundColor);
          for (const text of [metric, metric.firstElementChild ?? metric]) {
            const fg = luminance(getComputedStyle(text).color);
            values.push((Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05));
          }
        }
        return values;
      });
      expect(Math.min(...contrasts)).toBeGreaterThanOrEqual(4.5);
      const alertColors = await alert.evaluate((el) => {
        const ctx = document.createElement("canvas").getContext("2d");
        if (!ctx) throw new Error("Missing color context");
        const luminance = (color: string) => {
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          const rgb = Array.from(ctx.getImageData(0, 0, 1, 1).data)
            .slice(0, 3)
            .map((c) => {
              c /= 255;
              return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            });
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const style = getComputedStyle(el);
        const bg = luminance(style.backgroundColor),
          fg = luminance(style.color);
        return (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05);
      });
      expect(alertColors).toBeGreaterThanOrEqual(4.5);
      if (theme === "light") await page.getByTestId("theme-toggle").click();
    }
  });

  // One preset per test: under full parallel load, three Lab pages in one test could run past the timeout.
  test("Lab preset: badge states (down, paused, failing)", async ({ page, consoleErrors }) => {
    await gotoLab(page, "live-badge-states");
    await expect(page.getByTestId("live-lab-stage")).toBeVisible();
    await expect(page.getByTestId("node-badge-down-svc")).toHaveAttribute("data-status", "down");
    await expect(page.getByTestId("node-badge-paused-svc")).toHaveAttribute("data-status", "paused");
    await expect
      .poll(async () => Number(await page.getByTestId("node-badge-worker").getAttribute("data-failed")))
      .toBeGreaterThan(0);
    await expect(page.getByTestId("live-toggle")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("Lab preset: particle stress draws hundreds of particles", async ({ page, consoleErrors }) => {
    await gotoLab(page, "live-particles-stress", { particles: 500 });
    await expect
      .poll(async () => Number(await page.getByTestId("live-canvas").getAttribute("data-particles")), {
        timeout: 15_000,
      })
      .toBeGreaterThan(100);
    expectNoErrors(consoleErrors);
  });

  test("Lab preset: a pausing note waits for Continue", async ({ page, consoleErrors }) => {
    await gotoLab(page, "live-note-states", { note: "pause" });
    await expect(page.getByTestId("live-note-continue")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("timeline markers jump to their moment: the outage note, then back to the start", async ({ page }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&sim=payments-outage&paused=1`);
    await expect(page.getByTestId("live-clock")).toHaveAttribute("data-ms", "0");
    // The status change and its note share 4.0s: the note sits stacked on top; either one jumps there.
    const down = page.getByTestId("live-marker-2");
    await expect(down).toHaveAttribute("data-at", "4000");
    await down.click();
    await expect
      .poll(async () => Number(await page.getByTestId("live-clock").getAttribute("data-ms")))
      .toBeGreaterThanOrEqual(4000);
    await expect(page.getByTestId("live-note")).toContainText("Payments is offline");
    await expect(page.getByTestId("node-badge-payments")).toHaveAttribute("data-status", "down");
    // Back to the first note: the run replays from its checkpoint, Payments is up again.
    await page.getByTestId("live-marker-0").click();
    await expect
      .poll(async () => Number(await page.getByTestId("live-clock").getAttribute("data-ms")))
      .toBeLessThan(1000);
    await expect(page.getByTestId("live-note")).toContainText("independent consumer groups");
    await expect(page.getByTestId("node-badge-payments")).not.toHaveAttribute("data-status", "down");
  });

  test("Tab reaches timeline markers and Enter jumps to a named event", async ({ page, consoleErrors }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&sim=payments-outage&paused=1`);
    await page.getByTestId("live-sim-picker").focus();
    for (let i = 0; i < 12; i++) {
      if (await page.getByTestId("live-marker-2").evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(page.getByTestId("live-marker-2")).toBeFocused();
    await expect(page.getByTestId("live-marker-2")).toHaveAttribute("aria-label", /Jump to.*Payments/);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("live-note")).toContainText("Payments is offline");
    await expect(page.getByTestId("node-badge-payments")).toHaveAttribute("data-status", "down");
    expectNoErrors(consoleErrors);
  });

  test("a narrow bar folds the expectation dots into a summary that lists each result", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&sim=payments-outage&paused=1`);
    await page.getByTestId("live-capacity").click();
    await expect(page.getByTestId("capacity-panel")).toBeVisible();
    await expect(page.getByTestId("live-expectations")).toBeHidden();
    const summary = page.getByTestId("live-expectations-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toHaveAttribute("aria-label", /Expectations: \d+ of \d+ hold/);
    // Keyboard: it takes focus and opens with Enter.
    await summary.focus();
    await page.keyboard.press("Enter");
    const list = page.getByTestId("live-expectations-list");
    await expect(list).toBeVisible();
    const rows = list.getByTestId(/^expectation-row-/);
    expect(await rows.count()).toBeGreaterThan(0);
    await expect(rows.first()).toContainText(/(pending|holds|failed) · now \d/);
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(summary).toBeFocused();
    await expect(page.getByTestId("live-controls")).toBeVisible();
  });
});

test.describe("live overlap (UX gate 3)", () => {
  const box = async (page: Page, testId: string) => {
    const b = await page.getByTestId(testId).boundingBox();
    if (!b) throw new Error(`${testId} has no box`);
    return b;
  };
  const apart = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

  for (const width of [1024, 1440]) {
    test(`at ${width}px the bar, the Inputs panel and the event log never cover each other`, async ({ page }) => {
      await page.setViewportSize({ width, height: 768 });
      await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&sim=payments-outage&paused=1`);
      await page.getByTestId("live-capacity").click();
      await expect(page.getByTestId("capacity-panel")).toBeVisible();
      await page.getByTestId("live-more").click();
      await page.getByTestId("live-events-toggle").click();
      await expect(page.getByTestId("live-events")).toBeVisible();

      const bar = await box(page, "live-controls");
      expect(apart(bar, await box(page, "capacity-panel"))).toBe(true);
      expect(apart(bar, await box(page, "live-events"))).toBe(true);
      // Every bar control stays inside the bar (nothing spills under the panel), and the simulation keeps its name.
      for (const id of ["live-play", "live-sim-picker", "live-capacity", "live-timeline", "live-more"]) {
        const b = await box(page, id);
        expect(b.x).toBeGreaterThanOrEqual(bar.x - 1);
        expect(b.x + b.width).toBeLessThanOrEqual(bar.x + bar.width + 1);
      }
      expect((await box(page, "live-sim-picker")).width).toBeGreaterThan(90);
    });
  }
});
