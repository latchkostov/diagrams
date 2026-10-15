import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import {
  test,
  performanceTest,
  pageLoadTimeout,
  expect,
  gotoCanvas,
  expectNoErrors,
  waitForStableViewport,
} from "./fixtures";
import { typingWork, median } from "./typing-work";

// Architecture checks in the editor: the count under the title, the Checks card (from the count, the canvas
// right-click, Ctrl+K and the View menu), fixes, Ignore and Turn off (kept in the file), markers while the card
// is open, the inspector's finding, and typing that stays responsive while checks run. data-testid only.

const MOD = process.platform === "darwin" ? "Meta" : "Control";
/** One warning: the ledger worker fails in "Poison invoices" and ledger-posting has no dead-letter queue. */
const WARN = "azure-service-bus-integration";
const WARNING = "dead-letter:posting-sub";
/** No findings at all. */
const CLEAN = "aks-app-config-key-vault";

const card = (page: Page) => page.getByTestId("checks-card");
/** A visible element's box (fails the test when there is none). */
async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Expected a visible element");
  return box;
}
const row = (page: Page, id: string) => page.getByTestId(`check-row-${id}`);

async function openFromCount(page: Page) {
  await page.getByTestId("checks-count").click();
  await expect(card(page)).toBeVisible();
}

test.describe("the count under the title", () => {
  test("shows warnings only, for an example with one, and nothing for a clean one", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, WARN);
    await expect(page.getByTestId("checks-count")).toHaveText("1 warning");
    await gotoCanvas(page, CLEAN);
    await expect(page.getByTestId("node-api")).toBeVisible();
    // Checks have run (after the first idle) and found nothing: no "0 issues", no card.
    await page.waitForTimeout(2500);
    await expect(page.getByTestId("checks-count")).toHaveCount(0);
    await expect(card(page)).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("suggestions alone show nothing; live view and presenting show no count", async ({ page }) => {
    await gotoCanvas(page, "rag-assistant");
    await expect(page.getByTestId("node-ingest-q")).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(page.getByTestId("checks-count")).toHaveCount(0);

    await gotoCanvas(page, WARN);
    await expect(page.getByTestId("checks-count")).toBeVisible();
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await expect(page.getByTestId("checks-count")).toHaveCount(0);
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("checks-count")).toBeVisible();
  });
});

