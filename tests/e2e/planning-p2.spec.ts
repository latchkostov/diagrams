import { savedDiagram } from "./fixtures";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { watchedPage } from "./html-viewer";
import type { Page } from "@playwright/test";
import { planningP2Fixture } from "../../src/lab/planningP2Fixture";
import { upgradePlanning } from "../../src/planning/migration";
import type { DiagramFile } from "../../src/model/types";
import { readFileSync } from "node:fs";
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  pauseClock,
  waitForStableViewport,
  expectNoErrors,
  STORAGE_KEYS,
} from "./fixtures";

const slug = "kafka-order-pipeline";
async function seed(page: Page, stencil: string, live = false, locale = "en", diagram?: DiagramFile) {
  await page.addInitScript(
    ({ key, d, locale }) => {
      localStorage.setItem(key, JSON.stringify(d));
      localStorage.setItem("diagrams.locale", locale);
      localStorage.setItem("diagrams.inspector.open.v1", JSON.stringify({ "node-simulation": true }));
    },
    { key: STORAGE_KEYS.autosavePrefix + slug, d: diagram ?? planningP2Fixture(stencil), locale },
  );
  if (live) await gotoLive(page, `./?view=canvas&example=${slug}&live=1`);
  else await gotoCanvas(page, slug);
  await waitForStableViewport(page);
}

function materializedP1() {
  const legacy = planningP2Fixture();
  delete legacy.planning;
  legacy.format = "diagrams/v1";
  const d = upgradePlanning(legacy);
  d.planning = { revision: "p1" };
  return d;
}
async function modelPreview(page: Page, clock = false) {
  await page.keyboard.press("Control+k");
  await page.keyboard.type("diagram properties");
  await page.keyboard.press("Enter");
  if (clock) await page.clock.runFor(1000);
  await page.getByTestId("planning-preview").click();
}

test("P2: P1 legacy download stays accessible without applying the upgrade", async ({ page, consoleErrors }) => {
  await seed(page, "aws.sns", false, "en", materializedP1());
  await modelPreview(page);
  await expect(page.getByTestId("planning-upgrade")).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.getByTestId("planning-legacy-download").click();
  const download = await pending;
  const path = await download.path();
  if (!path) throw new Error("Missing legacy download");
  const legacy = JSON.parse(readFileSync(path, "utf8")) as DiagramFile;
  expect(legacy.format).toBe("diagrams/v1");
  expect(legacy.planning).toBeUndefined();
  const saved = await savedDiagram(page);
  expect(saved.planning?.revision).toBe("p1");
  expectNoErrors(consoleErrors);
});

test("P2: a revision-only upgrade and Undo refresh an already open capacity overlay", async ({
  page,
  consoleErrors,
}) => {
  const p1 = materializedP1();
  expect(upgradePlanning(p1).nodes).toEqual(p1.nodes);
  await seed(page, "aws.sns", false, "en", p1);
  await page.getByTestId("node-worker").click();
  await page.keyboard.press("c");
  await expect(page.getByTestId("capacity-label-worker")).toContainText("12/s");
  await modelPreview(page);
  await page.getByTestId("planning-upgrade").click();
  await expect(page.getByTestId("capacity-label-worker")).toContainText("32/s");
  await page.getByTestId("undo-button").click();
  await expect(page.getByTestId("capacity-label-worker")).toContainText("12/s");
  expectNoErrors(consoleErrors);
});

test("P2: a revision-only upgrade refreshes an existing live run", async ({ page, consoleErrors }) => {
  await page.clock.install();
  await seed(page, "aws.sns", true, "en", materializedP1());
  await page.getByTestId("live-capacity").click();
  await page.getByTestId("scale-override").selectOption("1");
  await pauseClock(page);
  await page.clock.runFor(10_000);
  await expect(page.getByTestId("node-badge-worker")).toHaveAttribute("data-inflight", "12");
  await modelPreview(page, true);
  await page.getByTestId("planning-upgrade").click();
  await page.clock.runFor(10_000);
  await expect(page.getByTestId("node-badge-worker")).toHaveAttribute("data-inflight", "32");
  expectNoErrors(consoleErrors);
});

