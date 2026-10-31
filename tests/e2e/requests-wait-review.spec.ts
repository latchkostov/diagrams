import { test, expect, gotoLive, pauseClock, STORAGE_KEYS } from "./fixtures";
import type { DiagramFile } from "../../src/model/types";
import payment from "../../src/examples/slow-payment-provider.json" with { type: "json" };
import { installThreadVerification } from "./thread-verification";

for (const failureRate of [0, 0.3]) {
  test(`timeout outcomes keep independent loss warnings visible at failure rate ${failureRate}`, async ({ page }) => {
    const d = structuredClone(payment) as DiagramFile;
    const checkout = d.nodes.find((n) => n.id === "checkout");
    if (!checkout) throw new Error("Fixture needs Checkout");
    checkout.props = { ...checkout.props, failureRate };
    await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
      key: STORAGE_KEYS.autosavePrefix + "slow-payment-provider",
      d,
    });
    await page.clock.install();
    await gotoLive(page, "./?view=canvas&example=slow-payment-provider&live=1&paused=1&sim=timeout-600");
    await pauseClock(page);
    await page.getByTestId("live-play").click();
    await page.clock.runFor(15000);
    await page.getByTestId("live-play").click();
    await expect(page.getByTestId("node-alert-checkout")).toBeVisible();
    if (failureRate) {
      await expect(page.getByTestId("trouble-headline")).toContainText("losing");
      await expect(page.getByTestId("trouble-action")).toHaveAttribute("data-action", "events");
    } else await expect(page.getByTestId("trouble-callout")).toHaveCount(0);
  });
}

test("a resumed narration still offers the same verified timeout", async ({ page }) => {
  const d = structuredClone(payment) as DiagramFile;
  const simulation = d.simulations?.[0];
  if (!simulation?.timeline) throw new Error("Fixture needs a timeline");
  simulation.timeline.unshift({
    atMs: 0,
    action: { do: "note", text: "Continue to start the lesson", pause: true },
  });
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "slow-payment-provider",
    d,
  });
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=slow-payment-provider&live=1&paused=1&sim=no-timeouts");
  await pauseClock(page);
  await expect(page.getByTestId("live-note-continue")).toBeVisible();
  await page.getByTestId("live-note-continue").click();
  await page.getByTestId("live-play").click();
  await page.clock.runFor(15000);
  await page.getByTestId("live-play").click();
  await expect(page.getByTestId("trouble-action")).toHaveAttribute("data-action", "add-timeout");
});

test("verification observation preserves both real worker transfer overloads", async ({ page }) => {
  await installThreadVerification(page);
  await page.route("**/verification-transfer-worker.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: "onmessage = event => postMessage(event.data.byteLength)" }),
  );
  await gotoLive(page, "./?view=canvas&example=slow-payment-provider&live=1&paused=1&sim=no-timeouts");
  const transfers = await page.evaluate(async () => {
    const worker = new Worker("/verification-transfer-worker.js");
    try {
      const results = [];
      for (const options of [false, true]) {
        const buffer = new ArrayBuffer(16);
        const reply = new Promise<number>((resolve, reject) => {
          worker.onmessage = (event: MessageEvent<number>) => resolve(event.data);
          worker.onerror = () => reject(new Error("The transfer regression worker failed"));
        });
        if (options) worker.postMessage(buffer, { transfer: [buffer] });
        else worker.postMessage(buffer, [buffer]);
        results.push({ remaining: buffer.byteLength, received: await reply });
      }
      return results;
    } finally {
      worker.terminate();
    }
  });
  expect(transfers).toEqual([
    { remaining: 0, received: 16 },
    { remaining: 0, received: 16 },
  ]);
});

test("verification replays Continue and a timed Capacity change as the run played them", async ({ page }) => {
  const d = structuredClone(payment) as DiagramFile;
  const simulation = d.simulations?.[0];
  if (!simulation?.timeline) throw new Error("Fixture needs a timeline");
  simulation.timeline.unshift(
    { atMs: 0, action: { do: "note", text: "Continue", pause: true } },
    { atMs: 0, action: { do: "props", node: "checkout", props: { concurrency: 20 } } },
  );
  await installThreadVerification(page);
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "slow-payment-provider",
    d,
  });
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=slow-payment-provider&live=1&paused=1&sim=no-timeouts");
  await pauseClock(page);
  await page.getByTestId("live-note-continue").click();
  await page.getByTestId("live-play").click();
  await page.clock.runFor(2000);
  await page.getByTestId("live-play").click();
  const inputTime = Number(await page.getByTestId("live-clock").getAttribute("data-ms"));
  expect(inputTime).toBeGreaterThan(0);
  await page.getByTestId("live-capacity").click();
  await page.getByTestId("capacity-capacity-mult").fill("7");
  await page.getByTestId("capacity-close").click();
  await page.getByTestId("live-play").click();
  await page.clock.runFor(13000);
  await page.getByTestId("live-play").click();
  await expect(page.getByTestId("trouble-action")).toHaveAttribute("data-action", "add-timeout");
  const request = await page.evaluate(() => window.__threadVerification?.requests.at(-1));
  if (!request) throw new Error("Expected a verification request");
  // The origin is the run's start; the Capacity change is a control at the moment it was made, after Continue.
  expect(request.context.origin.simulation.multipliers?.capacity ?? 1).toBe(1);
  expect(request.context.controls[0]).toMatchObject({ time: 0, op: { kind: "resume" } });
  expect(request.context.controls).toContainEqual(
    expect.objectContaining({
      time: inputTime,
      op: expect.objectContaining({ kind: "configuration", multipliers: { traffic: 1, capacity: 1.25 } }),
    }),
  );
});

test("a held verification keeps one request outstanding and then posts only the latest revision", async ({ page }) => {
  await installThreadVerification(page, true);
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=slow-payment-provider&live=1&paused=1&sim=no-timeouts");
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  await page.clock.runFor(15000);
  await page.getByTestId("live-play").click();
  await expect.poll(() => page.evaluate(() => window.__threadVerification?.requests.length)).toBe(1);
  await expect(page.getByTestId("trouble-action")).toHaveAttribute("data-action", "events");
  await page.getByTestId("live-capacity").click();
  for (let i = 0; i < 10; i++) await page.getByTestId("capacity-capacity-mult").fill(i % 2 ? "7" : "6");
  expect(await page.evaluate(() => window.__threadVerification?.requests.length)).toBe(1);
  await page.getByTestId("capacity-close").click();
  await page.evaluate(() => window.__threadVerification?.release?.());
  await expect.poll(() => page.evaluate(() => window.__threadVerification?.requests.length)).toBe(2);
  await expect(page.getByTestId("trouble-action")).toHaveAttribute("data-action", "add-timeout");
  const requests = await page.evaluate(() => window.__threadVerification?.requests);
  if (!requests) throw new Error("Expected the verification probe");
  expect(requests).toHaveLength(2);
  expect(requests[1].context.revision).toBeGreaterThan(requests[0].context.revision);
  expect(requests[1].context.controls.at(-1)?.op).toMatchObject({
    kind: "configuration",
    multipliers: { capacity: 1.25 },
  });
});
