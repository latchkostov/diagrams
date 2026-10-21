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

async function seed(page: import("@playwright/test").Page, older = false, empty = false, freed = false) {
  const d = waitingFixture();
  d.nodes[0].props = { ...d.nodes[0].props, ratePerSec: 100 };
  if (older) d.planning = { revision: "p3-a1" };
  if (freed) d.edges[1].props = { ...d.edges[1].props, caller: { wait: "non-blocking" } };
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
  await expect(page.getByTestId("call-pill-call")).toContainText("held");
  await page.getByTestId("node-caller").hover();
  await expect(page.getByTestId("thread-detail-caller")).toContainText("4 waiting on Partner scoring API");
  await expect(page.getByTestId("thread-ceiling")).toBeVisible();
  await expect(page.getByTestId("thread-ceiling")).toContainText("15.4 req/s = 4 threads ÷ 0.26 s");
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

test("connection Simulation offers the same undoable wait toggle as its inspector", async ({ page }) => {
  await seed(page);
  await gotoCanvas(page, "blocking-call");
  await waitForStableViewport(page);
  await page.getByTestId("edge-call").click({ button: "right" });
  await page.getByTestId("context-menu-item-edge.simulation").hover();
  await page.getByTestId("context-menu-item-edge.wait").click();
  await expect
    .poll(async () => (await savedDiagram(page)).edges[1].props?.caller)
    .toMatchObject({ wait: "non-blocking" });
  await page.getByTestId("undo-button").click();
  await expect.poll(async () => (await savedDiagram(page)).edges[1].props?.caller).toBeUndefined();
  await page.getByTestId("edge-call").dblclick();
  await page.getByTestId("inspector-section-edge-simulation").click();
  await expect(page.getByTestId("inspector-field-wait")).toContainText("Holds a thread");
  await page.getByTestId("inspector-field-wait").click();
  await page.getByTestId("context-menu-item-non-blocking").click();
  await expect(page.getByTestId("inspector-field-wait")).toContainText("Frees the thread");
  await expect
    .poll(async () => (await savedDiagram(page)).edges[1].props?.caller)
    .toMatchObject({ wait: "non-blocking" });
});

test("a freed call shows its in-flight meter, pill and continuation ceiling", async ({ page }) => {
  await seed(page, false, false, true);
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  await page.clock.runFor(1000);
  await page.getByTestId("live-play").click();
  await expect(page.getByTestId("thread-meter-caller")).toHaveAttribute("data-waiting", "0");
  await expect(page.getByTestId("thread-meter-caller")).toHaveAttribute(
    "aria-valuetext",
    /calls in flight, no thread held/,
  );
  await expect(page.getByTestId("thread-flight-caller")).toContainText("calls in flight, no thread held");
  await expect(page.getByTestId("call-pill-call")).toContainText("↗");
  await expect(page.getByTestId("call-pill-call")).toContainText("in flight");
  await page.getByTestId("node-caller").hover();
  await expect(page.getByTestId("thread-ceiling")).toContainText("200 req/s");
  await expect(page.getByTestId("thread-ceiling")).toContainText("10 ms work + 10 ms reply handling");
  await page.clock.runFor(200);
  await test.info().attach("freed threads", { body: await page.screenshot(), contentType: "image/png" });
});

test("the exhausted-thread callout frees its call in one undo step", async ({ page }) => {
  await seed(page);
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  await page.clock.runFor(11000);
  await page.getByTestId("live-play").click();
  await expect(page.getByTestId("trouble-headline")).toContainText("Decision service runs out of threads");
  await expect(page.getByTestId("trouble-action")).toHaveText("Free the thread while waiting");
  await page.getByTestId("trouble-action").click();
  await page.clock.runFor(400);
  await expect
    .poll(async () => (await savedDiagram(page)).edges[1].props?.caller)
    .toMatchObject({ wait: "non-blocking" });
  await page.getByTestId("undo-button").click();
  await page.clock.runFor(400);
  await expect.poll(async () => (await savedDiagram(page)).edges[1].props?.caller).toBeUndefined();
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

async function seedOverride(page: import("@playwright/test").Page) {
  const d = waitingFixture();
  d.edges[1].props = { ...d.edges[1].props, caller: { wait: "non-blocking", replyMs: 30 } };
  d.simulations = [
    {
      id: "override",
      title: "Override",
      scale: 1,
      durationMs: 60000,
      traffic: [{ id: "load", node: "source", shape: { kind: "constant", ratePerSec: 100, durationMs: 60000 } }],
      setup: {
        edges: { call: { caller: { wait: "blocking" } } },
        props: { source: { ratePerSec: 100 } },
      },
    },
  ];
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    d,
  });
}

test("the trouble fix updates the active waiting override and undo restores playback", async ({ page }) => {
  await seedOverride(page);
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1&sim=override");
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  await page.clock.runFor(11000);
  await page.getByTestId("live-play").click();
  // The callout offers Events until the off-thread same-seed rerun confirms the fix (single-flight verification).
  await expect(page.getByTestId("trouble-action")).toHaveAttribute("data-action", "free-thread");
  await page.getByTestId("trouble-action").click();
  await page.clock.runFor(400);
  await expect
    .poll(async () => (await savedDiagram(page)).simulations?.[0].setup?.edges?.call.caller?.wait)
    .toBe("non-blocking");
  expect((await savedDiagram(page)).edges[1].props?.caller).toEqual({ wait: "non-blocking", replyMs: 30 });
  await page.getByTestId("live-play").click();
  await page.clock.runFor(1000);
  await page.getByTestId("live-play").click();
  await expect(page.getByTestId("thread-meter-caller")).toHaveAttribute("data-waiting", "0");
  await page.getByTestId("undo-button").click();
  await page.clock.runFor(400);
  await expect
    .poll(async () => (await savedDiagram(page)).simulations?.[0].setup?.edges?.call.caller?.wait)
    .toBe("blocking");
  await page.getByTestId("live-play").click();
  await page.clock.runFor(1000);
  await expect
    .poll(async () => Number(await page.getByTestId("thread-meter-caller").getAttribute("data-waiting")))
    .toBeGreaterThan(0);
});

test("menu and inspector read and change the active caller override", async ({ page }) => {
  await seedOverride(page);
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1&sim=override");
  await waitForStableViewport(page);
  await page.getByTestId("edge-call").click({ button: "right" });
  await page.getByTestId("context-menu-item-edge.simulation").hover();
  await expect(page.getByTestId("context-menu-item-edge.wait")).toHaveText("Free the thread while waiting");
  await page.getByTestId("context-menu-item-edge.wait").click();
  await expect
    .poll(async () => (await savedDiagram(page)).simulations?.[0].setup?.edges?.call.caller?.wait)
    .toBe("non-blocking");
  await page.getByTestId("undo-button").click();
  await page.getByTestId("edge-call").dblclick();
  await page.getByTestId("inspector-section-edge-simulation").click();
  await expect(page.getByTestId("inspector-field-wait")).toContainText("Holds a thread");
  await page.getByTestId("inspector-field-wait").click();
  await page.getByTestId("context-menu-item-non-blocking").click();
  await expect
    .poll(async () => (await savedDiagram(page)).simulations?.[0].setup?.edges?.call.caller?.wait)
    .toBe("non-blocking");
});

test("typing a fractional connection pool always saves a valid integer", async ({ page }) => {
  await seed(page, false, false, true);
  await gotoCanvas(page, "blocking-call");
  await waitForStableViewport(page);
  await page.getByTestId("edge-call").dblclick();
  await page.getByTestId("inspector-section-edge-simulation").click();
  await page.getByTestId("inspector-field-poolConnections").fill("1.5");
  await expect
    .poll(async () => (await savedDiagram(page)).edges[1].props?.caller)
    .toMatchObject({ poolConnections: 2 });
  await page.reload();
  await expect
    .poll(async () => (await savedDiagram(page)).edges[1].props?.caller)
    .toMatchObject({ poolConnections: 2 });
});

for (const wait of ["blocking", "non-blocking"] as const) {
  test(`simultaneous call pills avoid each other and live readouts (${wait})`, async ({ page }) => {
    const d = waitingFixture();
    d.direction = "TB";
    d.nodes[0].props = { ...d.nodes[0].props, ratePerSec: 100 };
    d.nodes[1].x = d.nodes[2].x = 330;
    d.nodes[1].y = 0;
    d.nodes[2].y = 400;
    d.edges[1].label = "Score application";
    d.edges[1].props = { ...d.edges[1].props, caller: { wait } };
    d.edges.push({ ...d.edges[1], id: "second-call" });
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
    const pill = await page.getByTestId("call-pill-call").boundingBox();
    expect(pill).not.toBeNull();
    const boxes = await page.getByTestId("edge-label-call").boundingBox();
    expect(boxes).not.toBeNull();
    const overlap = (a: NonNullable<typeof pill>, b: NonNullable<typeof pill>) =>
      Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) &&
      Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
    if (!pill || !boxes) throw new Error("Missing call pill or label");
    expect(overlap(pill, boxes)).toBe(false);
    const second = await page.getByTestId("call-pill-second-call").boundingBox();
    if (!second) throw new Error("Missing simultaneous call pill");
    expect(overlap(pill, second)).toBe(false);
    const readout = await page
      .getByTestId(wait === "blocking" ? "thread-chip-caller" : "thread-flight-caller")
      .boundingBox();
    if (!readout) throw new Error("Missing live thread readout");
    expect(overlap(pill, readout)).toBe(false);
    expect(overlap(second, readout)).toBe(false);
    for (const id of ["caller", "partner"]) {
      const node = await page.getByTestId(`node-${id}`).boundingBox();
      if (!node) throw new Error(`Missing node ${id}`);
      expect(overlap(pill, node)).toBe(false);
    }
  });
}

test("unsupported gateway callers hide reply handling", async ({ page }) => {
  const d = waitingFixture();
  d.nodes[1].stencil = "nginx";
  d.edges[1].props = { ...d.edges[1].props, caller: { wait: "non-blocking" } };
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    d,
  });
  await gotoCanvas(page, "blocking-call");
  await waitForStableViewport(page);
  await page.getByTestId("edge-call").dblclick();
  await page.getByTestId("inspector-section-edge-simulation").click();
  await expect(page.getByTestId("inspector-field-poolConnections")).toBeVisible();
  await expect(page.getByTestId("inspector-field-replyMs")).toHaveCount(0);
});