test.describe("the Checks card", () => {
  test.beforeEach(async ({ page }) => {
    await gotoCanvas(page, WARN);
    await expect(page.getByTestId("checks-count")).toBeVisible();
  });

  test("opens from the count, the canvas right-click, Ctrl+K and the View menu", async ({ page, consoleErrors }) => {
    await openFromCount(page);
    await expect(page.getByTestId("checks-summary")).toHaveText("1 warning · 2 suggestions");
    await expect(page.getByTestId("checks-group-warnings").getByRole("listitem")).toHaveCount(1);
    await expect(row(page, WARNING)).toContainText("Failed messages are dropped");
    await page.getByTestId("checks-close").click();
    await expect(card(page)).toHaveCount(0);

    // The canvas right-click, next to Auto-layout.
    await waitForStableViewport(page);
    const wrap = page.getByTestId("canvas-wrap");
    const box = await boxOf(wrap);
    await wrap.click({ button: "right", position: { x: box.width / 2, y: 90 } });
    await page.getByTestId("context-menu-item-canvas.check-diagram").click();
    await expect(card(page)).toBeVisible();
    await page.getByTestId("checks-close").click();

    // Ctrl+K "Check diagram".
    await page.keyboard.press(`${MOD}+k`);
    await page.keyboard.type("Check diagram");
    await page.keyboard.press("Enter");
    await expect(card(page)).toBeVisible();

    // Esc closes it (nothing selected), one level.
    await page.getByTestId("checks-close").focus();
    await page.keyboard.press("Escape");
    await expect(card(page)).toHaveCount(0);

    // The top bar's View menu: Checks, a toggle.
    await page.getByTestId("view-button").click();
    await page.getByTestId("view-checks").click();
    await expect(card(page)).toBeVisible();
    await page.getByTestId("view-button").click();
    await expect(page.getByTestId("view-checks")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("view-checks").click();
    await expect(card(page)).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("a row selects what it involves; markers show only while the card is open", async ({ page }) => {
    await expect(page.getByTestId("check-markers")).toHaveCount(0);
    await openFromCount(page);
    await expect(page.getByTestId("check-marker-posting-sub")).toHaveAttribute("data-severity", "warning");
    await expect(page.getByTestId("check-marker-approval-sub")).toHaveAttribute("data-severity", "suggestion");
    await page.getByTestId(`check-select-${WARNING}`).click();
    // Both nodes it names are selected (the inspector says how many), and shown clear of the card.
    await expect(page.getByTestId("inspector-title")).toHaveText("2 selected");
    await page.getByTestId("check-element-worker").click();
    await expect(page.getByTestId("inspector-title")).toHaveText("Node");
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("Ledger worker");
    await page.getByTestId("checks-close").click();
    await expect(page.getByTestId("check-markers")).toHaveCount(0);
  });

  test("Fix applies in one undo step, and the finding goes", async ({ page, consoleErrors }) => {
    await openFromCount(page);
    const nodes = page.getByTestId(/^node-(?!tooltip$|editor-)/);
    const before = await nodes.count();
    await page.getByTestId(`check-fix-${WARNING}`).click();
    await expect(page.getByTestId("toast")).toContainText("Added ledger-posting DLQ");
    await expect.poll(() => nodes.count()).toBe(before + 1);
    await expect(row(page, WARNING)).toHaveCount(0);
    await expect(page.getByTestId("checks-count")).toHaveCount(0);
    // One step back: the queue and its route go, and the warning returns.
    await page.getByTestId("check-fix-undo").click();
    await expect.poll(() => nodes.count()).toBe(before);
    await expect(row(page, WARNING)).toBeVisible();
    await expect(page.getByTestId("checks-count")).toHaveText("1 warning");
    expectNoErrors(consoleErrors);
  });

  test("the inspector shows a selected node's finding, with its fix", async ({ page }) => {
    await page.getByTestId("node-posting-sub").click();
    const findings = page.getByTestId("inspector-findings");
    await expect(findings).toContainText("Failed messages are dropped");
    await expect(page.getByTestId(`inspector-check-fix-${WARNING}`)).toHaveText(/Add dead-letter queue/);
    await page.getByTestId("inspector-open-checks").click();
    await expect(card(page)).toBeVisible();
    // A node without findings has none.
    await page.getByTestId("node-ingest").click();
    await expect(page.getByTestId("inspector-findings")).toHaveCount(0);
  });

  test("turning a check off, then back on", async ({ page }) => {
    await openFromCount(page);
    await page.getByTestId(`check-more-${WARNING}`).click();
    await page.getByTestId(`check-turn-off-${WARNING}`).click();
    // dead-letter is off: its warning and its suggestion go; the DLQ suggestion (no-reader) stays.
    await expect(page.getByTestId("checks-summary")).toHaveText("1 suggestion");
    await expect(page.getByTestId("checks-count")).toHaveCount(0);
    await page.getByTestId("checks-off-toggle").click();
    await page.getByTestId("check-turn-on-dead-letter").click();
    await expect(page.getByTestId("checks-summary")).toHaveText("1 warning · 2 suggestions");
    await expect(page.getByTestId("checks-off-toggle")).toHaveCount(0);
  });
});

test("Ignore keeps its reason through reload, export and import, and Show again brings it back", async ({
  page,
  consoleErrors,
}, info) => {
  await gotoCanvas(page, WARN);
  await openFromCount(page);
  await page.getByTestId(`check-more-${WARNING}`).click();
  await page.getByTestId(`check-ignore-${WARNING}`).click();
  await page.getByTestId(`check-ignore-reason-${WARNING}`).fill("The platform team owns its redrive");
  await page.getByTestId(`check-ignore-confirm-${WARNING}`).click();
  await expect(row(page, WARNING)).toHaveCount(0);
  await expect(page.getByTestId("checks-count")).toHaveCount(0);
  await expect(page.getByTestId("checks-ignored-toggle")).toHaveText("1 ignored");

  // Saved with the diagram: a reload keeps it.
  await page.reload();
  await expect(page.getByTestId("node-posting-sub")).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(page.getByTestId("checks-count")).toHaveCount(0);

  // Exported in the file, and imported back.
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-json").click()]);
  const file = info.outputPath("checked.diagram.json");
  await download.saveAs(file);
  const saved = JSON.parse(readFileSync(file, "utf8"));
  expect(saved.checks).toEqual({
    ignore: [{ rule: "dead-letter", target: "posting-sub", reason: "The platform team owns its redrive" }],
  });
  await page.getByTestId("import-input").setInputFiles(file);
  await expect(page.getByTestId("example-picker")).toHaveValue(/^my-/);
  await page.getByTestId("view-button").click();
  await page.getByTestId("view-checks").click();
  await page.getByTestId("checks-ignored-toggle").click();
  await expect(page.getByTestId("checks-ignored")).toContainText("The platform team owns its redrive");
  await page.getByTestId(`check-unignore-${WARNING}`).click();
  await expect(row(page, WARNING)).toBeVisible();
  await expect(page.getByTestId("checks-count")).toHaveText("1 warning");
  expectNoErrors(consoleErrors);
});

test("an empty diagram's check finishes: an empty state, not 'Checking…' forever", async ({ page }) => {
  await gotoCanvas(page, WARN);
  await page.getByTestId("import-input").setInputFiles({
    name: "empty.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "diagrams/v1", title: "Empty", nodes: [], edges: [] })),
  });
  await expect(page.getByTestId("example-picker")).toHaveValue(/^my-/);
  await page.getByTestId("view-button").click();
  await page.getByTestId("view-checks").click();
  await expect(page.getByTestId("checks-empty")).toContainText("Nothing to check yet");
  await expect(page.getByTestId("checks-running")).toHaveCount(0);
});

test("keyboard: Esc closes a finding's options first, then the card, and focus goes back", async ({ page }) => {
  await gotoCanvas(page, WARN);
  await expect(page.getByTestId("checks-count")).toBeVisible();
  await page.getByTestId("checks-count").focus();
  await page.keyboard.press("Enter");
  await expect(card(page)).toBeVisible();
  await page.getByTestId(`check-more-${WARNING}`).click();
  await page.getByTestId(`check-ignore-${WARNING}`).click();
  const reason = page.getByTestId(`check-ignore-reason-${WARNING}`);
  await reason.fill("abc");
  // Home and End move the caret in the reason box; they don't jump between findings.
  await reason.press("Home");
  await expect(reason).toBeFocused();
  await reason.press("End");
  await expect(reason).toBeFocused();
  // Esc: the options close (focus back on ⋯), the card stays.
  await page.keyboard.press("Escape");
  await expect(reason).toHaveCount(0);
  await expect(page.getByTestId(`check-more-${WARNING}`)).toBeFocused();
  await expect(card(page)).toBeVisible();
  // Arrow keys between the findings' heads.
  await page.getByTestId(`check-select-${WARNING}`).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("check-select-dead-letter:approval-sub")).toBeFocused();
  // Esc again: the card closes and focus goes back to the count that opened it.
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByTestId("checks-count")).toBeFocused();
});

test("a fix clicked twice adds one dead-letter queue", async ({ page }) => {
  await gotoCanvas(page, WARN);
  await openFromCount(page);
  const nodes = page.getByTestId(/^node-(?!tooltip$|editor-)/);
  const before = await nodes.count();
  await page.getByTestId(`check-fix-${WARNING}`).dblclick();
  await expect.poll(() => nodes.count()).toBe(before + 1);
  await page.waitForTimeout(1500);
  expect(await nodes.count()).toBe(before + 1);
});

test("at 1024 the open card overlaps no other chrome", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await gotoCanvas(page, WARN);
  await openFromCount(page);
  await page.getByTestId(`check-more-${WARNING}`).click();
  const cardBox = await boxOf(card(page));
  const overlaps = (b: { x: number; y: number; width: number; height: number } | null) =>
    !!b &&
    b.x < cardBox.x + cardBox.width &&
    cardBox.x < b.x + b.width &&
    b.y < cardBox.y + cardBox.height &&
    cardBox.y < b.y + b.height;
  const chrome = [
    "diagram-card",
    "live-toggle",
    "inspector",
    "first-run-hint",
    // The canvas controls in the bottom-left corner.
    "fit-view-button",
    "undo-button",
    "redo-button",
    "shortcuts-button",
  ];
  for (const id of chrome) {
    const el = page.getByTestId(id);
    if (await el.count()) expect(overlaps(await el.first().boundingBox()), id).toBe(false);
  }
  // Inside the canvas, and nothing in the card is cut off sideways.
  const wrap = await boxOf(page.getByTestId("canvas-wrap"));
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(wrap.x + wrap.width);
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(wrap.y + wrap.height);
});

