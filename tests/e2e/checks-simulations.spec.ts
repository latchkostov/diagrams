import { TEXT_END } from "./fixtures";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, performanceTest, expect, gotoCanvas, expectNoErrors, pageLoadTimeout } from "./fixtures";
import { typingWork, median } from "./typing-work";

// Run simulations in the Checks card (docs/research/architecture-checks.md, batch 5): the saved simulations play in a
// worker, the card says which one it's on, counts land on the findings, Stop, Esc, closing the card and an edit stop
// it, an edit hides the counts (Undo brings them back), and typing stays as responsive while it plays. data-testid only.

const card = (page: Page) => page.getByTestId("checks-card");
const status = (page: Page) => page.getByTestId("checks-simulations-status");
const MOD = "ControlOrMeta";
const RESPONSIVENESS = "typing is as responsive while simulations play as with none playing";

/** An example as a file, changed by `edit`, imported over the canvas. */
async function importExample(page: Page, slug: string, title: string, edit: (d: Diagram) => void) {
  const d = JSON.parse(readFileSync(`src/examples/${slug}.json`, "utf8")) as Diagram;
  d.title = title;
  edit(d);
  await importDiagram(page, d);
}

type Diagram = {
  title: string;
  nodes: { id: string; stencil: string; label: string; x: number; y: number; props?: Record<string, unknown> }[];
  edges: { id: string; from: string; to: string; kind?: string }[];
  simulations?: object[];
};

