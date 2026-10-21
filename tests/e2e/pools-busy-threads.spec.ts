import { waitingFixture } from "../../src/lab/waitingFixture";
import { hpaLesson, kedaLesson, resourceLesson } from "../../src/model/autoscaling";
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  pauseClock,
  savedDiagram,
  STORAGE_KEYS,
  waitForStableViewport,
} from "./fixtures";

test("Connection pool is the same editable field for held and freed threads", async ({ page }) => {
  const d = waitingFixture();
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    d,
  });
  await page.clock.install();
  await gotoCanvas(page, "blocking-call");
  await waitForStableViewport(page);
  await page.getByTestId("edge-call").dblclick();
  await page.getByTestId("inspector-section-edge-advanced").click();
  const pool = page.getByTestId("inspector-field-poolConnections");
  await expect(pool).toHaveAccessibleName("Connection pool");
  await pool.fill("40");
  await pool.blur();
  await page.clock.runFor(400);
  await expect
    .poll(async () => (await savedDiagram(page)).edges[1].props?.caller)
    .toMatchObject({ poolConnections: 40 });
  await page.getByTestId("inspector-section-edge-simulation").click();
  await page.getByTestId("inspector-field-wait").click();
  await page.getByTestId("context-menu-item-non-blocking").click();
  await expect(pool).toHaveValue("40");
  await expect(pool).toHaveAccessibleName("Connection pool");
});

test("HPA offers a modelled busy-thread metric with percent and per-pod targets", async ({ page }) => {
  const d = waitingFixture();
  d.nodes[1].props = { ...d.nodes[1].props, resources: resourceLesson(), autoscaling: hpaLesson() };
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    d,
  });
  await gotoCanvas(page, "blocking-call");
  await page.getByTestId("node-caller").dblclick();
  await page.getByTestId("inspector-section-node-simulation").click();
  await page.getByTestId("autoscaling-advanced-toggle").click();
  await page.getByTestId("autoscaling-metric").selectOption("busyThreads");
  await expect(page.getByTestId("autoscaling-metric")).toContainText("Busy threads (modelled custom metric)");
  await expect(page.getByTestId("autoscaling-target")).toHaveAccessibleName("Busy threads (% of Concurrency)");
  await page.getByTestId("autoscaling-busy-unit").selectOption("averageValue");
  await expect(page.getByTestId("autoscaling-target")).toHaveAccessibleName("Busy threads per pod");
  await expect
    .poll(async () => (await savedDiagram(page)).nodes[1].props?.autoscaling)
    .toMatchObject({
      controller: {
        settings: {
          metrics: [{ source: { kind: "pods", metric: "busyThreads" }, target: { kind: "averageValue", value: 4 } }],
        },
      },
    });
});

test("planner offers Scale on busy threads for a waiting majority", async ({ page }) => {
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=scale-on-busy-threads&live=1&sim=blocking&paused=1");
  await pauseClock(page);
  await page.getByTestId("node-caller").dblclick();
  await page.getByTestId("planning-live-details-toggle").click();
  await expect(page.getByTestId("autoscaling-plan-text")).toContainText("more than half the busy threads are waiting");
  await expect(page.getByTestId("autoscaling-plan-text")).toContainText("Scale on busy threads");
  await expect(page.getByTestId("autoscaling-plan-text")).not.toContainText("Lower the target");
});

test("KEDA edits its generated HPA's busy metric alongside the broker target", async ({ page }) => {
  const d = waitingFixture();
  d.nodes[0].stencil = "azure.service-bus.queue";
  d.nodes[0].props = {};
  d.nodes[1].props = {
    ...d.nodes[1].props,
    resources: resourceLesson(),
    autoscaling: kedaLesson("azure-servicebus", { node: "source" }),
  };
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    d,
  });
  await gotoCanvas(page, "blocking-call");
  await page.getByTestId("node-caller").dblclick();
  await page.getByTestId("inspector-section-node-simulation").click();
  await page.getByTestId("autoscaling-advanced-toggle").click();
  await page.getByTestId("autoscaling-metric").selectOption("busyThreads");
  await page.getByTestId("autoscaling-busy-target").fill("60");
  await page.getByTestId("autoscaling-busy-target").blur();
  await expect(page.getByTestId("autoscaling-target")).toHaveAccessibleName("Target (messages per worker)");
  await expect
    .poll(async () => (await savedDiagram(page)).nodes[1].props?.autoscaling)
    .toMatchObject({
      controller: {
        kind: "keda",
        settings: {
          metrics: [
            { source: { kind: "pods", metric: "busyThreads" }, target: { kind: "utilization", percentOfRequest: 60 } },
          ],
        },
      },
    });
});
