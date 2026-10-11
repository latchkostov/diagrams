import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import type { Page } from "@playwright/test";
import { test, expect, expectNoErrors, publicExamples } from "./fixtures";

const kafka = publicExamples.find((e) => e.slug === "kafka-order-pipeline");
const other = publicExamples.find((e) => e.slug === "rag-assistant");
if (!kafka || !other) throw new Error("Missing public examples");
const kafkaChunk = /\/(?:assets\/kafka-order-pipeline-[^/]+\.js|src\/examples\/kafka-order-pipeline\.json)(?:\?.*)?$/;

/** An example's download: its production chunk, or its JSON on the dev server. */
const exampleChunk = (slug: string) =>
  new RegExp(String.raw`/(?:assets/${slug}-[A-Za-z0-9_-]+\.js|src/examples/${slug}\.json)(?:\?.*)?$`);
const canvasChunk = /\/(?:assets\/CanvasView-[A-Za-z0-9_-]+\.js|src\/canvas\/CanvasView\.tsx)(?:\?.*)?$/;

/** Holds every request matching `pattern` until release(). */
async function gate(page: Page, pattern: RegExp) {
  let requested = false;
  let release!: () => void;
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(pattern, async (route) => {
    requested = true;
    await open;
    await route.continue();
  });
  return { requested: () => requested, release };
}

/** Two paints let a completed import's microtasks and React update run. */
const settle = (page: Page) =>
  page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );

test("start card loads its example only when opened", async ({ page, consoleErrors }) => {
  let requested = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(kafkaChunk, async (route) => {
    requested = true;
    await gate;
    await route.continue();
  });
  await page.goto("./");
  await expect(page.getByTestId("start-card")).toBeVisible();
  expect(requested).toBe(false);
  await page.getByTestId(`start-example-${kafka.slug}`).click();
  await expect.poll(() => requested).toBe(true);
  await expect(page.getByTestId("start-card")).toBeVisible();
  release();
  await expect(page.getByTestId(`node-${kafka.nodeIds[0]}`)).toBeVisible();
  await expect(page.getByTestId("example-picker")).toHaveValue(kafka.slug);
  expectNoErrors(consoleErrors);
});

test("example URL loads the full diagram and saved simulations", async ({ page, consoleErrors }) => {
  await page.goto(`./?example=${kafka.slug}`);
  await expect(page.getByTestId(`node-${kafka.nodeIds[0]}`)).toBeVisible();
  await expect(page.getByTestId("diagram-title")).toHaveText(kafka.title);
  await page.getByTestId("live-toggle").click();
  await expect(page.getByTestId("live-hud")).toBeVisible();
  await expect(page.getByTestId("live-sim-picker")).toContainText("Black Friday");
  expectNoErrors(consoleErrors);
});

test("a delayed example keeps the current canvas, and a failed load shows a toast", async ({ page }) => {
  await page.goto(`./?example=${other.slug}`);
  const currentNode = page.getByTestId(`node-${other.nodeIds[0]}`);
  await expect(currentNode).toBeVisible();
  let requested = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(kafkaChunk, async (route) => {
    requested = true;
    await gate;
    await route.abort("failed");
  });
  await page.getByTestId("example-picker").selectOption(kafka.slug);
  await expect.poll(() => requested).toBe(true);
  await expect(currentNode).toBeVisible();
  await expect(page.getByTestId("start-card")).toHaveCount(0);
  release();
  await expect(page.getByTestId("toast")).toContainText("Couldn't load that example");
  await expect(currentNode).toBeVisible();
  await expect(page.getByTestId("example-picker")).toHaveValue(other.slug);
  await expect(page).toHaveURL(new RegExp(`example=${other.slug}`));
});

test("a late import cannot replace a newer navigation", async ({ page, consoleErrors }) => {
  await page.goto(`./?example=${other.slug}`);
  await expect(page.getByTestId(`node-${other.nodeIds[0]}`)).toBeVisible();
  let requested = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(kafkaChunk, async (route) => {
    requested = true;
    await gate;
    await route.continue();
  });
  await page.getByTestId("example-picker").selectOption(kafka.slug);
  await expect.poll(() => requested).toBe(true);
  // Navigate again while the first import is waiting.
  await page.getByTestId("example-picker").selectOption(other.slug);
  await expect(page).toHaveURL(new RegExp(`example=${other.slug}`));
  const downloaded = page.waitForResponse((response) => kafkaChunk.test(response.url()));
  release();
  await (await downloaded).finished();
  // Two paints let the completed import's microtasks and React update run.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await expect(page.getByTestId("example-picker")).toHaveValue(other.slug);
  await expect(page.getByTestId(`node-${other.nodeIds[0]}`)).toBeVisible();
  expectNoErrors(consoleErrors);
});