async function importDiagram(page: Page, d: Diagram) {
  await page.getByTestId("import-input").setInputFiles({
    name: "fixture.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "diagrams/v1", ...d })),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText(d.title, { timeout: pageLoadTimeout() });
}

/** Opens the Checks card from Ctrl+K (it works with or without warnings). */
async function openChecks(page: Page) {
  await page.getByTestId("canvas-view").click({ position: { x: 900, y: 120 } });
  await palette(page, "Check diagram");
  await expect(page.getByTestId("command-item-action:canvas.check-diagram")).toBeVisible();
  await page.getByTestId("command-item-action:canvas.check-diagram").click();
  // First use downloads the card. Await its mount as setup (the test's hang backstop),
  // then assert visibility with the normal UI budget, as waitForLiveSession does.
  await page.getByTestId("canvas-wrap").evaluate(
    (root) =>
      new Promise<void>((resolve) => {
        const ready = () => {
          if (!root.querySelector('[data-testid="checks-card"]')) return;
          observer.disconnect();
          resolve();
        };
        const observer = new MutationObserver(ready);
        observer.observe(root, { childList: true, subtree: true });
        ready();
      }),
  );
  await expect(card(page)).toBeVisible();
}

/** Every text the simulations line shows from now on (a run can be quicker than a poll). */
async function recordStatus(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __statusTexts: string[] };
    w.__statusTexts = [];
    const seen = () => {
      const t = document.querySelector('[data-testid="checks-simulations-status"]')?.textContent ?? "";
      if (t && w.__statusTexts[w.__statusTexts.length - 1] !== t) w.__statusTexts.push(t);
    };
    new MutationObserver(seen).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  return () => page.evaluate(() => (window as unknown as { __statusTexts: string[] }).__statusTexts);
}

type RunStats = { started: number; finished: number; stopped: number };
const runStats = (page: Page) =>
  page.evaluate(() => ({ ...(window as unknown as { __simulations: RunStats }).__simulations }));

/** The canvas right-click below the fitted diagram, clear of the minimap and controls. */
async function canvasMenu(page: Page) {
  const wrap = page.getByTestId("canvas-wrap");
  const box = await wrap.boundingBox();
  if (!box) throw new Error("Expected the canvas on screen");
  await wrap.click({ button: "right", position: { x: box.width * 0.55, y: box.height - 14 } });
  await expect(page.getByTestId("context-menu")).toBeVisible();
}

/** Ctrl+K, searching for `text`. */
async function palette(page: Page, text: string) {
  await page.keyboard.press(`${MOD}+k`);
  // Its first lazy load and the stress diagram's command list are setup work.
  await expect(page.getByTestId("command-palette")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(page.getByTestId("command-input")).toBeFocused();
  await page.keyboard.type(text);
}

const RUN_ITEM = "context-menu-item-canvas.run-simulations";
const RUN_COMMAND = "command-item-action:canvas.run-simulations";
const STOP_ITEM = "context-menu-item-canvas.stop-simulations";
const STOP_COMMAND = "command-item-action:canvas.stop-simulations";

/** A topic whose consumer retries in place while a saved simulation takes it down: messages are lost at the topic. */
const inPlace = (): Diagram => ({
  title: "Retries in place",
  nodes: [
    { id: "shop", stencil: "client.browser", label: "Shop", x: 0, y: 0 },
    { id: "topic", stencil: "kafka.topic", label: "orders", x: 0, y: 200 },
    {
      id: "pay",
      stencil: "service.go",
      label: "Payments",
      x: 0,
      y: 400,
      props: { retry: "inplace", retryBackoffMs: 500, concurrency: 8 },
    },
  ],
  edges: [
    { id: "e1", from: "shop", to: "topic", kind: "async" },
    { id: "e2", from: "topic", to: "pay", kind: "async" },
  ],
  simulations: [
    {
      id: "outage",
      title: "Payments goes down",
      seed: 3,
      traffic: [{ id: "t", node: "shop", shape: { kind: "constant", ratePerSec: 40, durationMs: 4000 } }],
      timeline: [
        { atMs: 2000, action: { do: "status", node: "pay", status: "down" } },
        { atMs: 8000, action: { do: "status", node: "pay", status: "up" } },
      ],
    },
  ],
});

test("Run simulations: progress, counts on the finding, an edit hides them and Undo brings them back", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, "aks-app-config-key-vault");
  // The invoice example without its commands DLQ: Poison invoices now loses its 30 invoices. Its subscriptions keep
  // their own dead-letter queues, so that is the only warning.
  await importExample(page, "azure-service-bus-integration", "Invoices without a DLQ", (d) => {
    d.edges = d.edges.filter((e) => e.id !== "commands-to-dlq");
  });
  await expect(page.getByTestId("checks-count")).toHaveText("1 warning", { timeout: pageLoadTimeout() });
  await page.getByTestId("checks-count").click();
  await expect(card(page)).toBeVisible();
  const texts = await recordStatus(page);
  await page.getByTestId("checks-run-simulations").click();
  await expect(status(page)).toHaveText("Played 2 simulations · counts on 1 finding");
  // It said which one it was on, in order.
  expect(await texts()).toEqual([
    "Playing 1 of 2: “Month-end invoice batch”…",
    "Playing 2 of 2: “Poison invoices”…",
    "Played 2 simulations · counts on 1 finding",
  ]);
  const evidence = page.getByTestId("check-evidence-dead-letter:commands");
  await expect(evidence).toHaveText("30 dropped in “Poison invoices”");
  // Evidence is never a warning of its own: the count under the title is the checks' own.
  await expect(page.getByTestId("checks-count")).toHaveText("1 warning", { timeout: pageLoadTimeout() });
  // Focus stayed on the one button, now Run again.
  await expect(page.getByTestId("checks-run-simulations")).toBeFocused();
  await expect(page.getByTestId("checks-run-simulations")).toHaveText("Run again");

  // Moving a node changes nothing a simulation sees: the counts stay.
  const node = page.getByTestId("node-worker");
  const box = await node.boundingBox();
  if (!box) throw new Error("Expected the worker on screen");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  await expect(evidence).toBeVisible();

  // An edit it would see hides them, at once.
  await page.getByTestId("check-element-worker").first().click();
  await page.getByTestId("inspector-field-label").fill("Ledger worker v2");
  await expect(status(page)).toHaveText("The diagram changed since the simulations played.");
  await expect(evidence).toHaveCount(0);
  await expect(page.getByTestId("checks-run-simulations")).toHaveText("Run again");
  // Undo brings back the diagram they were played on, and with it the counts.
  await page.getByTestId("inspector-field-label").blur();
  await page.getByTestId("undo-button").click();
  await expect(page.getByTestId("inspector-field-label")).toHaveValue("Ledger worker");
  await expect(status(page)).toHaveText("Played 2 simulations · counts on 1 finding");
  await expect(evidence).toBeVisible();
  expectNoErrors(consoleErrors);
});

