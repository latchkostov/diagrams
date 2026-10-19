import { cloudLesson, resourceLesson } from "../../src/model/autoscaling";
import { waitingFixture } from "../../src/lab/waitingFixture";
import {
  test,
  expect,
  gotoLive,
  gotoCanvas,
  pauseClock,
  waitForStableViewport,
  savedDiagram,
  STORAGE_KEYS,
  expectNoErrors,
} from "./fixtures";

test("raising Traffic mid-run pauses at the work budget with an accessible recovery notice", async ({
  page,
  consoleErrors,
}) => {
  const d = waitingFixture();
  // A terminal source keeps this test about scripted work and the animation loop, without a large queue.
  d.nodes = [d.nodes[0]];
  d.edges = [];
  d.simulations = [
    {
      id: "budget",
      title: "Budget",
      scale: 1,
      durationMs: 2000,
      traffic: [{ id: "traffic", node: "source", shape: { kind: "constant", ratePerSec: 200_000, durationMs: 1000 } }],
    },
  ];
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    d,
  });
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1&sim=budget");
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  await page.clock.runFor(500);
  await page.getByTestId("live-capacity").click();
  await page.getByTestId("capacity-traffic-mult").fill("12"); // Traffic ×2.
  await expect(page.getByTestId("capacity-traffic-mult-value")).toHaveText("2×");
  await page.clock.runFor(500);
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
  await expect(page.getByTestId("live-notice")).toHaveAttribute("role", "status");
  await expect(page.getByTestId("live-notice")).toContainText("restart with more messages per dot");
  const stopped = Number(await page.getByTestId("live-clock").getAttribute("data-ms"));
  expect(stopped).toBeGreaterThan(0);
  await page.clock.runFor(100);
  await expect(page.getByTestId("live-clock")).toHaveAttribute("data-ms", String(stopped));
  // Recovery exercises the same frame loop that used to die when the exception escaped.
  await page.getByTestId("capacity-traffic-mult").fill("9"); // Traffic ×1.
  await expect(page.getByTestId("capacity-traffic-mult-value")).toHaveText("1×");
  await page.getByTestId("live-restart").click();
  await expect(page.getByTestId("live-notice")).toHaveCount(0);
  await page.getByTestId("live-play").click();
  await page.clock.runFor(500);
  await expect
    .poll(async () => Number(await page.getByTestId("live-clock").getAttribute("data-ms")))
    .toBeGreaterThan(0);
  expectNoErrors(consoleErrors);
});

async function seed(page: import("@playwright/test").Page, older = false, empty = false) {
  const d = waitingFixture();
  d.nodes[0].props = { ...d.nodes[0].props, ratePerSec: 100 };
  if (older) d.planning = { revision: "p3-a1" };
  if (empty) {
    d.nodes[0].props = { ratePerSec: 0 };
    d.nodes[1].props = { ...d.nodes[1].props, resources: resourceLesson(), autoscaling: cloudLesson("cloud-run") };
  }
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    d,
  });
}

test("the caller meter and hover explain held threads and their throughput ceiling", async ({ page }) => {
  await seed(page);
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  await page.clock.runFor(1000);
  await page.getByTestId("live-play").click();
  const meter = page.getByTestId("thread-meter-caller");
  await expect(meter).toBeVisible();
  await expect(meter).toHaveAttribute("data-waiting", "4");
  await expect(meter).toHaveAttribute("aria-valuenow", "4");
  await page.getByTestId("node-caller").hover();
  await expect(page.getByTestId("thread-detail-caller")).toContainText("4 waiting on Partner scoring API");
  await expect(page.getByTestId("thread-ceiling")).toBeVisible();
  await expect(page.getByTestId("thread-ceiling")).toContainText("15.38 req/s = 4 threads ÷ 0.26 s");
  await expect(page.getByTestId("thread-ceiling")).not.toContainText("msg/s");
  await expect(page.getByTestId("thread-ceiling")).toContainText("10 ms work + 250 ms call");
  await page.clock.runFor(200); // Finish the hover animation on the paused fake clock.
  await test.info().attach("waiting threads", { body: await page.screenshot(), contentType: "image/png" });
});

test("older diagrams preview changed capacity, upgrade once and undo the complete model", async ({ page }) => {
  await seed(page, true);
  await gotoCanvas(page, "blocking-call");
  await waitForStableViewport(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("diagram properties");
  await page.keyboard.press("Enter");
  await page.getByTestId("waits-upgrade-preview").click();
  await expect(page.getByTestId("planning-upgrade-preview")).toContainText("Decision service");
  await expect(page.getByTestId("planning-upgrade-preview")).toContainText("400");
  await page.getByTestId("planning-upgrade").click();
  expect((await savedDiagram(page)).planning?.revision).toBe("p3-w1");
  await page.getByTestId("undo-button").click();
  await expect.poll(async () => (await savedDiagram(page)).planning?.revision).toBe("p3-a1");
});

test("historical models have no thread meter", async ({ page }) => {
  await seed(page, true);
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await expect(page.getByTestId("thread-meter-caller")).toHaveCount(0);
});

test("an empty caller pool keeps the busy chip quiet", async ({ page }) => {
  await seed(page, false, true);
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await expect(page.getByTestId("node-badge-caller")).toHaveAttribute("data-ready", "0");
  await expect(page.getByTestId("thread-meter-caller")).toBeVisible();
  await expect(page.getByTestId("thread-chip-caller")).toHaveCount(0);
});

test("a fixed execution pool fills its meter using its effective capacity", async ({ page }) => {
  const d = waitingFixture();
  d.nodes[0].props = { ...d.nodes[0].props, ratePerSec: 100 };
  d.nodes[1].stencil = "azure.functions";
  d.nodes[1].props = { ...d.nodes[1].props, scaling: "fixed", maxConcurrency: 1000 };
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
  const meter = page.getByTestId("thread-meter-caller");
  await expect(meter).toHaveAttribute("aria-valuemax", "4");
  await expect(meter).toHaveAttribute("aria-valuenow", "4");
  await expect(page.getByTestId("thread-chip-caller")).toContainText("4 of 4 executions busy");
});
