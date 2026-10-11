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
    // Under Show ▸, with the other things you can show (grid, minimap, inspector).
    await page.getByTestId("context-menu-item-canvas.view-options").click();
    await expect(page.getByTestId("context-menu-item-view:capacity")).toBeVisible();
    await page.getByTestId("context-menu-item-view:capacity").click();
    await expect(page.getByTestId("capacity-layer")).toBeAttached();
    // It's a remembered preference.
    await page.reload();
    await expect(page.getByTestId("capacity-layer")).toBeAttached();
    expectNoErrors(consoleErrors);
  });

  test("opening Inputs shows the heat map for the live session only, not as a remembered setting", async ({ page }) => {
    await openBlackFridayInputs(page);
    await expect(page.getByTestId("capacity-ring-payments")).toBeAttached();
    await page.getByTestId("capacity-close").click();
    // Closing the panel keeps the colours for the rest of the session...
    await expect(page.getByTestId("bottleneck-callout")).toBeVisible();
    // ...but edit mode, and the next visit, return to what the user chose.
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("capacity-layer")).toHaveCount(0);
    await expect(page.getByTestId("bottleneck-callout")).toHaveCount(0);
    await page.goto(`./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await expect(page.getByTestId("bottleneck-callout")).toHaveCount(0);
  });

  test("no entry point yet: the panel offers one, and the planner sets 5k msg/s", async ({ page, consoleErrors }) => {
    const diagram = {
      format: "diagrams/v1",
      title: "Orders",
      nodes: [
        { id: "api", stencil: "service.go", label: "Order API", x: 0, y: 120 },
        { id: "orders", stencil: "kafka.topic", label: "orders", x: 320, y: 120, props: { partitions: 6 } },
        ...["Billing", "Shipping", "Email"].map((label, i) => ({
          id: label.toLowerCase(),
          stencil: "service.java",
          label,
          x: 640,
          y: i * 120,
        })),
      ],
      edges: [
        { id: "e0", from: "api", to: "orders" },
        ...["billing", "shipping", "email"].map((to) => ({ id: `e-${to}`, from: "orders", to })),
      ],
    };
    await page.goto("./?view=lab&preset=custom-json");
    await page.getByTestId("lab-json-toggle").click();
    await page.getByTestId("lab-json-input").fill(JSON.stringify(diagram));
    await page.getByTestId("lab-json-apply").click();
    await page.getByTestId("lab-open-editor").click();
    await page.getByTestId("live-toggle").click();
    await page.getByTestId("live-capacity").click();

    // Not a dead end: it names where traffic could enter.
    await expect(page.getByTestId("capacity-no-entries")).toBeVisible();
    await expect(page.getByTestId("capacity-add-entry-orders")).toHaveCount(0);
    await page.getByTestId("capacity-add-entry-api").click();
    await expect(page.getByTestId("capacity-no-entries")).toHaveCount(0);
    const rate = page.locator('[data-testid^="capacity-rate-"]:not([data-testid*="slider"])').first();
    await expect(rate).toBeFocused();
    await rate.fill("5k");
    await rate.press("Enter");
    // The answer: a named bottleneck with a fix.
    await expect(page.getByTestId("bottleneck-callout")).toHaveAttribute("data-tone", "over");
    await expect(page.getByTestId("bottleneck-apply")).toBeVisible();
    // One undo removes the entry point (node, label and edge together).
    await page.getByTestId("capacity-close").click();
    await page.getByTestId("live-toggle").click();
    await page.getByTestId("undo-button").click();
    await expect(page.locator('[data-testid^="node-"]').filter({ hasText: "Incoming traffic" })).toHaveCount(0);
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

test.describe("fourth review capacity regressions", () => {
  test("unsupported rate drafts show inline errors and never save", async ({ page }) => {
    await openBlackFridayInputs(page);
    await page.getByTestId("capacity-capacity-mult").fill("9");
    for (const rate of ["12k", "20k"]) {
      await page.getByTestId("capacity-rate-shopper").fill(rate);
      await page.getByTestId("capacity-rate-shopper").press("Enter");
      await expect(page.getByTestId("capacity-rate-shopper")).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByTestId("capacity-rate-shopper-error")).toContainText("10,000");
      await expect(page.getByTestId("capacity-save")).toBeDisabled();
      await page.getByTestId("capacity-context").click();
      await expect(page.getByTestId("capacity-rate-shopper")).toHaveValue(rate);
    }
    await page.reload();
    await page.getByTestId("live-capacity").click();
    await expect(page.getByTestId("capacity-rate-shopper")).toHaveValue("2k");
    await expect(page.getByTestId("capacity-capacity-mult-value")).toHaveText("1×");
  });

  test("invalid numeric drafts explain native bounds and block Save until corrected", async ({ page }) => {
    await openBlackFridayInputs(page);
    await page.getByTestId("capacity-capacity-mult").fill("9");
    await page.getByTestId("capacity-replicas-payments").fill("10001");
    await expect(page.getByTestId("capacity-replicas-payments-error")).toBeVisible();
    expect(
      await page.getByTestId("capacity-replicas-payments-error").evaluate((el) => el.scrollHeight <= el.clientHeight),
    ).toBe(true);
    await expect(page.getByTestId("capacity-save")).toBeDisabled();
    await page.getByTestId("capacity-replicas-payments").fill("7");
    await page.getByTestId("capacity-latency-payments").fill("600001");
    await expect(page.getByTestId("capacity-latency-payments-error")).toBeVisible();
    await expect(page.getByTestId("capacity-save")).toBeDisabled();
    await page.getByTestId("capacity-latency-payments").press("Escape");
    await expect(page.getByTestId("capacity-save")).toBeEnabled();
    await page.getByTestId("capacity-replicas-payments").fill("0");
    await page.getByTestId("capacity-reset").click();
    await expect(page.getByTestId("capacity-replicas-payments-error")).toHaveCount(0);
    await expect(page.getByTestId("capacity-replicas-payments")).toHaveValue("6");
  });

  test("Save rejects the document traffic budget and keeps unsaved inputs", async ({ page }) => {
    await openBlackFridayInputs(page);
    await page.getByTestId("capacity-traffic-mult").fill("19");
    await page.getByTestId("capacity-save").click();
    await expect(page.getByTestId("capacity-save-error")).toContainText("traffic volume budget");
    await expect(page.getByTestId("capacity-dirty")).toBeVisible();
    await expect(page.getByTestId("capacity-traffic-mult-value")).toHaveText("10×");
    await expect(page.getByTestId("live-notice")).toHaveCount(0);
    await page.reload();
    await page.getByTestId("live-capacity").click();
    await expect(page.getByTestId("capacity-traffic-mult-value")).toHaveText("1×");
  });

  test("free-play Save rejects folded rates over the native limit", async ({ page }) => {
    await page.goto(`./?view=canvas&example=${KAFKA}&live=1&paused=1`);
    await page.getByTestId("live-capacity").click();
    await page.getByTestId("capacity-rate-shopper").fill("2k");
    await page.getByTestId("capacity-rate-shopper").press("Enter");
    await page.getByTestId("capacity-traffic-mult").fill("19");
    await page.getByTestId("capacity-save").click();
    await expect(page.getByTestId("capacity-save-error")).toContainText("10,000");
    await expect(page.getByTestId("capacity-dirty")).toBeVisible();
    await page.reload();
    await page.getByTestId("live-capacity").click();
    await expect(page.getByTestId("capacity-rate-shopper")).toHaveValue("25");
  });

  test("Apply fix transfers keyboard focus to the stable announcement in both modes", async ({ page }) => {
    await openBlackFridayInputs(page);
    await page.getByTestId("capacity-traffic-mult").fill(TRAFFIC_3X);
    await page.getByTestId("bottleneck-apply").focus();
    await page.getByTestId("bottleneck-apply").press("Enter");
    await expect(page.getByTestId("bottleneck-callout")).toBeFocused();
    await expect(page.getByTestId("bottleneck-callout")).toHaveAttribute("role", "status");
    await page.getByTestId("capacity-close").click();
    await page.getByTestId("live-toggle").click();
    // The panel showed the heat map for the live session only; edit mode turns it on explicitly.
    await expect(page.getByTestId("capacity-layer")).toHaveCount(0);
    await page.keyboard.press("c");
    await expect(page.getByTestId("capacity-layer")).toBeAttached();
    await page.getByTestId("node-payments").click();
    await page.getByTestId("inspector-section-node-simulation").click();
    await page.getByTestId("inspector-field-latencyMs").fill("20000");
    await page.getByTestId("bottleneck-apply").focus();
    await page.getByTestId("bottleneck-apply").press("Enter");
    await expect(page.getByTestId("bottleneck-callout")).toBeFocused();
  });

  test("service and topic fields identify their node to screen readers", async ({ page }) => {
    await openBlackFridayInputs(page);
    await expect(page.getByTestId("capacity-row-payments")).toHaveAccessibleName("Payments service");
    await expect(page.getByTestId("capacity-replicas-payments")).toHaveAccessibleName("Payments service Replicas");
    await expect(page.getByTestId("capacity-latency-payments")).toHaveAccessibleName("Payments service Latency");
    await expect(page.getByTestId("capacity-failure-payments")).toHaveAccessibleName("Payments service Failures");
    await page.getByTestId("capacity-advanced-payments-toggle").click();
    await expect(page.getByTestId("capacity-concurrency-payments")).toHaveAccessibleName("Payments service Parallel");
    await expect(page.getByTestId("capacity-jitter-payments")).toHaveAccessibleName("Payments service Jitter");
    await expect(page.getByTestId("capacity-retry-payments")).toHaveAccessibleName("Payments service On failure");
    await expect(page.getByTestId("capacity-partitions-order-events")).toHaveAccessibleName(
      "orders.created.v1 Partitions",
    );
  });

  test("editing the fourth of five services keeps its row and keyboard focus", async ({ page }) => {
    const diagram = {
      format: "diagrams/v1",
      title: "Editing rows",
      nodes: [
        { id: "source", stencil: "client.browser", label: "Source", x: 0, y: 0, props: { ratePerSec: 1 } },
        ...[500, 400, 300, 200, 100].map((latencyMs, i) => ({
          id: `svc${i}`,
          stencil: "service.go",
          label: `Service ${i}`,
          x: 400,
          y: i * 120,
          props: { latencyMs, concurrency: 1, replicas: 1 },
        })),
      ],
      edges: [0, 1, 2, 3, 4].map((i) => ({ id: `e${i}`, from: "source", to: `svc${i}` })),
    };
    // Custom fixtures enter through the Lab's existing JSON surface.
    await page.goto("./?view=lab&preset=custom-json");
    await page.getByTestId("lab-json-toggle").click();
    await page.getByTestId("lab-json-input").fill(JSON.stringify(diagram));
    await page.getByTestId("lab-json-apply").click();
    await page.getByTestId("lab-open-editor").click();
    await page.getByTestId("live-toggle").click();
    await page.getByTestId("live-capacity").click();
    await expect(page.getByTestId("capacity-row-svc4")).toHaveCount(0);
    const edited = page.getByTestId("capacity-replicas-svc3");
    await edited.fill("10");
    await expect(edited).toBeFocused();
    await expect(page.getByTestId("capacity-row-svc3")).toBeVisible();
    await edited.press("Tab");
    await expect(page.getByTestId("capacity-replicas-svc3-inc")).toBeFocused();
  });

  test("playback clock ticks do not render unchanged capacity controls", async ({ page }) => {
    await page.addInitScript(() => {
      type Fiber = { child: Fiber | null; sibling: Fiber | null; memoizedProps?: { "data-testid"?: string } };
      let last: Fiber["memoizedProps"];
      let renders = 0;
      Object.assign(window, {
        capacityRenderCount: () => renders,
        __REACT_DEVTOOLS_GLOBAL_HOOK__: {
          supportsFiber: true,
          renderers: new Map(),
          inject: () => 1,
          onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
            const visit = (fiber: Fiber | null) => {
              if (!fiber) return;
              if (fiber.memoizedProps?.["data-testid"] === "capacity-panel" && fiber.memoizedProps !== last) {
                renders++;
                last = fiber.memoizedProps;
              }
              visit(fiber.child);
              visit(fiber.sibling);
            };
            visit(root.current);
          },
          onCommitFiberUnmount: () => {},
        },
      });
    });
    await openBlackFridayInputs(page);
    const count = () =>
      page.evaluate(() => (window as unknown as { capacityRenderCount(): number }).capacityRenderCount());
    const before = await count();
    expect(before).toBeGreaterThan(0);
    const clock = Number(await page.getByTestId("live-clock").getAttribute("data-ms"));
    await expect
      .poll(async () => Number(await page.getByTestId("live-clock").getAttribute("data-ms")))
      .toBeGreaterThan(clock + 1000);
    expect(await count()).toBe(before);
    await page.getByTestId("capacity-replicas-payments-inc").click();
    expect(await count()).toBeGreaterThan(before);
  });
});