const LONG = "Node 0.12, renamed to something wider than any card";

/** The page's check-run counts and switch (dev and e2e builds: `window.__checks`, src/canvas/checks/useChecks.ts). */
type CheckRunStats = { started: number; finished: number; held: boolean; skipped: number };
const runStats = (page: Page) =>
  page.evaluate(() => ({ ...(window as unknown as { __checks: CheckRunStats }).__checks }));
const holdChecks = (page: Page, held: boolean) =>
  page.evaluate((h) => void ((window as unknown as { __checks: CheckRunStats }).__checks.held = h), held);

performanceTest("typing a label is as responsive while checks run as with them held", async ({ page }, info) => {
  test.setTimeout(120_000);
  // 1,500 nodes in 100 pipelines, each with a loop of requests: every check runs, and capacity's fixed point
  // runs to its bound (the slowest case), in the worker.
  const nodes: object[] = [];
  const edges: object[] = [];
  for (let p = 0; p < 100; p++)
    for (let i = 0; i < 15; i++) {
      const id = `p${p}n${i}`;
      const stencil = i === 0 ? "client.browser" : i % 3 === 1 ? "aws.sqs" : "service.go";
      nodes.push({ id, stencil, label: `Node ${p}.${i}`, x: i * 260, y: p * 120 });
      if (i) edges.push({ id: `e-${id}`, from: `p${p}n${i - 1}`, to: id, kind: i >= 12 ? "sync" : "async" });
      if (i === 14) edges.push({ id: `b-${id}`, from: id, to: `p${p}n11`, kind: "sync" });
    }
  const diagram = { format: "diagrams/v1", title: "Large", nodes, edges };
  await gotoCanvas(page, WARN);
  await page.getByTestId("import-input").setInputFiles({
    name: "large.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(diagram)),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText("Large", { timeout: pageLoadTimeout() });
  await expect(page.getByTestId("checks-count")).toHaveText(/\d+ warnings/, { timeout: 60_000 });

  // Select a node through its finding (the diagram is far bigger than the view), then close the card.
  await openFromCount(page);
  await page.getByTestId("check-element-p0n12").first().click();
  await page.getByTestId("checks-close").click();
  const label = page.getByTestId("inspector-field-label");
  await expect(label).toHaveValue("Node 0.12");
  // A name already wider than a card can grow: typing on doesn't resize the node and re-route its edges, a
  // cost of its own (several times a keystroke's) that would land in whichever phase crosses the width.
  await label.fill(LONG);
  await label.press("End");
  await expect(page.getByTestId("planning-unavailable")).toBeVisible();
  const planningBefore = await page.evaluate(() => ({
    ...(window as unknown as { __planning: { reads: number; analyses: number; explanations: number } }).__planning,
  }));
  expect(planningBefore.reads, "oversize planning never copies the editor document").toBe(0);
  // Opt-in, to see CI's slower machines here: CHECKS_CPU=4 slows this page's CPU fourfold.
  if (process.env.CHECKS_CPU) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.CHECKS_CPU) });
  }

  const work = await typingWork(page);

  // Each check run as it comes due (started, or held back), told at once: `started` and `skipped` become setters
  // that call out to the test before the run goes on. (A poll couldn't hear of a run on the main thread until it
  // had finished, and the next key would never meet it.)
  let onDue = () => {};
  await page.exposeFunction("__checkDue", () => onDue());
  await page.evaluate(() => {
    const stats = (window as unknown as { __checks: Record<string, unknown> }).__checks;
    const announce = (window as unknown as { __checkDue: () => void }).__checkDue;
    for (const key of ["started", "skipped"]) {
      let value = stats[key];
      Object.defineProperty(stats, key, {
        enumerable: true,
        get: () => value,
        set: (next) => {
          value = next;
          announce();
        },
      });
    }
  });
  /** Resolves when the next run comes due; a backstop at the scale of the first run's wait, for a run that never does. */
  const nextDue = () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      new Promise<void>((resolve) => (onDue = resolve)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("no check run came due")), 60_000);
      }),
    ]).finally(() => clearTimeout(timer));
  };

  /**
   * Types `text` a key at a time, each as the last one's check run comes due (the edits paused for the debounce, and
   * the page went idle): so every key but the first meets a run as it starts. Not a pause in ms: a busy page goes
   * idle later, and a key typed before then put the run off again (nightly #78: 3 runs for 10 keys). The last key's
   * run coming due is the sample's end; its main-thread work is included, even if it blocks input.
   */
  async function phase(held: boolean, text: string) {
    await holdChecks(page, held);
    // A run left over from the last phase finishes first.
    await expect.poll(async () => (await runStats(page)).started - (await runStats(page)).finished).toBe(0);
    const before = await runStats(page);
    const samples: number[] = [];
    for (const ch of text) {
      const due = nextDue();
      samples.push(await work.key(ch, () => due));
    }
    const after = await runStats(page);
    return { samples, started: after.started - before.started };
  }
  // Three alternating phases of each kind on the same page.
  const held: number[] = [];
  const running: number[] = [];
  let runs = 0;
  for (const [i, kind] of ["h", "r", "h", "r", "h", "r"].entries()) {
    const p = await phase(kind === "h", ` ${kind}${i}xyz`);
    if (kind === "h") {
      expect(p.started, "checks held: none ran").toBe(0);
      held.push(...p.samples);
    } else {
      runs += p.started;
      running.push(...p.samples);
    }
  }
  await holdChecks(page, false);
  await expect(label).toHaveValue(`${LONG} h0xyz r1xyz h2xyz r3xyz h4xyz r5xyz`);
  expect(
    await page.evaluate(() => ({
      ...(window as unknown as { __planning: { reads: number; analyses: number; explanations: number } }).__planning,
    })),
  ).toEqual(planningBefore);
  info.annotations.push({ type: "typing-cpu", description: JSON.stringify({ held, running, runs }) });
  // Checks ran while the second set was typed: one after every key.
  expect(runs).toBeGreaterThanOrEqual(18);
  // They ran in the checks worker, not on this thread.
  expect(page.workers().length, "the checks worker").toBeGreaterThan(0);
  await work.close();
  expect(median(running), JSON.stringify({ held, running })).toBeLessThanOrEqual(median(held) * 1.5);
});
