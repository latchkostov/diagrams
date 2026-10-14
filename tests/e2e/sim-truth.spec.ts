import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, gotoLive, expectNoErrors, pageLoadTimeout, waitForStableViewport } from "./fixtures";
import { STORAGE_KEYS } from "./fixtures";

// The simulation tells the truth (docs/research/sim-flows-review.md, items 1–6): a consumer behind a broker drains
// at its reported capacity, new edges into a database are Requests, fields that can't change the run are hidden,
// the callout reports trouble on its own, and the inspector's limits are the file format's. Selectors are
// data-testid only; runs are seeded and the URL's `speed` plays them faster.

const SLUG = "kafka-order-pipeline";
const KEY = STORAGE_KEYS.autosavePrefix + SLUG;

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
    await expect(page.getByTestId("node-editor-label")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("toast").filter({ hasText: "Request: the caller waits for a reply" })).toBeVisible();
    const d = await savedWhen(page, (s) => s.edges.length === 1);
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
    await savedWhen(page, (s) => s.nodes.find((n) => n.id === "gw")?.props?.concurrency === undefined);
    // A service → database edge: no Consumer group, no Dead-letter path; its stray group is noted.
    await page.getByTestId("edge-label-api-db").click();
    await expect(page.getByTestId("inspector-title")).toHaveText("Edge");
    await expect(page.getByTestId("inspector-field-group")).toHaveCount(0);
    await expect(page.getByTestId("inspector-field-dlq")).toHaveCount(0);
    await expect(page.getByTestId("inspector-inert-group")).toBeVisible();
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
    await expect(async () => {
      await page.getByTestId("node-payments").click({ button: "right" });
      await page.getByTestId("context-menu-item-sim.kill").click({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await expect(page.getByTestId("node-badge-payments")).toHaveAttribute("data-status", "down");
    const callout = page.getByTestId("trouble-callout");
    await expect(callout).toHaveAttribute("data-kind", "down");
    await expect(page.getByTestId("trouble-headline")).toHaveText("Payments service is down");
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