test("a deliberate outage is on purpose, not a finding", async ({ page }) => {
  await gotoCanvas(page, "cell-based-bookings");
  await openChecks(page);
  await page.getByTestId("checks-run-simulations").click();
  await expect(status(page)).toHaveText("Played 2 simulations");
  await expect(page.getByTestId("checks-simulations-notes")).toHaveText(
    "On purpose: 20 dropped at Regional ALB, which “us-east-1 goes dark” takes down." +
      "On purpose: 245 dropped at Booking API, which “A bad deploy stays in one cell” makes fail.",
  );
  await expect(page.getByTestId("checks-empty")).toBeVisible();
  await expect(page.getByTestId("checks-count")).toHaveCount(0);
  // Three load balancers share the name: the note's selects the one it means.
  await page.getByTestId("checks-planned-east-alb").click();
  await expect(page.getByTestId("inspector-field-sublabel")).toHaveValue("us-east-1");
});

test("focus stays on the link when a run adds the first finding, and when Run again takes it away", async ({
  page,
}) => {
  await gotoCanvas(page, "aks-app-config-key-vault");
  // One cell's API fails 2% of bookings: no static finding, and a `dropped` one once the simulations play.
  await importExample(page, "cell-based-bookings", "Flaky writes", (d) => {
    const api = d.nodes.find((n) => n.id === "east-c2-api");
    if (api) api.props = { ...api.props, failureRate: 0.02 };
  });
  await openChecks(page);
  await expect(page.getByTestId("checks-empty")).toBeVisible();
  const link = page.getByTestId("checks-run-simulations");
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("check-row-dropped:east-c2-api")).toBeVisible();
  await expect(link).toHaveText("Run again");
  await expect(link).toBeFocused();
  // Again: the counts go while it plays (no finding), and come back.
  await page.keyboard.press("Enter");
  await expect(status(page)).toHaveText(/^Played/);
  await expect(link).toBeFocused();
});

test("Run simulations from Ctrl+K and the canvas right-click: opens the card and plays; what it finds has no fix", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, "aks-app-config-key-vault");
  await importDiagram(page, inPlace());
  await expect(card(page)).toHaveCount(0);

  // Ctrl+K, with the card closed: it opens the card, then plays.
  await page.getByTestId("canvas-view").click({ position: { x: 900, y: 120 } });
  await palette(page, "Run simulations");
  await page.getByTestId(RUN_COMMAND).click();
  await expect(card(page)).toBeVisible();
  await expect(status(page)).toHaveText("Played 1 simulation · counts on 1 finding");
  // Run simulations says what happened and where, and offers no fix: no button, no chips.
  const lost = page.getByTestId("check-row-dropped:topic");
  await expect(lost).toContainText("Messages are lost at orders");
  await expect(page.getByTestId("check-evidence-dropped:topic")).toHaveText(/dropped in “Payments goes down”/);
  await expect(page.getByTestId("check-fix-dropped:topic")).toHaveCount(0);
  await expect(page.getByTestId("check-fix-option-0-dropped:topic")).toHaveCount(0);
  expect(await runStats(page)).toMatchObject({ started: 1, finished: 1 });

  // The canvas right-click, with the card closed again: the same.
  await page.getByTestId("checks-close").click();
  await expect(card(page)).toHaveCount(0);
  await canvasMenu(page);
  await expect(page.getByTestId(RUN_ITEM)).toHaveText(/Run simulations/);
  await page.getByTestId(RUN_ITEM).click();
  await expect(card(page)).toBeVisible();
  await expect.poll(async () => (await runStats(page)).finished).toBe(2);
  await expect(status(page)).toHaveText("Played 1 simulation · counts on 1 finding");
  await expect(lost).toBeVisible();
  expectNoErrors(consoleErrors);
});

for (const via of ["Ctrl+K", "canvas right-click"] as const) {
  test(
    `Run simulations survives the Checks card's StrictMode mount from ${via}`,
    { tag: "@dev" },
    async ({ page, consoleErrors }) => {
      await gotoCanvas(page, "aks-app-config-key-vault");
      await importDiagram(page, inPlace());
      // The card has never mounted. A command starts the run before StrictMode replays its first effects.
      await expect(card(page)).toHaveCount(0);
      if (via === "Ctrl+K") {
        await palette(page, "Run simulations");
        await page.getByTestId(RUN_COMMAND).click();
      } else {
        await canvasMenu(page);
        await page.getByTestId(RUN_ITEM).click();
      }
      await expect(status(page)).toHaveText("Played 1 simulation · counts on 1 finding");
      expect(await runStats(page)).toEqual({ started: 1, finished: 1, stopped: 0 });
      expectNoErrors(consoleErrors);
    },
  );
}

