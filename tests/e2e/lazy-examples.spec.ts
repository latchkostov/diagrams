import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, expectNoErrors, publicExamples } from "./fixtures";

const kafka = publicExamples.find((e) => e.slug === "kafka-order-pipeline");
const other = publicExamples.find((e) => e.slug === "rag-assistant");
if (!kafka || !other) throw new Error("Missing public examples");
const kafkaChunk = /\/(?:assets\/kafka-order-pipeline-[^/]+\.js|src\/examples\/kafka-order-pipeline\.json)(?:\?.*)?$/;

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
