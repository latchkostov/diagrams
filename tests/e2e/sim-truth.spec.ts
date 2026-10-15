import { simReviewFixture, simReviewTrafficFixture } from "../../src/lab/simReviewFixture";
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  expectNoErrors,
  pageLoadTimeout,
  pauseClock,
  waitForStableViewport,
} from "./fixtures";
import { STORAGE_KEYS, gotoLab } from "./fixtures";

// The simulation tells the truth (docs/research/sim-flows-review.md, items 1–6): a consumer behind a broker drains
// at its reported capacity, new edges into a database are Requests, fields that can't change the run are hidden,
// the callout reports trouble on its own, and the inspector's limits are the file format's. Selectors are
// data-testid only; runs are seeded and the URL's `speed` plays them faster.

const SLUG = "kafka-order-pipeline";
const KEY = STORAGE_KEYS.autosavePrefix + SLUG;

test("changing live count digits keeps the callout's action in place", async ({ page, consoleErrors }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoLab(page, "trouble-callout-counts");
  const action = page.getByTestId("trouble-action");
  await expect(action).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => {}));
  const before = await action.boundingBox();
  expect(before).not.toBeNull();
  for (const count of ["888", "123", "999"]) {
    await page.getByTestId("lab-control-count").fill(count);
    await expect(page.getByTestId("trouble-detail")).toContainText(`(${count} so far)`);
    await expect.poll(() => action.boundingBox()).toEqual(before);
  }
  expectNoErrors(consoleErrors);
});

type Saved = {
  nodes: { id: string; stencil: string; label: string; props?: Record<string, unknown> }[];
  edges: { id: string; from: string; to: string; kind?: string; relation?: string; props?: Record<string, unknown> }[];
};

/** Opens the Kafka example's slot seeded with `diagram` (as if autosaved), on the canvas. */
async function seed(page: Page, diagram: object) {
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("seeded", "1");
      }
    },
    [KEY, JSON.stringify(diagram)] as const,
  );
  await gotoCanvas(page, SLUG);
  await waitForStableViewport(page);
}

const saved = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null") as Saved | null, KEY);
async function savedWhen(page: Page, check: (d: Saved) => boolean): Promise<Saved> {
  let last: Saved | null = null;
  await expect
    .poll(async () => {
      last = await saved(page);
      return !!last && check(last);
    })
    .toBe(true);
  if (!last) throw new Error("Expected the autosave");
  return last;
}

/** Opens the inspector's Simulation section (it remembers being open). */
async function openSimulation(page: Page) {
  const section = page.getByTestId("inspector-section-node-simulation");
  if ((await section.getAttribute("aria-expanded")) !== "true") await section.click();
  await expect(section).toHaveAttribute("aria-expanded", "true");
}

const processed = async (page: Page, nodeId: string) =>
  Number(await page.getByTestId(`node-badge-${nodeId}`).getAttribute("data-processed"));
const backlog = async (page: Page, nodeId: string) =>
  Number(await page.getByTestId(`node-badge-${nodeId}`).getAttribute("data-backlog"));

