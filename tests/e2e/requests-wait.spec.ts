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
} from "./fixtures";

async function seed(page: import("@playwright/test").Page, older = false) {
  const d = waitingFixture();
  d.nodes[0].props = { ...d.nodes[0].props, ratePerSec: 100 };
  if (older) d.planning = { revision: "p3-a1" };
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