test("no saved simulations, no Run simulations; and none in live view", async ({ page }) => {
  await gotoCanvas(page, "aks-app-config-key-vault");
  await importDiagram(page, {
    title: "No simulations",
    nodes: [
      { id: "a", stencil: "service.node", label: "A", x: 0, y: 0 },
      { id: "q", stencil: "aws.sqs", label: "q", x: 300, y: 0 },
      { id: "b", stencil: "service.node", label: "B", x: 600, y: 0 },
    ],
    edges: [
      { id: "e1", from: "a", to: "q", kind: "async" },
      { id: "e2", from: "q", to: "b", kind: "async" },
    ],
  } as Diagram);
  await openChecks(page);
  await expect(page.getByTestId("checks-summary")).toBeVisible();
  await expect(page.getByTestId("checks-simulations")).toHaveCount(0);
  // Nor in Ctrl+K.
  await palette(page, "Run simulations");
  await expect(page.getByTestId("command-list")).toBeVisible();
  await expect(page.getByTestId(RUN_COMMAND)).toHaveCount(0);
  await expect(page.getByTestId(STOP_COMMAND)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await gotoCanvas(page, "cell-based-bookings");
  await openChecks(page);
  await expect(page.getByTestId("checks-run-simulations")).toBeVisible();
  await page.getByTestId("live-toggle").click();
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await expect(page.getByTestId("checks-run-simulations")).toHaveCount(0);
  // Live view's Ctrl+K plays a simulation live; it has no Run simulations.
  await palette(page, "simulations");
  await expect(page.getByTestId("command-list")).toBeVisible();
  await expect(page.getByTestId(RUN_COMMAND)).toHaveCount(0);
});

/**
 * 1,500 nodes in 100 pipelines whose messages go round a loop until the minute is up, with three saved simulations
 * (180,000 messages, near the file format's 200,000). Each takes the worker seconds (a run of the three can reach the
 * wall-clock budget): long enough to stop it, and to type while it plays.
 */
function heavy(pipelines = 100): Diagram {
  const nodes: Diagram["nodes"] = [];
  const edges: Diagram["edges"] = [];
  for (let p = 0; p < pipelines; p++)
    for (let i = 0; i < 15; i++) {
      const id = `p${p}n${i}`;
      const queue = i % 3 === 1;
      const stencil = i === 0 ? "client.browser" : queue ? "aws.sqs" : "service.go";
      const props = i && !queue ? { concurrency: 256 } : undefined;
      nodes.push({ id, stencil, label: `Node ${p}.${i}`, x: i * 260, y: p * 120, ...(props ? { props } : {}) });
      if (i) edges.push({ id: `e-${id}`, from: `p${p}n${i - 1}`, to: id, kind: "async" });
      if (i === 14) edges.push({ id: `b-${id}`, from: id, to: `p${p}n1`, kind: "async" });
    }
  const sim = (n: number) => ({
    id: `s${n}`,
    title: `Rush ${n}`,
    seed: n,
    traffic: Array.from({ length: pipelines }, (_, p) => ({
      id: `t${p}`,
      node: `p${p}n0`,
      shape: { kind: "constant", ratePerSec: 1000 / pipelines, durationMs: 60_000 },
    })),
  });
  return { title: "Large, with simulations", nodes, edges, simulations: [sim(1), sim(2), sim(3)] };
}

test.describe("a long run", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }, info) => {
    await gotoCanvas(page, "aks-app-config-key-vault");
    // Cancellation needs sustained worker traffic, not a costly 1,500-node live/editor remount.
    // Keep the full UI stress fixture for the responsiveness measurement. Total traffic stays the same.
    await importDiagram(page, heavy(info.title === RESPONSIVENESS ? 100 : 8));
    await openChecks(page);
    await expect(page.getByTestId("checks-summary")).toBeVisible({ timeout: 60_000 });
  });

  test("Stop, Esc, closing the card and an edit each stop it at once", async ({ page }) => {
    const run = page.getByTestId("checks-run-simulations");
    const stop = page.getByTestId("checks-stop-simulations");
    await run.click();
    await expect(status(page)).toHaveText("Playing 1 of 3: “Rush 1”…");
    // The one button became Stop, and kept focus.
    await expect(stop).toBeFocused();
    await stop.click();
    await expect(status(page)).toHaveText("Stopped.");
    expect(await runStats(page)).toMatchObject({ finished: 0, stopped: 1 });

    // Esc stops it first (one level); the next Esc closes the card.
    await run.click();
    await expect(status(page)).toHaveText(/^Playing 1 of 3/);
    await page.keyboard.press("Escape");
    await expect(status(page)).toHaveText("Stopped.");
    await expect(card(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card(page)).toHaveCount(0);
    expect(await runStats(page)).toMatchObject({ finished: 0, stopped: 2 });

    // Closing the card stops it.
    await openChecks(page);
    await run.click();
    await expect(status(page)).toHaveText(/^Playing 1 of 3/);
    await page.getByTestId("checks-close").click();
    await expect.poll(async () => (await runStats(page)).stopped).toBe(3);

    // An edit a simulation would see stops it.
    await openChecks(page);
    await run.click();
    await expect(status(page)).toHaveText(/^Playing 1 of 3/);
    await page.getByTestId("check-element-p0n2").first().click();
    await page.getByTestId("inspector-field-label").fill("Renamed");
    await expect(status(page)).toHaveText("Stopped: the diagram changed.");
    expect(await runStats(page)).toMatchObject({ finished: 0, stopped: 4 });
  });

  test("Ctrl+K and the canvas right-click stop it the same way, and play it again", async ({ page }) => {
    await page.getByTestId("checks-close").click();
    await expect(card(page)).toHaveCount(0);
    // The right-click: the card opens and it plays; while it plays Stop simulations takes Run's place.
    await canvasMenu(page);
    await page.getByTestId(RUN_ITEM).click();
    await expect(card(page)).toBeVisible();
    await expect(status(page)).toHaveText(/^Playing 1 of 3/);
    await canvasMenu(page);
    await expect(page.getByTestId(RUN_ITEM)).toHaveCount(0);
    await expect(page.getByTestId(STOP_ITEM)).toHaveText(/Stop simulations/);
    await page.getByTestId(STOP_ITEM).click();
    await expect(status(page)).toHaveText("Stopped.");
    expect(await runStats(page)).toMatchObject({ started: 1, finished: 0, stopped: 1 });

    // Ctrl+K: Run simulations, then Stop simulations.
    await palette(page, "Run simulations");
    await page.getByTestId(RUN_COMMAND).click();
    await expect(status(page)).toHaveText(/^Playing 1 of 3/);
    await palette(page, "Stop simulations");
    await expect(page.getByTestId(STOP_COMMAND)).toContainText("Stop simulations");
    await expect(page.getByTestId(RUN_COMMAND)).toHaveCount(0);
    await page.getByTestId(STOP_COMMAND).click();
    await expect(status(page)).toHaveText("Stopped.");
    expect(await runStats(page)).toMatchObject({ started: 2, finished: 0, stopped: 2 });
  });

  test("leaving editing, another view or another diagram stops a run Ctrl+K started; Run plays the canvas shown", async ({
    page,
  }) => {
    // Going live stops it, and live view offers neither row.
    await palette(page, "Run simulations");
    await page.getByTestId(RUN_COMMAND).click();
    await expect(status(page)).toHaveText(/^Playing 1 of 3/);
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await expect.poll(async () => (await runStats(page)).stopped).toBe(1);
    await palette(page, "simulations");
    await expect(page.getByTestId("command-list")).toBeVisible();
    await expect(page.getByTestId(RUN_COMMAND)).toHaveCount(0);
    await expect(page.getByTestId(STOP_COMMAND)).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Back to editing: Ctrl+K plays them again, opening the card.
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-controls")).toHaveCount(0);
    await palette(page, "Run simulations");
    await page.getByTestId(RUN_COMMAND).click();
    await expect(card(page)).toBeVisible();
    await expect(status(page)).toHaveText(/^Playing 1 of 3: “Rush 1”/);

    // Another view takes the canvas away: that stops it too.
    await page.getByTestId("view-gallery").click();
    await expect(page.getByTestId("gallery-view")).toBeVisible();
    await expect.poll(async () => (await runStats(page)).stopped).toBe(2);
    await page.getByTestId("view-canvas").click();
    await expect(page.getByTestId("canvas-view")).toBeVisible();

    // Another diagram, opened while one plays: the run stops, and Run simulations plays the new diagram's.
    await palette(page, "Run simulations");
    await page.getByTestId(RUN_COMMAND).click();
    await expect(status(page)).toHaveText(/^Playing 1 of 3/);
    await importDiagram(page, inPlace());
    await expect.poll(async () => (await runStats(page)).stopped).toBe(3);
    await page.getByTestId("canvas-view").click({ position: { x: 900, y: 120 } });
    await palette(page, "Run simulations");
    await page.getByTestId(RUN_COMMAND).click();
    await expect(status(page)).toHaveText("Played 1 simulation · counts on 1 finding");
    await expect(page.getByTestId("check-row-dropped:topic")).toBeVisible();
    expect(await runStats(page)).toMatchObject({ started: 4, finished: 1, stopped: 3 });
  });

  performanceTest(RESPONSIVENESS, async ({ page }, info) => {
    // The stress measurement must retain all 100 pipelines (1,500 nodes).
    await expect(page.getByTestId("node-p99n14")).toBeAttached();
    // Type in a finding's Ignore box: it's in the card, which redraws as the run moves on, and it isn't an edit.
    const rowId = "dead-letter:p0n1";
    await page.getByTestId(`check-more-${rowId}`).click();
    await page.getByTestId(`check-ignore-${rowId}`).click();
    const box = page.getByTestId(`check-ignore-reason-${rowId}`);
    await expect(box).toBeFocused();
    if (process.env.CHECKS_CPU) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.CHECKS_CPU) });
    }
    // Worker creation precedes its dev module imports. Wait for its first progress message, so
    // every playing sample overlaps execution rather than a still-downloading worker.
    let progressed = 0;
    await page.exposeFunction("__simulationProgress", () => progressed++);
    await page.evaluate(() => {
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          if (/evidenceWorker/.test(String(url)))
            this.addEventListener("message", (event: MessageEvent<{ type: string }>) => {
              if (event.data.type === "progress")
                void (window as unknown as { __simulationProgress(): Promise<void> }).__simulationProgress();
            });
        }
      };
    });
    const work = await typingWork(page);

    async function phase(playing: boolean, text: string) {
      // Idle and playing phases must measure the same input, including its length.
      await box.fill("");
      await expect(box).toHaveValue("");
      if (playing) {
        const before = progressed;
        await page.getByTestId("checks-run-simulations").click();
        await expect(status(page)).toHaveText(/^Playing/);
        // They play in the simulations worker, not on this thread.
        await expect
          .poll(() => progressed, { message: "the worker has begun playing", timeout: pageLoadTimeout() })
          .toBeGreaterThan(before);
      }
      await box.click();
      await box.press(TEXT_END);
      const samples: number[] = [];
      for (const ch of text) samples.push(await work.key(ch));
      // Still playing when the typing ended: the whole phase was typed over a run.
      if (playing) {
        await expect(status(page)).toHaveText(/^Playing/);
        await page.getByTestId("checks-stop-simulations").click();
        await expect(status(page)).toHaveText("Stopped.");
      }
      return samples;
    }
    const idle: number[] = [];
    const playing: number[] = [];
    // Alternating, so both see the same page in the same state. Keep every sample, with enough keys
    // per phase that the card's startup renders cannot dominate the steady-state typing median.
    for (const kind of ["i", "p", "i", "p", "i", "p"])
      (kind === "p" ? playing : idle).push(...(await phase(kind === "p", " i0abcdefghijkl")));
    await expect(box).toHaveValue(" i0abcdefghijkl");
    info.annotations.push({ type: "typing-cpu", description: JSON.stringify({ idle, playing }) });
    expect(await runStats(page)).toMatchObject({ started: 3, stopped: 3 });
    await work.close();
    // Same-run CPU baseline: a busy worker must not move simulation work onto the input thread.
    expect(median(playing), JSON.stringify({ idle, playing })).toBeLessThanOrEqual(median(idle) * 1.5);
  });
});