test("an older download cannot replace the canvas while a newer download is pending", async ({
  page,
  consoleErrors,
}) => {
  const third = publicExamples.find((e) => e.slug === "cqrs-event-sourcing");
  if (!third) throw new Error("Missing public example");
  await page.goto(`./?example=${other.slug}`);
  const current = page.getByTestId(`node-${other.nodeIds[0]}`);
  await expect(current).toBeVisible();
  const first = await gate(page, exampleChunk(kafka.slug));
  const second = await gate(page, exampleChunk(third.slug));
  await page.getByTestId("example-picker").selectOption(kafka.slug);
  await expect.poll(first.requested).toBe(true);
  await page.getByTestId("example-picker").selectOption(third.slug);
  await expect.poll(second.requested).toBe(true);

  // The first download finishes first: it must not open while the newer one is still pending.
  const downloaded = page.waitForResponse((response) => exampleChunk(kafka.slug).test(response.url()));
  first.release();
  await (await downloaded).finished();
  await settle(page);
  await expect(current).toBeVisible();
  await expect(page.getByTestId(`node-${kafka.nodeIds[0]}`)).toHaveCount(0);
  await expect(page.getByTestId("example-picker")).toHaveValue(third.slug);

  second.release();
  await expect(page.getByTestId(`node-${third.nodeIds[0]}`)).toBeVisible();
  await expect(page.getByTestId("diagram-title")).toHaveText(third.title);
  await expect(page).toHaveURL(new RegExp(`example=${third.slug}`));
  expectNoErrors(consoleErrors);
});

test("keyboard navigation in the picker moves on from the pending selection", async ({ page }) => {
  // The first three event-streaming examples, in their picker order (src/examples/index.ts).
  const [next, afterNext] = ["cqrs-event-sourcing", "cdc-analytics"];
  await page.goto(`./?example=${kafka.slug}`);
  const current = page.getByTestId(`node-${kafka.nodeIds[0]}`);
  await expect(current).toBeVisible();
  const picker = page.getByTestId("example-picker");
  const gates = [await gate(page, exampleChunk(next)), await gate(page, exampleChunk(afterNext))];

  await picker.focus();
  await picker.press("ArrowDown");
  await expect(picker).toHaveValue(next);
  await expect.poll(gates[0].requested).toBe(true);
  await expect(page.getByTestId("example-loading")).toContainText("Loading");
  // Still loading: the next ArrowDown continues from the pending selection.
  await picker.press("ArrowDown");
  await expect(picker).toHaveValue(afterNext);
  await expect.poll(gates[1].requested).toBe(true);
  await expect(current).toBeVisible();

  gates[0].release();
  gates[1].release();
  await expect(page).toHaveURL(new RegExp(`example=${afterNext}`));
  await expect(page.getByTestId("example-loading")).toHaveText("");
  await expect(picker).toHaveValue(afterNext);
});

test("a cold example URL downloads the canvas code alongside the example", async ({ page }) => {
  const example = await gate(page, kafkaChunk);
  let canvasRequested = false;
  page.on("request", (request) => {
    if (canvasChunk.test(request.url())) canvasRequested = true;
  });
  await page.goto(`./?example=${kafka.slug}`);
  await expect.poll(example.requested).toBe(true);
  // The example is still held: the canvas chunk must not wait for it.
  await expect.poll(() => canvasRequested).toBe(true);
  example.release();
  await expect(page.getByTestId(`node-${kafka.nodeIds[0]}`)).toBeVisible();
});

test("a late example download cannot replace a newer embed payload", async ({ page, consoleErrors }) => {
  const shared = readFileSync(`src/examples/${other.slug}.json`);
  const payload = deflateRawSync(shared).toString("base64url");
  const example = await gate(page, kafkaChunk);
  await page.goto(`./?embed=1&example=${kafka.slug}`);
  await expect.poll(example.requested).toBe(true);
  await expect(page.getByTestId("embed-loading")).toBeVisible();

  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, `d=${payload}`);
  const sharedNode = page.getByTestId(`node-${other.nodeIds[0]}`);
  const openLink = page.getByTestId("embed-open-in-app");
  await expect(sharedNode).toBeVisible();
  await expect(openLink).toHaveAttribute("href", /#d=/);

  const downloaded = page.waitForResponse((response) => kafkaChunk.test(response.url()));
  example.release();
  await (await downloaded).finished();
  await settle(page);
  await expect(sharedNode).toBeVisible();
  await expect(page.getByTestId(`node-${kafka.nodeIds[0]}`)).toHaveCount(0);
  await expect(page.getByTestId("diagram-title")).toHaveText(other.title);
  await expect(openLink).toHaveAttribute("href", new RegExp(`#d=${payload}$`));
  expectNoErrors(consoleErrors);
});

test("production entry contains no full example JSON", () => {
  test.skip(process.env.E2E_TARGET !== "build" && !process.env.CI, "requires the production e2e build");
  const dir = "tests/.output/e2e-dist";
  const html = readFileSync(join(dir, "index.html"), "utf8");
  const entry = /<script\b[^>]*type="module"[^>]*\bsrc="([^"]+)"/.exec(html)?.[1];
  expect(entry).toBeTruthy();
  if (!entry) throw new Error("Missing module entry");
  const code = readFileSync(join(dir, entry.replace(/^\.?\//, "")), "utf8");
  const distinctive = "20,000 checkouts in ten seconds; each dot represents 50 orders.";
  expect(readFileSync("src/examples/kafka-order-pipeline.json", "utf8")).toContain(distinctive);
  expect(code).not.toContain(distinctive);
  // Shared eager chunks are also startup JavaScript; a regression can hide there even
  // when the entry itself is small (as the old registry did).
  for (const match of html.matchAll(/<link\b[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)) {
    expect(readFileSync(join(dir, match[1].replace(/^\.?\//, "")), "utf8")).not.toContain(distinctive);
  }
});