for (const [stencil, label] of [
  ["kafka.topic", "Partitions"],
  ["azure.event-hubs", "Partitions"],
  ["aws.kinesis", "Shards"],
]) {
  test(`P2: ${stencil} shows its assignment vocabulary and named group`, async ({ page, consoleErrors }, info) => {
    await seed(page, stencil);
    await page.getByTestId("node-broker").click();
    await page.keyboard.press("Shift+Digit1");
    await waitForStableViewport(page);
    const field = page.getByTestId("inspector-field-partitions");
    await expect(field).toBeVisible();
    await expect(page.getByTestId("inspector")).toContainText(label);
    await page.getByTestId("node-worker").click();
    await expect(page.getByTestId("broker-assignment")).toContainText("3 / 8");
    await expect(page.getByTestId("broker-assignment")).toContainText(label);
    await expect(page.getByTestId("planning-connection-read")).toContainText("Group: billing");
    await info.attach(`${stencil}-inspector.png`, {
      body: await page.screenshot({ path: info.outputPath(`${stencil}-inspector.png`) }),
      contentType: "image/png",
    });
    expectNoErrors(consoleErrors);
  });
}

for (const [stencil, label] of [
  ["aws.sns", "Subscription"],
  ["aws.eventbridge", "Subscription"],
  ["azure.service-bus.topic", "Subscription"],
  ["gcp.pubsub", "Subscription"],
  ["rabbitmq.exchange", "Binding"],
]) {
  test(`P2: ${stencil} never exposes partitions or a partition fix`, async ({ page, consoleErrors }, info) => {
    await seed(page, stencil);
    await page.getByTestId("node-broker").click();
    await page.keyboard.press("Shift+Digit1");
    await waitForStableViewport(page);
    await expect(page.getByTestId("inspector-field-partitions")).toHaveCount(0);
    await expect(page.getByTestId("inspector")).not.toContainText(/partitions/i);
    await expect(page.getByTestId("broker-fanout")).toContainText(`${label}s`);
    await page.getByTestId("edge-label-recovery").click();
    await expect(page.getByTestId("inspector-field-group")).toHaveCount(0);
    await page.getByTestId("edge-label-read").click();
    await expect(page.getByTestId("inspector")).toContainText(label);
    await page.getByTestId("node-worker").click();
    await expect(page.getByTestId("planning-arithmetic")).toContainText("8 replicas × 4 slots");
    await expect(page.getByTestId("planning-connection-read")).toContainText(`${label}: billing`);
    await expect(page.getByTestId("inspector")).not.toContainText(/partitions/i);
    await expect(page.getByTestId("planning-connection-recovery")).toHaveCount(0);
    await info.attach(`${stencil}-inspector.png`, {
      body: await page.screenshot({ path: info.outputPath(`${stencil}-inspector.png`) }),
      contentType: "image/png",
    });
    expectNoErrors(consoleErrors);
  });
}

test("P2: SNS live slots and capacity inputs agree without partition controls", async ({
  page,
  consoleErrors,
}, info) => {
  await page.clock.install();
  await seed(page, "aws.sns", true);
  await page.getByTestId("live-capacity").click();
  await expect(page.getByTestId("capacity-panel")).toBeVisible();
  await page.getByTestId("scale-override").selectOption("1");
  await pauseClock(page);
  await page.clock.runFor(10_000);
  await expect(page.getByTestId("node-badge-worker")).toHaveAttribute("data-inflight", "32");
  await expect(page.getByTestId("capacity-preset-double-partitions")).toHaveCount(0);
  await expect(page.getByTestId("capacity-partitions-broker")).toHaveCount(0);
  await expect(page.getByTestId("capacity-fanout-broker")).toContainText("Subscriptions");
  await expect(page.getByTestId("bottleneck-fix")).not.toContainText(/partitions/i);
  await info.attach("sns-live.png", {
    body: await page.screenshot({ path: info.outputPath("sns-live.png") }),
    contentType: "image/png",
  });
  expectNoErrors(consoleErrors);
});

