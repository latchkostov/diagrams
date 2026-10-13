import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors } from "./fixtures";

// Run simulations in the Checks card (docs/research/architecture-checks.md, batch 5): the saved simulations play in a
// worker, the card says which one it's on, counts land on the findings, Stop, Esc, closing the card and an edit stop
// it, an edit hides the counts (Undo brings them back), and typing stays as responsive while it plays. data-testid only.

const card = (page: Page) => page.getByTestId("checks-card");
const status = (page: Page) => page.getByTestId("checks-simulations-status");
const MOD = process.platform === "darwin" ? "Meta" : "Control";

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
  await expect(page.getByTestId("diagram-title")).toHaveText(d.title);
}

/** Opens the Checks card from Ctrl+K (it works with or without warnings). */
async function openChecks(page: Page) {
  await page.getByTestId("canvas-view").click({ position: { x: 900, y: 120 } });
  await page.keyboard.press(`${MOD}+k`);
  await page.keyboard.type("Check diagram");
  await page.keyboard.press("Enter");
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

test("Run simulations: progress, counts on the finding, an edit hides them and Undo brings them back", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, "aks-app-config-key-vault");
  // The invoice example without its commands DLQ: Poison invoices now loses its 30 invoices.
  await importExample(page, "azure-service-bus-integration", "Invoices without a DLQ", (d) => {
    d.edges = d.edges.filter((e) => e.id !== "commands-to-dlq");
  });
  await expect(page.getByTestId("checks-count")).toHaveText("2 warnings");
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
  await expect(page.getByTestId("checks-count")).toHaveText("2 warnings");
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
  await gotoCanvas(page, "multi-region-active-active");
  await openChecks(page);
  await page.getByTestId("checks-run-simulations").click();
  await expect(status(page)).toHaveText("Played 2 simulations");
  await expect(page.getByTestId("checks-simulations-notes")).toHaveText(
    "On purpose: 96 dropped at Load balancer, which “Region outage and failover” takes down.",
  );
  await expect(page.getByTestId("checks-empty")).toBeVisible();
  await expect(page.getByTestId("checks-count")).toHaveCount(0);
  // Two load balancers share the name: the note's selects the one it means.
  await page.getByTestId("checks-planned-alb-us").click();
  await expect(page.getByTestId("inspector-field-sublabel")).toHaveValue("us-east-1 · 3 AZs");
});

test("focus stays on the link when a run adds the first finding, and when Run again takes it away", async ({
  page,
}) => {
  await gotoCanvas(page, "aks-app-config-key-vault");
  // us-east-1's API fails 2% of writes: no static finding, and a `dropped` one once the simulations play.
  await importExample(page, "multi-region-active-active", "Flaky writes", (d) => {
    const api = d.nodes.find((n) => n.id === "api-us");
    if (api) api.props = { ...api.props, failureRate: 0.02 };
  });
  await openChecks(page);
  await expect(page.getByTestId("checks-empty")).toBeVisible();
  const link = page.getByTestId("checks-run-simulations");
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("check-row-dropped:api-us")).toBeVisible();
  await expect(link).toHaveText("Run again");
  await expect(link).toBeFocused();
  // Again: the counts go while it plays (no finding), and come back.
  await page.keyboard.press("Enter");
  await expect(status(page)).toHaveText(/^Played/);
  await expect(link).toBeFocused();
});

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
  await gotoCanvas(page, "multi-region-active-active");
  await openChecks(page);
  await expect(page.getByTestId("checks-run-simulations")).toBeVisible();
  await page.getByTestId("live-toggle").click();
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await expect(page.getByTestId("checks-run-simulations")).toHaveCount(0);
});

/**
 * 1,500 nodes in 100 pipelines whose messages go round a loop until the minute is up, with three saved simulations
 * (180,000 messages, near the file format's 200,000). Each takes the worker seconds (a run of the three can reach the
 * wall-clock budget): long enough to stop it, and to type while it plays.
 */
function heavy(): Diagram {
  const nodes: Diagram["nodes"] = [];
  const edges: Diagram["edges"] = [];
  for (let p = 0; p < 100; p++)
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
    traffic: Array.from({ length: 100 }, (_, p) => ({
      id: `t${p}`,
      node: `p${p}n0`,
      shape: { kind: "constant", ratePerSec: 10, durationMs: 60_000 },
    })),
  });
  return { title: "Large, with simulations", nodes, edges, simulations: [sim(1), sim(2), sim(3)] };
}

test.describe("a long run", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await gotoCanvas(page, "aks-app-config-key-vault");
    await importDiagram(page, heavy());
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

  test("typing is as responsive while simulations play as with none playing", async ({ page }, info) => {
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
    await page.evaluate(() => {
      const w = window as unknown as { __keys: Map<number, number> };
      w.__keys = new Map();
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as (PerformanceEntry & { interactionId?: number })[])
          if (e.interactionId) w.__keys.set(e.interactionId, Math.max(w.__keys.get(e.interactionId) ?? 0, e.duration));
      }).observe({ type: "event", durationThreshold: 16, buffered: false } as PerformanceObserverInit);
    });
    const takeSamples = () =>
      page.evaluate(() => {
        const w = window as unknown as { __keys: Map<number, number> };
        const out = [...w.__keys.values()];
        w.__keys.clear();
        return out;
      });
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

    async function phase(playing: boolean, text: string) {
      if (playing) {
        await page.getByTestId("checks-run-simulations").click();
        await expect(status(page)).toHaveText(/^Playing/);
        // They play in the simulations worker, not on this thread.
        await expect.poll(() => page.workers().some((w) => /evidenceWorker/.test(w.url())), "the worker").toBe(true);
      }
      await box.click();
      await box.press("End");
      await takeSamples();
      for (const ch of text) {
        await page.keyboard.type(ch);
        await page.waitForTimeout(300);
      }
      // Event Timing reports a little after the paint.
      await page.waitForTimeout(200);
      const samples = await takeSamples();
      while (samples.length < text.length) samples.push(16);
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
    // Alternating, so both see the same page in the same state; three of each for a steady median.
    for (const [i, kind] of ["i", "p", "i", "p", "i", "p"].entries())
      (kind === "p" ? playing : idle).push(...(await phase(kind === "p", ` ${kind}${i}xyz`)));
    await expect(box).toHaveValue(" i0xyz p1xyz i2xyz p3xyz i4xyz p5xyz");
    info.annotations.push({ type: "event-timing", description: JSON.stringify({ idle, playing }) });
    expect(await runStats(page)).toMatchObject({ started: 3, stopped: 3 });
    // And typing was no slower for it: the same median keystroke, give or take noise. As the checks' typing test: the
    // slack is relative to the idle phases (a busy machine slows both alike), and at least two steps of Event Timing's
    // 8 ms resolution above its 16 ms floor. Played on the main thread, a minute of a 1,500-node simulation would
    // hold a keystroke for seconds.
    expect(median(playing)).toBeLessThanOrEqual(Math.max(median(idle) * 1.5, median(idle) + 16));
  });
});
