import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors } from "./fixtures";

// Inputs & capacity: the presenter's what-if flow (Black Friday at 3×, the heat map, Apply fix),
// undo, "Save to simulation" across a reload, the heat map in edit mode, and real units.

const KAFKA = "kafka-order-pipeline";
/** Index of 3× on the Traffic × slider (TRAFFIC_STOPS in src/live/capacityModel.ts). */
const TRAFFIC_3X = "14";

const level = (page: Page, nodeId: string) => page.getByTestId(`capacity-label-${nodeId}`);

async function openBlackFridayInputs(page: Page) {
  await page.goto(`./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await page.getByTestId("live-sim-picker").selectOption("black-friday");
  await page.getByTestId("live-capacity").click();
  await expect(page.getByTestId("capacity-panel")).toBeVisible();
}

test.describe("inputs & capacity", () => {
  test("presenter flow: Black Friday, 3× traffic, Payments saturates, Apply fix turns it green", async ({
    page,
    consoleErrors,
  }) => {
    await openBlackFridayInputs(page);
    const panel = page.getByTestId("capacity-panel");
    // Meaningful with zero input: real rates, a healthy-but-busy fleet, databases left neutral.
    await expect(page.getByTestId("capacity-rate-shopper")).toHaveValue("2k");
    await expect(page.getByTestId("scale-indicator")).toContainText("1 dot ≈ 50 messages");
    await expect(level(page, "payments")).toHaveAttribute("data-level", "warn");
    await expect(level(page, "payments")).toContainText("78% · 2k/s of 2.6k/s");
    await expect(page.getByTestId("capacity-label-payment-db")).toHaveCount(0);
    await expect(panel.getByTestId("bottleneck-callout")).toHaveAttribute("data-tone", "warn");
    await expect(page.getByTestId("bottleneck-apply")).toHaveCount(0);
    await expect(page.getByTestId("capacity-preset-normal")).toHaveAttribute("aria-pressed", "true");

    const run = await page.getByTestId("live-clock").getAttribute("data-ms");
    await page.getByTestId("capacity-traffic-mult").fill(TRAFFIC_3X);
    await expect(page.getByTestId("capacity-traffic-mult-value")).toHaveText("3×");
    await expect(page.getByTestId("capacity-dirty")).toBeVisible();
    await expect(level(page, "payments")).toHaveAttribute("data-level", "over");
    await expect(page.getByTestId("capacity-ring-payments")).toHaveAttribute("data-level", "over");
    await expect(page.getByTestId("bottleneck-callout")).toHaveAttribute("data-tone", "over");
    await expect(page.getByTestId("bottleneck-headline")).toContainText("over capacity");
    await expect(page.getByTestId("bottleneck-fix")).toContainText("and 2 more");
    await expect(page.getByTestId("bottleneck-fix")).toHaveAttribute("title", /Payments service 6 → 26 replicas/);
    // Multipliers apply to the running run: it keeps going rather than restarting.
    expect(Number(await page.getByTestId("live-clock").getAttribute("data-ms"))).toBeGreaterThanOrEqual(Number(run));

    await page.getByTestId("bottleneck-apply").click();
    await expect(level(page, "payments")).toHaveAttribute("data-level", "ok");
    for (const id of ["orders", "inventory", "notifications", "order-events"])
      await expect(level(page, id)).toHaveAttribute("data-level", "ok");
    await expect(page.getByTestId("capacity-replicas-payments")).toHaveValue("26");
    await expect(page.getByTestId("bottleneck-callout")).toHaveAttribute("data-tone", "ok");
    await expect(page.getByTestId("live-notice")).toContainText("Applied the fix");
    expectNoErrors(consoleErrors);
  });

  test("Apply fix is one undoable edit", async ({ page }) => {
    await openBlackFridayInputs(page);
    await page.getByTestId("capacity-traffic-mult").fill(TRAFFIC_3X);
    await page.getByTestId("bottleneck-apply").click();
    await expect(level(page, "payments")).toHaveAttribute("data-level", "ok");
    await page.getByTestId("undo-button").click();
    await expect(level(page, "payments")).toHaveAttribute("data-level", "over");
    await expect(page.getByTestId("capacity-replicas-payments")).toHaveValue("6");
    // The what-if (3× traffic) survives the undo.
    await expect(page.getByTestId("capacity-traffic-mult-value")).toHaveText("3×");
    await page.getByTestId("redo-button").click();
    await expect(level(page, "payments")).toHaveAttribute("data-level", "ok");
  });

  test("Save to simulation persists the inputs across a reload", async ({ page }) => {
    await openBlackFridayInputs(page);
    await page.getByTestId("capacity-traffic-mult").fill(TRAFFIC_3X);
    await page.getByTestId("capacity-replicas-payments-inc").click();
    await expect(page.getByTestId("capacity-replicas-payments")).toHaveValue("7");
    await page.getByTestId("capacity-rate-shopper").fill("2.5k");
    await page.getByTestId("capacity-rate-shopper").press("Enter");
    await expect(page.getByTestId("capacity-effective-shopper")).toContainText("7.5k/s");
    await page.getByTestId("capacity-save").click();
    await expect(page.getByTestId("capacity-dirty")).toHaveCount(0);
    await expect(page.getByTestId("capacity-save")).toBeDisabled();
    await expect(page.getByTestId("live-notice")).toContainText("Saved");

    await page.reload();
    await expect(page.getByTestId("live-sim-picker")).toHaveValue("black-friday");
    await page.getByTestId("live-capacity").click();
    await expect(page.getByTestId("capacity-dirty")).toHaveCount(0);
    await expect(page.getByTestId("capacity-traffic-mult-value")).toHaveText("3×");
    await expect(page.getByTestId("capacity-replicas-payments")).toHaveValue("7");
    await expect(page.getByTestId("capacity-rate-shopper")).toHaveValue("2.5k");
    await expect(page.getByTestId("scale-indicator")).toHaveAttribute("data-scale", "50");
  });

  test("Reset discards the what-ifs; Esc closes the panel and keeps live view", async ({ page }) => {
    await openBlackFridayInputs(page);
    await page.getByTestId("capacity-preset-black-friday").click();
    await expect(page.getByTestId("capacity-preset-black-friday")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("capacity-traffic-mult-value")).toHaveText("5×");
    await page.getByTestId("capacity-preset-half-pods").click();
    await expect(page.getByTestId("capacity-capacity-mult-value")).toHaveText("0.5×");
    await page.getByTestId("capacity-reset").click();
    await expect(page.getByTestId("capacity-traffic-mult-value")).toHaveText("1×");
    await expect(page.getByTestId("capacity-capacity-mult-value")).toHaveText("1×");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("capacity-panel")).toHaveCount(0);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await expect(page.getByTestId("live-capacity")).toBeFocused();
    // The heat map stays on with the callout floating over the canvas.
    await expect(page.getByTestId("bottleneck-callout")).toBeVisible();
  });

  test("the heat map in edit mode: View menu, C and the canvas menu; a fix there is undoable", async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, KAFKA);
    await expect(page.getByTestId("capacity-layer")).toHaveCount(0);
    await page.getByTestId("view-button").click();
    await page.getByTestId("capacity-overlay-toggle").click();
    await expect(page.getByTestId("capacity-layer")).toBeAttached();
    await expect(level(page, "orders")).toHaveAttribute("data-level", "ok");
    await expect(page.getByTestId("bottleneck-headline")).toHaveText("Healthy: every service has headroom");

    // A slow service in the inspector goes red; Apply fix raises its replicas, and undo reverts it.
    await page.getByTestId("node-payments").click();
    await page.getByTestId("inspector-section-node-simulation").click();
    await page.getByTestId("inspector-field-latencyMs").fill("20000");
    await expect(level(page, "payments")).toHaveAttribute("data-level", "over");
    await page.getByTestId("bottleneck-apply").click();
    await expect(level(page, "payments")).toHaveAttribute("data-level", "ok");
    await expect(page.getByTestId("inspector-field-replicas")).not.toHaveValue("");
    await page.getByTestId("undo-button").click();
    await expect(level(page, "payments")).toHaveAttribute("data-level", "over");

    // C hides it again; the canvas menu shows and toggles the same setting.
    await page.getByTestId("node-payments").click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("c");
    await expect(page.getByTestId("capacity-layer")).toHaveCount(0);
    await page.getByTestId("diagram-card").click({ position: { x: 4, y: 4 } });
    await page.getByTestId("canvas-view").click({ button: "right", position: { x: 700, y: 820 } });
    await expect(page.getByTestId("context-menu-item-view.capacity")).toBeVisible();
    await page.getByTestId("context-menu-item-view.capacity").click();
    await expect(page.getByTestId("capacity-layer")).toBeAttached();
    // It's a remembered preference.
    await page.reload();
    await expect(page.getByTestId("capacity-layer")).toBeAttached();
    expectNoErrors(consoleErrors);
  });

  test("idle replicas behind too few partitions say so, and the fix adds partitions", async ({ page }) => {
    await page.goto("./?view=canvas&example=iot-telemetry&live=1&sim=hot-spot&paused=1");
    await page.getByTestId("live-capacity").click();
    await expect(page.getByTestId("bottleneck-headline")).toHaveText("Device state projector: 63 of 64 replicas idle");
    await expect(page.getByTestId("capacity-idle-hot")).toContainText("63/64 idle");
    await expect(page.getByTestId("bottleneck-fix")).toContainText("1 → 64 partitions");
    await page.getByTestId("bottleneck-apply").click();
    await expect(page.getByTestId("capacity-partitions-hub")).toHaveValue("64");
    await expect(page.getByTestId("capacity-idle-hot")).toHaveCount(0);
  });

  test("fan-out edges take a share of messages in the inspector; it feeds the analysis", async ({ page }) => {
    await gotoCanvas(page, KAFKA);
    await page.getByTestId("view-button").click();
    await page.getByTestId("capacity-overlay-toggle").click();
    // Order service fans out: its edge to the topic can carry only part of the traffic.
    await page.getByTestId("edge-label-orders-to-order-events").click();
    await expect(page.getByTestId("inspector-field-share")).toHaveCount(0);
    await page.getByTestId("inspector-section-edge-simulation").click();
    await expect(page.getByTestId("inspector-field-share")).toHaveValue("");
    await page.getByTestId("inspector-field-share").fill("50");
    await expect(page.getByTestId("capacity-label-order-events")).toContainText("13/s");
    await page.getByTestId("inspector-field-share").fill("");
    await expect(page.getByTestId("capacity-label-order-events")).toContainText("25/s");
    // A broker's competing route takes no share: it delivers to one consumer rather than copying.
    await page.getByTestId("edge-label-order-events-to-payments").click();
    await expect(page.getByTestId("inspector-section-edge-simulation")).toHaveCount(0);
  });
});