test("P2: Kafka cluster is infrastructure and has no partition control", async ({ page, consoleErrors }) => {
  await seed(page, "kafka.topic");
  await page.getByTestId("node-cluster").click();
  await expect(page.getByTestId("broker-wrapper")).toContainText("Infrastructure");
  await expect(page.getByTestId("inspector-field-partitions")).toHaveCount(0);
  expectNoErrors(consoleErrors);
});

test("P2: free-play Capacity changes the assignment count and its broker label together", async ({
  page,
  consoleErrors,
}, info) => {
  const d = planningP2Fixture("kafka.topic");
  d.nodes[1].props = { ...d.nodes[1].props, partitions: 6 };
  d.nodes[2].props = { ...d.nodes[2].props, replicas: 2 };
  d.nodes.push({ ...d.nodes[1], id: "shards", stencil: "aws.kinesis", y: 440, props: { partitions: 7 } });
  d.edges.push(
    { id: "shard-publish", from: "source", to: "shards", props: { travelMs: 0 } },
    { id: "shard-read", from: "shards", to: "worker", props: { group: "billing", travelMs: 0 } },
  );
  await page.clock.install();
  await seed(page, "kafka.topic", true, "en", d);
  await page.getByTestId("live-capacity").click();
  await page.getByTestId("capacity-capacity-mult").fill("12"); // Capacity ×4: eight configured instances.
  await expect(page.getByTestId("capacity-capacity-mult-value")).toHaveText("4×");
  await pauseClock(page);
  await page.clock.runFor(5_000);
  const idle = page.getByTestId("node-badge-worker").getByTestId("capacity-idle-worker");
  await expect(idle).toHaveAttribute("data-idle", "1");
  await expect(idle).toContainText("Shards · Assigned instances: 7 / 8");
  await page.getByTestId("node-worker").hover();
  await expect(page.getByTestId("node-detail-idle-worker")).toHaveText("Assigned instances: 7 / 8 · Shards");
  await info.attach("mixed-assignment.png", {
    body: await page.screenshot({ path: info.outputPath("mixed-assignment.png"), animations: "disabled" }),
    contentType: "image/png",
  });
  expectNoErrors(consoleErrors);
});

test("P2: cached unread subscription rationale follows the language after worker checks", async ({
  page,
  consoleErrors,
}, info) => {
  const d = planningP2Fixture();
  d.edges = d.edges.filter((edge) => edge.from !== "broker");
  await seed(page, "aws.sns", false, "de", d);
  await page.getByTestId("checks-count").click();
  const row = page.getByTestId("check-row-no-reader:broker");
  await expect(row).toContainText("Keine Leser. Einen Leser hinzufügen.");
  const why = page.getByTestId("check-why-no-reader:broker");
  await why.click({ position: { x: 12, y: 8 } });
  await expect(why).toHaveAttribute("open", "");
  await info.attach("unread-subscription-de.png", {
    body: await page.screenshot({ path: info.outputPath("unread-subscription-de.png") }),
    contentType: "image/png",
  });
  await page.getByTestId("view-button").click();
  await page.getByTestId("view-language").click();
  await page.getByTestId("language-option-en").click();
  await expect(page.getByTestId("language-option-en")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(row).toContainText("No readers. Add a reader.");
  expectNoErrors(consoleErrors);
});

for (const [locale, label] of [
  ["ar", "اشتراك"],
  ["en-XA", "Šûƀšçŕîþţîöñ"],
]) {
  test(`P2: ${locale} subscription text fits the inspector`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seed(page, "aws.sns", false, locale);
    await page.getByTestId("edge-label-read").click();
    await expect(page.getByTestId("inspector-field-group")).toBeVisible();
    if (locale === "ar") await expect(page.getByTestId("inspector")).toContainText(label);
    await expect(page.getByTestId("inspector-field-partitions")).toHaveCount(0);
    const dimensions = await page
      .getByTestId("inspector")
      .evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
    await info.attach(`sns-${locale}.png`, {
      body: await page.screenshot({ path: info.outputPath(`sns-${locale}.png`) }),
      contentType: "image/png",
    });
  });
}

