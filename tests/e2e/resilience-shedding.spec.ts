import type { Page } from "@playwright/test";
import { sheddingFixture } from "../../src/lab/resilienceFixture";
import {
  test,
  expect,
  gotoLive,
  pauseClock,
  savedDiagram,
  STORAGE_KEYS,
  waitForCameraIdle,
  expectNoErrors,
  openLiveNodeDetails,
} from "./fixtures";

async function open(page: Page, simulation = false) {
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    d: sheddingFixture(),
  });
  await gotoLive(page, `./?view=canvas&example=blocking-call&live=1&paused=1${simulation ? "&sim=shedding" : ""}`);
}

test("queue fields at 1024 px edit the effective saved simulation and undo as one change", async ({
  page,
  consoleErrors,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await open(page, true);
  await waitForCameraIdle(page);
  await page.getByTestId("node-partner").dblclick();
  await page.getByTestId("inspector-section-node-simulation").click();
  await page.getByTestId("inspector-section-queue-details").click();
  const limit = page.getByTestId("inspector-field-queue-limit");
  await expect(limit).toHaveValue("2");
  await expect(page.getByTestId("inspector-body-queue-details").getByTestId("queue-simulation-override")).toContainText(
    "Limit 3",
  );
  await limit.fill("5");
  await limit.press("Tab");
  await expect
    .poll(async () => (await savedDiagram(page)).simulations?.[0].setup?.props?.partner.queue)
    .toMatchObject({ limit: 5 });
  expect((await savedDiagram(page)).nodes.find((n) => n.id === "partner")?.props?.queue).toMatchObject({ limit: 3 });
  await page.getByTestId("undo-button").click();
  await expect(limit).toHaveValue("2");
  const maxWait = page.getByTestId("inspector-field-queue-maxWaitMs");
  await maxWait.fill("80");
  await maxWait.press("Tab");
  await expect
    .poll(async () => (await savedDiagram(page)).simulations?.[0].setup?.props?.partner.queue)
    .toMatchObject({ maxWaitMs: 80 });
  const panel = page.getByTestId("inspector-content-queue-details");
  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) throw new Error("Queue inspector has no bounds");
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(1024);
  await page.screenshot({ path: test.info().outputPath("queue-inspector-1024.png") });
  expectNoErrors(consoleErrors);
});

test("shedding shows a cumulative chip and reachable hover explanation with the actual queue limit", async ({
  page,
  consoleErrors,
}) => {
  await page.clock.install();
  await open(page);
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  await page.clock.runFor(1500);
  await page.getByTestId("live-play").click();
  await expect(page.getByTestId("node-shed-partner")).toContainText("⤓");
  await expect(page.getByTestId("node-shed-partner")).toHaveAttribute("title", /since restart/);
  await openLiveNodeDetails(page, "partner", "threads");
  await expect(page.getByTestId("node-shed-detail-partner")).toContainText("since restart");
  await expect(page.getByTestId("node-queue-detail-partner")).toContainText("of 3 queued");
  expectNoErrors(consoleErrors);
});

test("incoming connection priority persists through the existing inspector dropdown", async ({
  page,
  consoleErrors,
}) => {
  await open(page);
  await waitForCameraIdle(page);
  await page.getByTestId("edge-call").dblclick();
  await page.getByTestId("inspector-section-edge-simulation").click();
  await page.getByTestId("inspector-section-queue-priority").click();
  await page.getByTestId("inspector-field-priority").click();
  await page.getByTestId("context-menu-item-critical").click();
  await expect
    .poll(async () => (await savedDiagram(page)).edges.find((e) => e.id === "call")?.props?.priority)
    .toBe("critical");
  await page.getByTestId("undo-button").click();
  await expect(page.getByTestId("inspector-field-priority")).toContainText("Normal");
  expectNoErrors(consoleErrors);
});