test.describe("the simulation tells the truth", () => {
  test("the GCP example's Pub/Sub topic keeps up at 13%: no lag under Healthy", async ({ page, consoleErrors }) => {
    await gotoLive(page, "./?view=canvas&example=gcp-streaming-analytics&live=1&speed=8");
    await page.keyboard.press("c");
    await expect(page.getByTestId("bottleneck-headline")).toHaveText("Healthy: every service has headroom");
    // 50 clicks a second: once Dataflow has handled 30 s of them, a backlog that grows would be well over 100.
    await expect.poll(() => processed(page, "dataflow"), { timeout: pageLoadTimeout() * 3 }).toBeGreaterThan(1500);
    expect(await backlog(page, "pubsub-topic")).toBeLessThanOrEqual(10);
    await expect(page.getByTestId("bottleneck-headline")).toHaveText("Healthy: every service has headroom");
    await expect(page.getByTestId("trouble-callout")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("a database quick-added after a service is connected by a Request", async ({ page, consoleErrors }) => {
    await seed(page, {
      format: "diagrams/v1",
      title: "Requests",
      nodes: [{ id: "api", stencil: "service.dotnet", label: "Orders API", x: 0, y: 0 }],
      edges: [],
    });
    await page.getByTestId("node-api").click();
    await page.keyboard.press("Alt+ArrowRight");
    await expect(page.getByTestId("quick-add")).toBeVisible();
    await page.keyboard.type("postgres");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("inspector-field-label")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("toast").filter({ hasText: "Request: the caller waits for a reply" })).toBeVisible();
    const d = await savedWhen(page, (s) => s.edges.length === 1);
    expect(d.nodes).toHaveLength(2);
    expect(d.edges[0]).toMatchObject({ from: "api", kind: "sync" });
    // The toast's way back: Make it a message.
    await page.getByTestId("toast-make-message").click();
    await savedWhen(page, (s) => s.edges[0]?.kind === "async");
    expectNoErrors(consoleErrors);
  });

  test("fields that can't change the run are hidden; a value already set says so", async ({ page, consoleErrors }) => {
    await seed(page, {
      format: "diagrams/v1",
      title: "Inert",
      nodes: [
        { id: "gw", stencil: "nginx", label: "NGINX", x: 0, y: 0, props: { concurrency: 8 } },
        { id: "api", stencil: "service.dotnet", label: "Orders API", x: 400, y: 0 },
        { id: "db", stencil: "postgres", label: "orders-db", x: 800, y: 0 },
        { id: "topic", stencil: "kafka.topic", label: "orders", x: 400, y: 300 },
        { id: "billing", stencil: "service.go", label: "Billing", x: 800, y: 300 },
      ],
      edges: [
        { id: "gw-api", from: "gw", to: "api", kind: "sync", label: "routes" },
        { id: "api-db", from: "api", to: "db", kind: "sync", label: "writes", props: { group: "x" } },
        { id: "topic-billing", from: "topic", to: "billing", kind: "async", label: "reads" },
      ],
    });
    // A gateway: Latency, no Concurrency; its saved 8 is said to do nothing, with Remove.
    await page.getByTestId("node-gw").click();
    await openSimulation(page);
    await expect(page.getByTestId("inspector-field-latencyMs")).toBeVisible();
    await expect(page.getByTestId("inspector-field-concurrency")).toHaveCount(0);
    await expect(page.getByTestId("inspector-inert-concurrency")).toContainText("Concurrency 8 is kept in the file");
    await page.getByTestId("inspector-inert-concurrency-remove").click();
    await expect(page.getByTestId("inspector-inert-concurrency")).toHaveCount(0);
    await expect(page.getByTestId("inspector-section-node-simulation")).toBeFocused();
    await savedWhen(page, (s) => s.nodes.find((n) => n.id === "gw")?.props?.concurrency === undefined);
    // A service → database edge: no Consumer group, no Dead-letter path; its stray group is noted.
    await page.getByTestId("edge-label-api-db").click();
    await expect(page.getByTestId("inspector-title")).toHaveText("Edge");
    await expect(page.getByTestId("inspector-field-group")).toHaveCount(0);
    await expect(page.getByTestId("inspector-field-dlq")).toHaveCount(0);
    await expect(page.getByTestId("inspector-inert-group")).toBeVisible();
    await page.getByTestId("inspector-inert-group-remove").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("inspector-inert-group")).toHaveCount(0);
    await expect(page.getByTestId("inspector-field-label")).toBeFocused();
    // Out of a topic both are there.
    await page.getByTestId("edge-label-topic-billing").click();
    await expect(page.getByTestId("inspector-field-group")).toBeVisible();
    await expect(page.getByTestId("inspector-field-dlq")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("the callout comes on its own when a consumer behind a topic goes down, and Revive works", async ({
    page,
    consoleErrors,
  }) => {
    await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1&speed=4`);
    // The heat map is off: no callout yet.
    await expect(page.getByTestId("bottleneck-callout")).toHaveCount(0);
    await expect(page.getByTestId("trouble-callout")).toHaveCount(0);
    await expect(page.getByTestId("trouble-announce")).toBeEmpty();
    await page.evaluate(() => {
      const region = document.querySelector('[data-testid="trouble-announce"]');
      if (!region) throw new Error("The empty live region must already be mounted");
      (window as unknown as { troubleRegion: Element }).troubleRegion = region;
    });
    await expect(async () => {
      await page.getByTestId("node-payments").click({ button: "right" });
      await page.getByTestId("context-menu-item-sim.kill").click({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await expect(page.getByTestId("node-badge-payments")).toHaveAttribute("data-status", "down");
    const callout = page.getByTestId("trouble-callout");
    await expect(callout).toHaveAttribute("data-kind", "down");
    await expect(page.getByTestId("trouble-headline")).toHaveText("Payments service is down");
    await expect(page.getByTestId("trouble-announce")).toHaveText("Payments service is down");
    expect(
      await page.evaluate(
        () =>
          document.querySelector('[data-testid="trouble-announce"]') ===
          (window as unknown as { troubleRegion: Element }).troubleRegion,
      ),
    ).toBe(true);
    // Its messages wait in the topic: they don't fail.
    await expect(page.getByTestId("trouble-detail")).toContainText(
      "Messages wait in orders.created.v1 until it's back",
    );
    await expect(page.getByTestId("trouble-action")).toHaveText(/Revive/);
    await page.getByTestId("trouble-action").click();
    await expect(page.getByTestId("node-badge-payments")).toHaveAttribute("data-status", "up");
    await expect(callout).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("50,000 msg/s is the same everywhere: typed, saved and opened; past the limit, said", async ({
    page,
    consoleErrors,
  }) => {
    await seed(page, {
      format: "diagrams/v1",
      title: "Limits",
      nodes: [{ id: "iot", stencil: "client.iot", label: "IoT devices", x: 0, y: 0 }],
      edges: [],
    });
    await page.getByTestId("node-iot").click();
    await openSimulation(page);
    const rate = page.getByTestId("inspector-field-ratePerSec");
    await rate.fill("50000");
    await expect(page.getByTestId("inspector-limit-ratePerSec")).toHaveCount(0);
    await savedWhen(page, (s) => s.nodes[0]?.props?.ratePerSec === 50_000);
    // Opened again, the file is fine.
    await page.reload();
    await page.getByTestId("node-iot").click();
    await openSimulation(page);
    await expect(page.getByTestId("inspector-field-ratePerSec")).toHaveValue("50000");
    // Past the file's limit: saved at the limit, and the field says so.
    await page.getByTestId("inspector-field-ratePerSec").fill("20000000");
    await expect(page.getByTestId("inspector-limit-ratePerSec")).toHaveText(
      "Up to 10,000,000 msg/s: saved as 10,000,000.",
    );
    await savedWhen(page, (s) => s.nodes[0]?.props?.ratePerSec === 10_000_000);
    expectNoErrors(consoleErrors);
  });

  test("a pasted file past the limit names the field and the limit", async ({ page }) => {
    await page.goto("./");
    await page.getByTestId("start-paste").click();
    await page.getByTestId("paste-input").fill(
      JSON.stringify({
        format: "diagrams/v1",
        title: "Too much",
        nodes: [{ id: "iot", stencil: "client.iot", label: "IoT", x: 0, y: 0, props: { ratePerSec: 20_000_000 } }],
        edges: [],
      }),
    );
    await page.getByTestId("paste-submit").click();
    await expect(
      page.getByTestId("toast").filter({ hasText: "ratePerSec 20,000,000 is over the 10,000,000 limit" }),
    ).toBeVisible();
  });
});

test.describe("the trouble callout stays out of views nobody edits, heat map or not", () => {
  const OUTAGE = `./?view=canvas&example=${SLUG}&live=1&sim=payments-outage&paused=1`;

  test("editing shows it with the heat map on; presenting shows only the plan's callout", async ({ page }) => {
    await gotoLive(page, OUTAGE);
    await page.keyboard.press("c");
    await page.getByTestId("live-marker-2").click();
    await expect(page.getByTestId("trouble-callout")).toHaveAttribute("data-kind", "down");
    // The cause is announced once, without the counts that change every second.
    await expect(page.getByTestId("trouble-announce")).toHaveText("Payments service is down");
    await expect(page.getByTestId("trouble-announce")).toHaveAttribute("role", "status");
    await expect(page.getByTestId("trouble-callout")).not.toHaveAttribute("role", "status");
    await page.getByTestId("present-toggle").click();
    await expect(page.getByTestId("present-exit")).toBeVisible();
    await expect(page.getByTestId("bottleneck-headline")).toHaveText("Payments service is down");
    await expect(page.getByTestId("trouble-callout")).toHaveCount(0);
  });

  test("an embed with the heat map on never shows it", async ({ page }) => {
    await page.goto(`./?embed=1&example=${SLUG}&live=1&sim=payments-outage&paused=1`);
    await expect(page.getByTestId("live-controls")).toBeVisible({ timeout: pageLoadTimeout() });
    await page.keyboard.press("c");
    await page.getByTestId("live-marker-2").click();
    await expect(page.getByTestId("bottleneck-headline")).toHaveText("Payments service is down");
    await expect(page.getByTestId("trouble-callout")).toHaveCount(0);
  });

  test("the Lab's live stage with a down node never shows it", async ({ page }) => {
    await gotoLab(page, "live-badge-states");
    await expect(page.getByTestId("live-controls")).toBeVisible({ timeout: pageLoadTimeout() });
    await page.keyboard.press("c");
    await expect(page.getByTestId("bottleneck-callout")).toBeVisible();
    await expect(page.getByTestId("trouble-callout")).toHaveCount(0);
  });

  test("paused, Revive in the callout clears it at once; Dismiss returns focus to the canvas", async ({ page }) => {
    await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1&speed=4`);
    await expect(async () => {
      await page.getByTestId("node-payments").click({ button: "right" });
      await page.getByTestId("context-menu-item-sim.kill").click({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await expect(page.getByTestId("trouble-callout")).toBeVisible();
    await page.getByTestId("live-play").click();
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
    // Paused: time stands still, and the callout still follows the status.
    await page.getByTestId("trouble-action").click();
    await expect(page.getByTestId("node-badge-payments")).toHaveAttribute("data-status", "up");
    await expect(page.getByTestId("trouble-callout")).toHaveCount(0);
    // Killed again while paused: a new run of the same cause isn't shown twice, so restart the run first.
    await page.getByTestId("live-restart").click();
    await expect(async () => {
      await page.getByTestId("node-payments").click({ button: "right" });
      await page.getByTestId("context-menu-item-sim.kill").click({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await expect(page.getByTestId("trouble-callout")).toBeVisible();
    await page.getByTestId("trouble-dismiss").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("trouble-callout")).toHaveCount(0);
    await expect(page.getByTestId("canvas-wrap")).toBeFocused();
  });
});

test("on a narrow canvas (1024, AI panel open) the callout keeps its words and buttons in view", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1&speed=4`);
  await page.getByTestId("ai-rail-open").click();
  await expect(page.getByTestId("ai-panel")).toBeVisible();
  await expect(async () => {
    await page.getByTestId("node-payments").click({ button: "right" });
    await page.getByTestId("context-menu-item-sim.kill").click({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  const callout = page.getByTestId("trouble-callout");
  await expect(callout).toBeVisible();
  // Too little room beside the title card: it sits below it, the canvas's width.
  await expect(callout).toHaveAttribute("data-below", "");
  const box = async (id: string) => {
    const b = await page.getByTestId(id).boundingBox();
    if (!b) throw new Error(`Expected ${id} on screen`);
    return b;
  };
  const wrap = await box("canvas-wrap");
  const headline = await box("trouble-headline");
  for (const id of ["trouble-action", "trouble-dismiss"]) {
    const b = await box(id);
    expect(b.x).toBeGreaterThanOrEqual(wrap.x);
    expect(b.x + b.width).toBeLessThanOrEqual(wrap.x + wrap.width);
    // Never over the words.
    expect(b.x >= headline.x + headline.width || b.y >= headline.y + headline.height).toBe(true);
  }
  const card = await box("diagram-card");
  expect((await box("trouble-callout")).y).toBeGreaterThanOrEqual(card.y + card.height);
});

test("at 1440 with the AI panel open, the callout occupies the room beside the title card", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1&sim=payments-outage&paused=1`);
  await page.getByTestId("ai-rail-open").click();
  await expect(page.getByTestId("ai-panel")).toBeVisible();
  await page.getByTestId("live-marker-2").click();
  const callout = page.getByTestId("trouble-callout");
  await expect(callout).toBeVisible();
  const clearOfTitle = async (id: string) => {
    const card = await page.getByTestId("diagram-card").boundingBox();
    const box = await page.getByTestId(id).boundingBox();
    const canvas = await page.getByTestId("canvas-wrap").boundingBox();
    if (!card || !box || !canvas) throw new Error("Expected the canvas, card and callout");
    expect(box.x >= card.x + card.width || box.y >= card.y + card.height).toBe(true);
    expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width);
    const toggle = await page.getByTestId("live-toggle").boundingBox();
    if (!toggle) throw new Error("Expected the Live toggle");
    expect(box.x + box.width <= toggle.x || box.y >= toggle.y + toggle.height || box.y + box.height <= toggle.y).toBe(
      true,
    );
  };
  await expect(() => clearOfTitle("trouble-callout")).toPass();
  await page.getByTestId("trouble-dismiss").click();
  await page.keyboard.press("c");
  await expect(page.getByTestId("bottleneck-callout")).toBeVisible();
  await expect(() => clearOfTitle("bottleneck-callout")).toPass();
});

test("a saved-down node on first live mount announces through a change to the mounted region", async ({ page }) => {
  await seed(page, {
    format: "diagrams/v1",
    title: "Outage",
    nodes: [{ id: "worker", stencil: "service.go", label: "Worker", x: 0, y: 0, props: { status: "down" } }],
    edges: [],
  });
  await page.evaluate(() => {
    const observed = window as unknown as { announcementChanged: boolean };
    observed.announcementChanged = false;
    const observer = new MutationObserver((records) => {
      if (
        records.some((r) => r.target instanceof Element && r.target.getAttribute("data-testid") === "trouble-announce")
      ) {
        observed.announcementChanged = true;
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  });
  await page.getByTestId("live-toggle").click();
  await expect(page.getByTestId("trouble-announce")).toHaveText("Worker is down");
  expect(await page.evaluate(() => (window as unknown as { announcementChanged: boolean }).announcementChanged)).toBe(
    true,
  );
});

test("an outage hidden behind Inputs does not consume the callout's turn", async ({ page }) => {
  await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1&sim=payments-outage&paused=1`);
  await page.getByTestId("live-capacity").click();
  await expect(page.getByTestId("capacity-panel")).toBeVisible();
  await page.getByTestId("live-marker-2").click();
  await expect(page.getByTestId("node-badge-payments")).toHaveAttribute("data-status", "down");
  await expect(page.getByTestId("trouble-callout")).toHaveCount(0);
  // The recovery note is the visible marker at this timestamp; seeking there also applies its preceding status.
  await page.getByTestId("live-marker-4").click();
  await expect(page.getByTestId("node-badge-payments")).toHaveAttribute("data-status", "up");
  await page.getByTestId("capacity-close").click();
  await expect(page.getByTestId("capacity-panel")).toHaveCount(0);
  await page.getByTestId("node-payments").click({ button: "right" });
  await page.getByTestId("context-menu-item-sim.kill").click();
  await expect(page.getByTestId("trouble-headline")).toHaveText("Payments service is down");
});

async function injectTen(page: Page, node: string) {
  await expect(async () => {
    await page.getByTestId(`node-${node}`).click({ button: "right" });
    await page.getByTestId("context-menu-item-sim.inject").click({ timeout: 1000 });
    await page.getByTestId("context-menu-item-sim.inject:10").click({ timeout: 1000 });
  }).toPass();
}

test("loss callout adds a broker DLQ in one undo step and exhausted messages reach it", async ({
  page,
  consoleErrors,
}) => {
  const original = simReviewFixture();
  await seed(page, original);
  await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1&traffic=0&speed=4`);
  await injectTen(page, "q");
  await expect(page.getByTestId("trouble-action")).toHaveAttribute("data-action", "add-dlq");
  await page.getByTestId("trouble-action").click();
  const d = await savedWhen(page, (s) => s.nodes.length === original.nodes.length + 1);
  const route = d.edges.find((e) => e.props?.dlq === true);
  expect(route).toMatchObject({ from: "q", kind: "async", props: { dlq: true } });
  if (!route) throw new Error("Expected the broker's dead-letter route");
  expect(d.nodes.find((n) => n.id === route.to)?.stencil).toBe("aws.sqs");
  await waitForStableViewport(page);
  await injectTen(page, "q");
  await expect(page.getByTestId(`node-badge-${route.to}`)).toHaveAttribute("data-processed", "10");
  await page.keyboard.press("ControlOrMeta+z");
  const undone = await savedWhen(page, (s) => s.nodes.length === original.nodes.length);
  expect(undone.edges).toEqual(original.edges);
  expect(undone.nodes).toEqual(original.nodes);
  expectNoErrors(consoleErrors);
});

test("Show events from a loss callout stays available while slow motion freezes live", async ({
  page,
  consoleErrors,
}) => {
  await seed(page, simReviewFixture(true));
  await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1&speed=4`);
  await expect(page.getByTestId("trouble-action")).toHaveAttribute("data-action", "events");
  await expect(async () => {
    await page.getByTestId("node-web").click({ button: "right" });
    await page.getByTestId("context-menu-item-sim.slowmo-from").click({ timeout: 1000 });
  }).toPass();
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "slowmo");
  await expect(page.getByTestId("trouble-action")).toBeEnabled();
  await page.getByTestId("trouble-action").click();
  await expect(page.getByTestId("live-events")).toBeVisible();
  await expect(page.getByTestId("live-events-filter")).toHaveValue("q");
  await expect(page.getByTestId("live-events-list")).toContainText("delivery limit");
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "slowmo");
  expectNoErrors(consoleErrors);
});

test("ten-million-message source rates remain valid but an unsafe saved scale disables Continuous traffic", async ({
  page,
  consoleErrors,
}) => {
  await seed(page, simReviewTrafficFixture());
  await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1&sim=budget&paused=1`);
  await page.getByTestId("live-more").click();
  await expect(page.getByTestId("live-traffic")).toBeDisabled();
  await expect(page.getByTestId("live-traffic")).toHaveAttribute("title", /Inputs.*Messages per dot/);
  const d = await saved(page);
  expect(d?.nodes.find((n) => n.id === "web")?.props?.ratePerSec).toBe(10_000_000);
  expectNoErrors(consoleErrors);
});

test("the continuous source volume budget announces its stop and Restart clears it", async ({
  page,
  consoleErrors,
}) => {
  // Explicit CPU stress stretches wall time, while the simulation still uses the page clock.
  test.slow(!!process.env.SIM_TRUTH_CPU);
  await page.clock.install();
  await seed(page, simReviewTrafficFixture(10_000));
  await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1&sim=budget&paused=1&speed=8`);
  await pauseClock(page);
  if (process.env.SIM_TRUTH_CPU) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.SIM_TRUTH_CPU) });
  }
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-traffic").click();
  await page.getByTestId("live-play").click();
  // The frame and UI publication clocks need not line up with the source's 200,000th sample.
  // Step until the published count reaches the stop, leaving the clock paused for the notice:
  // each step is shorter than its lifetime, so the step that shows it cannot dismiss it too.
  await expect
    .poll(
      async () => {
        await page.clock.runFor(250);
        return processed(page, "web");
      },
      { intervals: [0], timeout: test.info().timeout },
    )
    .toBe(200_000);
  await expect(page.getByTestId("live-notice")).toContainText("200,000 sampled-message budget");
  await expect(page.getByTestId("node-badge-web")).toHaveAttribute("data-processed", "200000");
  await page.getByTestId("live-more").click();
  await expect(page.getByTestId("live-traffic")).toBeDisabled();
  await expect(page.getByTestId("live-traffic")).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-restart").click();
  await page.getByTestId("live-more").click();
  await expect(page.getByTestId("live-traffic")).toBeEnabled();
  expectNoErrors(consoleErrors);
});