test("P2: released agent viewer preserves distinct broker assignments offline", async ({ context }, info) => {
  const d = planningP2Fixture();
  d.nodes.push(
    { ...d.nodes[1], id: "log", stencil: "kafka.topic", x: 320, y: 500 },
    { ...d.nodes[2], id: "log-reader", y: 500 },
  );
  d.edges.push(
    { id: "log-in", from: "source", to: "log" },
    { id: "log-read", from: "log", to: "log-reader", props: { group: "billing" } },
  );
  d.simulations = [
    {
      id: "compare",
      title: "Compare",
      scale: 1,
      traffic: [{ id: "t", node: "source", shape: { kind: "constant", ratePerSec: 64, durationMs: 60_000 } }],
    },
  ];
  const file = info.outputPath("compare.diagram.json"),
    html = info.outputPath("compare.html");
  writeFileSync(file, JSON.stringify(d));
  const output = spawnSync(
    process.execPath,
    [join(process.cwd(), "skills/livediagrams/scripts/export-html.mjs"), file, "--out", html],
    { encoding: "utf8" },
  );
  expect(output.status, output.stderr).toBe(0);
  const viewer = await watchedPage(context);
  const url = pathToFileURL(html).href;
  await viewer.page.clock.install();
  await viewer.page.goto(url);
  await expect(viewer.page.getByTestId("live-controls")).toBeVisible();
  await pauseClock(viewer.page);
  await viewer.page.clock.runFor(10_000);
  await expect(viewer.page.getByTestId("node-badge-worker")).toHaveAttribute("data-inflight", "32");
  await expect(viewer.page.getByTestId("node-badge-log-reader")).toHaveAttribute("data-inflight", "12");
  expect(viewer.requests.filter((r) => !r.startsWith("data:"))).toEqual([url]);
  expect(viewer.errors).toEqual([]);
  await viewer.page.close();
});

test("P2: paused shard notes and preset tooltips follow a language switch", async ({ page, consoleErrors }) => {
  await page.clock.install();
  await seed(page, "aws.kinesis", true);
  await page.getByTestId("live-capacity").click();
  await page.getByTestId("capacity-partitions-broker").fill("32");
  await page.getByTestId("capacity-partitions-broker").blur();
  const note = page.getByTestId("capacity-partitions-note-broker");
  await expect(note).toHaveText("All configured reader instances already have an assignment.");
  await expect(page.getByTestId("capacity-preset-double-partitions")).toHaveAttribute("title", "2 × Shards");
  await pauseClock(page);
  await page.getByTestId("view-button").click();
  await page.getByTestId("view-language").click();
  await page.getByTestId("language-option-de").click();
  await expect(page.getByTestId("language-option-de")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(note).toHaveText("Alle konfigurierten Leserinstanzen haben bereits eine Zuweisung.");
  expectNoErrors(consoleErrors);
});

test("P2: observed subscriptions exclude an explicit DLQ with the same name", async ({ page, consoleErrors }) => {
  await page.clock.install();
  await seed(page, "aws.sns", true);
  await pauseClock(page);
  await page.clock.runFor(5_000);
  await page.getByTestId("node-broker").click();
  await page.keyboard.press("F2");
  await page.getByTestId("planning-live-details-toggle").click();
  const row = page.getByTestId("planning-live-lag-billing");
  await expect(row).toContainText("Subscription billing (Readers)");
  await expect(row).not.toContainText("Recovery");
  expectNoErrors(consoleErrors);
});
