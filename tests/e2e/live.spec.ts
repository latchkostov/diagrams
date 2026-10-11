import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, gotoLab, expectNoErrors } from "./fixtures";

// Live view: the toggle, injection from the context menu, saved simulations, narration, the storm
// flow, presentation mode and the Lab presets. Selectors are data-testid only. Runs are seeded, and
// the URL's `speed` param plays them faster.

const KAFKA = "kafka-order-pipeline";
const menuItem = (page: Page, id: string) => page.getByTestId(`context-menu-item-${id}`);

async function openNodeMenu(page: Page, nodeId: string) {
  await page.getByTestId(`node-${nodeId}`).click({ button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();
}

const processed = async (page: Page, nodeId: string) =>
  Number(await page.getByTestId(`node-badge-${nodeId}`).getAttribute("data-processed"));

test.describe("live view", () => {
  test("the Live toggle (and L) shows and hides the controls", async ({ page, consoleErrors }) => {
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
    await page.getByTestId("live-exit").click();
    await expect(page.getByTestId("live-controls")).toHaveCount(0);

    // The Simulation menu section exists only while live.
    await openNodeMenu(page, "payments");
    await expect(page.getByTestId("context-menu")).not.toContainText("Simulation");
    expectNoErrors(consoleErrors);
  });

  test("Inject 10 at a node updates its badge and processed counts appear downstream", async ({
    page,
    consoleErrors,
  }) => {
    await page.goto(`./?view=canvas&example=${KAFKA}&live=1&traffic=0&speed=4`);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await expect(page.getByTestId("live-in-system")).toHaveAttribute("data-count", "0");

    await openNodeMenu(page, "inventory");
    await expect(menuItem(page, "sim.storm")).toBeVisible();
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
    await openNodeMenu(page, "payments");
    await menuItem(page, "sim.kill").click();
    await expect(page.getByTestId("node-badge-payments")).toHaveAttribute("data-status", "down");
    await openNodeMenu(page, "inventory");
    await menuItem(page, "sim.behaviour").click();
    await menuItem(page, "sim.events").click();
    await expect(page.getByTestId("live-events")).toBeVisible();
    await expect(page.getByTestId("live-events-filter")).toHaveValue("inventory");
    await expect(page.getByTestId("live-events-list")).toContainText("Inventory service");
    expectNoErrors(consoleErrors);
  });

  test("a saved simulation runs to done with every expectation passing", async ({ page, consoleErrors }) => {
    test.setTimeout(60_000);
    await page.goto(`./?view=canvas&example=${KAFKA}&sim=black-friday&speed=8`);
    await expect(page.getByTestId("live-sim-picker")).toHaveValue("black-friday");
    await expect(page.getByTestId("live-timeline")).toBeVisible();
    await expect(page.getByTestId("expectation-stock")).toHaveAttribute("data-status", "pending");
    await expect(page.getByTestId("live-done")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("live-done")).toHaveAttribute("data-status", "pass");
    for (const id of ["stock", "payments", "notifications", "orders", "no-dlq", "no-drop"]) {
      await expect(page.getByTestId(`expectation-${id}`)).toHaveAttribute("data-status", "pass");
    }
    await expect(page.getByTestId("expectation-stock")).toHaveAttribute("data-value", "500");
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "done");
    expectNoErrors(consoleErrors);
  });

  test("a pausing note waits for Continue", async ({ page, consoleErrors }) => {
    await page.goto(`./?view=canvas&example=${KAFKA}&sim=payments-outage&speed=8`);
    await expect(page.getByTestId("live-note-continue")).toBeVisible({ timeout: 15_000 });
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
    await page.goto("./?view=canvas&example=azure-service-bus-integration&live=1&traffic=0");
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await openNodeMenu(page, "ingest");
    await menuItem(page, "sim.storm").click();

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

    // Autosave runs ~300 ms after the edit.
    await page.waitForTimeout(700);
    await page.reload();
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await expect(page.getByTestId("live-sim-picker")).toContainText("Month-end storm");
    expectNoErrors(consoleErrors);
  });

  test("presentation + live from the URL: notes, Space to pause, Esc leaves presentation only", async ({
    page,
    consoleErrors,
  }) => {
    await page.goto(`./?view=canvas&example=${KAFKA}&live=1&present=1&sim=black-friday`);
    await expect(page.getByTestId("present-exit")).toBeVisible();
    await expect(page.getByTestId("topbar")).toHaveCount(0);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await expect(page.getByTestId("live-note")).toContainText("500 checkouts");
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
    await page.goto(`./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await page.getByTestId("edge-label-order-events-to-payments").click({ button: "right" });
    await menuItem(page, "sim.trace").click();
    await expect(page.getByTestId("live-trace")).toBeVisible();
    await page.getByTestId("live-trace-clear").click();
    await expect(page.getByTestId("live-trace")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("Lab presets render the live view", async ({ page, consoleErrors }) => {
    await gotoLab(page, "live-badge-states");
    await expect(page.getByTestId("live-lab-stage")).toBeVisible();
    await expect(page.getByTestId("node-badge-down-svc")).toHaveAttribute("data-status", "down");
    await expect(page.getByTestId("node-badge-paused-svc")).toHaveAttribute("data-status", "paused");
    await expect
      .poll(async () => Number(await page.getByTestId("node-badge-worker").getAttribute("data-failed")))
      .toBeGreaterThan(0);
    await expect(page.getByTestId("live-exit")).toHaveCount(0);

    await gotoLab(page, "live-particles-stress", { particles: 500 });
    await expect
      .poll(async () => Number(await page.getByTestId("live-canvas").getAttribute("data-particles")), {
        timeout: 10_000,
      })
      .toBeGreaterThan(100);

    await gotoLab(page, "live-note-states", { note: "pause" });
    await expect(page.getByTestId("live-note-continue")).toBeVisible();
    expectNoErrors(consoleErrors);
  });
});
