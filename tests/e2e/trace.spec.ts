import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import type { DiagramFile } from "../../src/model/types";
import { createSimulationRun } from "../../src/sim/simulation";
import { pseudoText } from "../../src/i18n/pseudo";
import { test, expect, expectNoErrors, gotoLab, gotoLive } from "./fixtures";
import {
  interactionJournalMark,
  liveKeyLevels,
  waitForStableViewport,
  waitForCameraIdle,
  pauseClock,
} from "./fixtures";

// Message trace: follow one message (and its fan-out copies) hop by hop, then turn its journey into
// a sequence diagram. Selectors are data-testid only.

const KAFKA = "kafka-order-pipeline";
const KAFKA_NODES = (
  JSON.parse(readFileSync("src/examples/kafka-order-pipeline.json", "utf8")) as { nodes: { id: string }[] }
).nodes.map((n) => n.id);
const AZURE = "azure-service-bus-integration";
const menuItem = (page: Page, id: string) => page.getByTestId(`context-menu-item-${id}`);
const card = (page: Page) => page.getByTestId("trace-card");
const hops = (page: Page) => page.getByTestId(/^trace-hop-/);

test("paused slow-motion notes update after a language switch", async ({ page, consoleErrors }) => {
  await gotoLab(page, "slow-trace-locale");
  const note = page.getByTestId("trace-slowmo-note");
  const english =
    "Recorded for 30 s of simulated time: still moving. This slow motion runs 1 min: → skips to the next hop.";
  await expect(note).toHaveText(english);
  const mounted = await note.elementHandle();
  if (!mounted) throw new Error("Expected a mounted slow-motion note");
  await page.getByTestId("slow-trace-locale-pseudo").click();
  await expect(note).toContainText(pseudoText("Recorded for "));
  await expect(note).toContainText(pseudoText("30 s"));
  await expect(note).toContainText(`${pseudoText("of simulated time: ")}still moving.`);
  await expect(note).toContainText(
    `${pseudoText("This slow motion runs ")}1 min${pseudoText(": → skips to the next hop.")}`,
  );
  expect(await mounted.evaluate((el) => el.isConnected)).toBe(true);
  await page.getByTestId("slow-trace-locale-en").click();
  await expect(note).toHaveText(english);
  expect(await mounted.evaluate((el) => el.isConnected)).toBe(true);
  expectNoErrors(consoleErrors);
});

async function openNodeMenu(page: Page, nodeId: string, actionId: string) {
  await waitForStableViewport(page);
  await page.getByTestId(`node-${nodeId}`).click({ button: "right" });
  await menuItem(page, actionId).click();
}

async function openCanvasSubmenu(page: Page, parent: string, child: string) {
  await waitForStableViewport(page);
  const box = await page.getByTestId("canvas-wrap").boundingBox();
  if (!box) throw new Error("No canvas");
  await page.getByTestId("canvas-wrap").click({ button: "right", position: { x: box.width / 2, y: 90 } });
  await menuItem(page, parent).click();
  await menuItem(page, child).click();
}

/** A visible element's box (fails the test when it isn't on screen). */
async function rect(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Not visible");
  return box;
}

/**
 * Poison invoices up to the story's pausing note at 10 s, replayed here with the same seed: the message
 * that dead-lettered last (read from the raw trace steps), and the newest one created that dead-lettered.
 */
function poisonDeadLetters(): { last: number; newest: number } {
  const diagram = JSON.parse(readFileSync(`src/examples/${AZURE}.json`, "utf8")) as DiagramFile;
  const poison = diagram.simulations?.find((s) => s.id === "poison");
  if (!poison) throw new Error("No Poison invoices simulation");
  const run = createSimulationRun(diagram, poison, { traceHistory: 160 });
  while (!run.state().waiting && !run.state().done) run.step(50);
  let last: { root: number; t: number } | undefined;
  let newest = 0;
  for (const { rootId } of run.engine.tracer.recent()) {
    const t = run.engine.tracer
      .get(rootId)
      ?.steps.filter((s) => s.kind === "deadletter")
      .at(-1)?.t;
    if (t === undefined) continue;
    newest = Math.max(newest, rootId);
    if (!last || t >= last.t) last = { root: rootId, t };
  }
  if (!last) throw new Error("Nothing dead-lettered");
  return { last: last.root, newest };
}

/** Attribute values of every hop row, in order. */
const hopAttr = (page: Page, name: string) =>
  hops(page).evaluateAll((els, n) => els.map((e) => e.getAttribute(n)), name);

/** Traces the next message from the Kafka storefront and waits for its whole journey. */
async function traceKafkaOrder(page: Page) {
  await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0&speed=4`);
  await openNodeMenu(page, "shopper", "sim.trace-next");
  await expect(card(page)).toHaveAttribute("data-state", "waiting");
  await expect(page.getByTestId("trace-waiting")).toContainText("Storefront");
  await page.getByTestId("trace-send-one").click();
  await expect(card(page)).toHaveAttribute("data-state", "done", { timeout: 20_000 });
}

test.describe("message trace", () => {
  test("focus in the trace card never moves or deletes the selected canvas node", async ({ page }) => {
    await traceKafkaOrder(page);
    const node = page.getByTestId("node-shopper");
    await page.waitForTimeout(1000); // Let the trace refit finish before measuring the node.
    const before = await rect(node);
    await page.getByTestId("trace-hops-list").focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Delete");
    await expect(node).toBeVisible();
    const after = await rect(node);
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  test("starting a waiting trace preserves keyboard focus on its close control or transfers Send to hops", async ({
    page,
  }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0&speed=4`);
    await openNodeMenu(page, "shopper", "sim.trace-next");
    await page.getByTestId("trace-send-one").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("trace-hops-list")).toBeFocused();
    await page.getByTestId("trace-card-close").click();
    await openNodeMenu(page, "shopper", "sim.trace-next");
    await page.getByTestId("trace-card-close").focus();
    // Trigger arrival without moving focus away from Close.
    await page.getByTestId("trace-send-one").evaluate((el: HTMLButtonElement) => el.click());
    await expect(page.getByTestId("trace-hops-list")).toBeVisible();
    await expect(page.getByTestId("trace-card-close")).toBeFocused();
    await page.getByTestId("trace-card-close").click();
    await openNodeMenu(page, "shopper", "sim.trace-next");
    await page.getByTestId("trace-send-one").focus();
    await page.getByTestId("trace-send-one").evaluate((el: HTMLButtonElement) => el.blur());
    await page.getByTestId("trace-send-one").evaluate((el: HTMLButtonElement) => el.click());
    await expect(page.getByTestId("trace-hops-list")).toBeVisible();
    await expect(page.getByTestId("trace-hops-list")).not.toBeFocused();
  });

  test("a replacement trace resets scroll-following even when its row count is unchanged", async ({ page }) => {
    await gotoLab(page, "trace-card-interaction");
    const list = page.getByTestId("trace-hops-list");
    const count = await hops(page).count();
    await list.evaluate((el) => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(await list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeGreaterThan(24);
    const oldRoot = await card(page).getAttribute("data-root");
    await page.getByTestId("trace-lab-replace").click();
    await expect(card(page)).not.toHaveAttribute("data-root", oldRoot ?? "");
    await expect(hops(page)).toHaveCount(count);
    await expect.poll(() => list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(24);
    await page.getByTestId("trace-lab-append").click();
    await expect(hops(page)).toHaveCount(count + 1);
    await expect.poll(() => list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(24);
  });
  test("a trace from a node's menu lists every hop, its copies and the total; Esc ends it", async ({
    page,
    consoleErrors,
  }) => {
    await traceKafkaOrder(page);
    const total = Number(await page.getByTestId("trace-total").getAttribute("data-ms"));
    expect(total).toBeGreaterThan(1500);
    expect(Number(await page.getByTestId("trace-hops").getAttribute("data-count"))).toBeGreaterThanOrEqual(12);
    // The order fans out: a copy reaches every consumer group, each with its own hops.
    expect(Number(await page.getByTestId("trace-copies").getAttribute("data-count"))).toBeGreaterThanOrEqual(4);
    const reached = await hopAttr(page, "data-node");
    for (const node of [
      "gateway",
      "orders",
      "order-events",
      "inventory",
      "payments",
      "notifications",
      "payment-events",
    ])
      expect(reached).toContain(node);
    expect((await hopAttr(page, "data-kind"))[0]).toBe("origin");
    await expect(page.getByTestId("trace-status")).toHaveAttribute("data-status", "done");

    // Esc backs out one level at a time: the right-clicked node's selection, then the trace.
    const mark = await interactionJournalMark(page);
    await page.keyboard.press("Escape");
    await expect(card(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card(page)).toHaveCount(0);
    // liveKeys rows X5 / X6 (the canvas or live view clears the selection, by where focus is), then X7.
    expect(await liveKeyLevels(page, mark)).toEqual([
      expect.stringMatching(/^escape:(canvas|selection)$/),
      "escape:trace",
    ]);
    // Esc backed out of the trace only: live view is still on.
    await expect(page.getByTestId("live-controls")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("the sequence dialog draws participants and arrows; copy as Mermaid; download SVG and PNG", async ({
    page,
    context,
    consoleErrors,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await traceKafkaOrder(page);
    await page.getByTestId("trace-sequence").click();
    const dialog = page.getByTestId("sequence-dialog");
    await expect(dialog).toBeVisible();
    const details = page.getByTestId("sequence-accessible");
    await expect(details).toHaveAttribute("aria-label", "Sequence details");
    await expect(page.getByTestId("sequence-participants")).toContainText("Storefront");
    await expect(page.getByTestId("sequence-messages")).toContainText("Storefront → Commerce gateway");
    await expect(page.getByTestId("sequence-messages")).toContainText("OrderRequest");
    await expect(page.getByTestId("sequence-messages")).toContainText("reply");
    await expect(page.getByTestId("sequence-messages")).toContainText("arrives +0.20 s. HTTPS");
    expect(await details.ariaSnapshot()).toContain("listitem");
    const view = page.getByTestId("sequence-view");
    const participants = Number(await view.getAttribute("data-participants"));
    expect(participants).toBeGreaterThanOrEqual(10);
    await expect(dialog.getByTestId(/^seq-participant-/)).toHaveCount(participants);
    await expect(dialog.getByTestId("seq-participant-shopper")).toBeVisible();
    const arrows = Number(await view.getAttribute("data-arrows"));
    expect(arrows).toBeGreaterThan(15);
    await expect(dialog.getByTestId(/^seq-arrow-/)).toHaveCount(arrows);
    const styles = await dialog
      .getByTestId(/^seq-arrow-/)
      .evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("data-style")))].sort());
    expect(styles).toEqual(["async", "reply", "sync"]);

    await page.getByTestId("sequence-copy-mermaid").click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("sequenceDiagram");
    const mermaid = await page.evaluate(() => navigator.clipboard.readText());
    expect(mermaid).toContain("participant shopper as Storefront");
    expect(mermaid).toMatch(/shopper->>gateway: OrderRequest/);
    expect(mermaid).toMatch(/orders-\)order_events: OrderPlaced/);

    const [svg] = await Promise.all([page.waitForEvent("download"), page.getByTestId("sequence-download-svg").click()]);
    expect(svg.suggestedFilename()).toMatch(/sequence\.svg$/);
    const text = readFileSync(await svg.path(), "utf8");
    expect(text.startsWith("<svg")).toBe(true);
    expect(text).toContain('data-testid="seq-participant-payments"');

    const [png] = await Promise.all([page.waitForEvent("download"), page.getByTestId("sequence-download-png").click()]);
    expect(png.suggestedFilename()).toMatch(/sequence\.png$/);
    expect(
      readFileSync(await png.path())
        .subarray(1, 4)
        .toString(),
    ).toBe("PNG");

    // Esc closes the dialog first, then the trace.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(card(page)).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("the live bar's ⋯ and the command palette start a trace", async ({ page, consoleErrors }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&speed=2`);
    // ⋯ offers the same three ways in as the right-click's "Trace a message ▸".
    await page.getByTestId("live-more").click();
    await page.getByTestId("live-trace-message").click();
    await expect(page.getByTestId("live-trace-slowest")).toBeVisible();
    await expect(page.getByTestId("live-trace-deadletter")).toBeVisible();
    await page.getByTestId("live-trace-next").click();
    await expect(page.getByTestId("live-more-menu")).toHaveCount(0);
    await expect(card(page)).toHaveAttribute("data-state", /flight|done/, { timeout: 10_000 });
    await page.getByTestId("trace-card-close").click();
    await expect(card(page)).toHaveCount(0);

    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("command-input").fill("slowest");
    await page.getByTestId("command-item-action:sim.trace-message:slowest").click();
    await expect(card(page)).toHaveAttribute("data-state", "done", { timeout: 10_000 });
    expectNoErrors(consoleErrors);
  });

  test("a dead-lettered trace on Poison invoices shows the retries and the DLQ hop", async ({
    page,
    consoleErrors,
  }) => {
    // Ask while paused at 0 s, before anything has dead-lettered: the card always waits and then follows
    // the first message to dead-letter (about 3.3 s), long before the story's pausing note at 10 s. Asked
    // while playing, it raced the run: whether a journey existed yet, and which one, depended on how long
    // the menu took to open.
    await page.clock.install();
    await gotoLive(page, `./?view=canvas&example=${AZURE}&live=1&sim=poison&speed=8&paused=1`);
    await openCanvasSubmenu(page, "sim.trace-message", "sim.trace-message:dead-letter");
    await expect(card(page)).toHaveAttribute("data-state", "waiting");
    await expect(page.getByTestId("trace-waiting")).toContainText("dead-letter");
    await waitForCameraIdle(page);
    await pauseClock(page);
    await page.getByTestId("live-play").click();
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
    // Eight simulated seconds include the DLQ hop, before the note at ten seconds pauses playback.
    await page.clock.runFor(1000);
    // "Dead-lettered" shows when the broker gives up; the message then travels 300 ms (sim) to the DLQ.
    // Wait for that last hop before reading the journey, or the list can still end at the dead letter.
    await expect(card(page)).toHaveAttribute("data-state", "dlq", { timeout: 20_000 });
    await expect(hops(page).last()).toHaveAttribute("data-kind", "dlq");
    await expect(page.getByTestId("trace-dlq")).toBeVisible();
    expect(Number(await page.getByTestId("trace-retries").getAttribute("data-count"))).toBeGreaterThan(0);
    const kinds = await hopAttr(page, "data-kind");
    expect(kinds).toContain("fail");
    expect(kinds).toContain("deadletter");
    expect(kinds.at(-1)).toBe("dlq");
    expect((await hopAttr(page, "data-node")).at(-1)).toBe("dlq");

    await page.clock.resume();
    await page.getByTestId("trace-sequence").click();
    await expect(page.getByTestId("sequence-messages")).toContainText("failed");
    await expect(page.getByTestId("sequence-messages")).toContainText("Dead-lettered");
    await expect(
      page
        .getByTestId("sequence-dialog")
        .getByTestId(/^seq-arrow-/)
        .last(),
    ).toHaveAttribute("data-style", "dlq");

    // By the pausing note at 10 s all 30 have dead-lettered, not in the order they were created: "One that
    // dead-lettered" follows the latest to dead-letter, not the newest message.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sequence-dialog")).toHaveCount(0);
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "waiting", { timeout: 20_000 });
    const { last, newest } = poisonDeadLetters();
    expect(last).not.toBe(newest);
    await page.getByTestId("live-more").click();
    await page.getByTestId("live-trace-message").click();
    await page.getByTestId("live-trace-deadletter").click();
    await expect(card(page)).toHaveAttribute("data-root", String(last));
    await expect(card(page)).toHaveAttribute("data-state", "dlq");
    expectNoErrors(consoleErrors);
  });

  test("traced labels never overlap each other or a node card, and tracing keeps the diagram's zoom", async ({
    page,
    consoleErrors,
  }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0&speed=0.5`);
    // A node card's on-screen width tells the zoom.
    const scaleOf = async () => (await page.getByTestId("node-shopper").boundingBox())?.width ?? 0;
    // Initial fitting animates, too. Sample only after both scheduled fits have settled.
    await page.waitForTimeout(1200);
    const before = await scaleOf();
    await openNodeMenu(page, "shopper", "sim.trace-next");
    await expect(page.getByTestId("trace-waiting")).toBeVisible();
    // The card opened and the view refitted: the wide diagram moved down, it didn't shrink.
    await page.waitForTimeout(1000); // 120 ms refit delay + 700 ms animation, plus frame margin.
    expect(await scaleOf()).toBeGreaterThan(before * 0.95);
    const traceBox = await rect(card(page));
    for (const id of KAFKA_NODES) {
      const nodeBox = await rect(page.getByTestId(`node-${id}`));
      expect(
        traceBox.x < nodeBox.x + nodeBox.width &&
          nodeBox.x < traceBox.x + traceBox.width &&
          traceBox.y < nodeBox.y + nodeBox.height &&
          nodeBox.y < traceBox.y + traceBox.height,
      ).toBe(false);
    }
    await page.getByTestId("trace-send-one").click();

    // Sample the labels (pane px, from the canvas) against every node card while the order fans out.
    const samples = await page.evaluate(async (ids) => {
      const out: { labels: number; overlaps: string[] }[] = [];
      type Box = { x: number; y: number; w: number; h: number };
      const canvas = document.querySelector<HTMLElement>('[data-testid="live-canvas"]');
      if (!canvas) return out;
      const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 60));
        const raw = canvas.dataset.traceLabels;
        if (!raw) continue;
        const labels = JSON.parse(raw) as (Box & { text: string })[];
        // The canvas covers the pane exactly: its box is the labels' origin.
        const base = canvas.getBoundingClientRect();
        const cards = ids.flatMap((id) => {
          const el = document.querySelector(`[data-testid="node-${id}"]`);
          if (!el) return [];
          const r = el.getBoundingClientRect();
          return [{ id, x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height }];
        });
        const overlaps: string[] = [];
        labels.forEach((a, i) => {
          labels.slice(i + 1).forEach((b) => hit(a, b) && overlaps.push(`${a.text} on ${b.text}`));
          cards.forEach((c) => hit(a, c) && overlaps.push(`${a.text} on node ${c.id}`));
        });
        out.push({ labels: labels.length, overlaps });
      }
      return out;
    }, KAFKA_NODES);
    expect(samples.length).toBeGreaterThan(10);
    // The fan-out puts several labels on screen at once…
    expect(Math.max(...samples.map((s) => s.labels))).toBeGreaterThanOrEqual(2);
    // …and none of them ever covers another or a node card (and so never a node's title).
    expect(samples.flatMap((s) => s.overlaps)).toEqual([]);
    expectNoErrors(consoleErrors);
  });

  test("the sequence dialog opens at the start, pins the participants and fits a wide journey", async ({
    page,
    consoleErrors,
  }) => {
    await traceKafkaOrder(page);
    await page.getByTestId("trace-sequence").click();
    const view = page.getByTestId("sequence-view");
    await expect(view).toBeVisible();
    // 13 participants don't fit 1440 px at a readable size: it scrolls, starting at the left.
    expect(await view.evaluate((el) => [el.scrollLeft, el.scrollTop])).toEqual([0, 0]);
    expect(await view.getAttribute("data-scale")).toBe("1.000");
    const first = page.getByTestId("seq-participant-shopper");
    const viewBox = await rect(view);
    const firstBox = await rect(first);
    expect(firstBox.x).toBeGreaterThanOrEqual(viewBox.x);
    expect(firstBox.x + firstBox.width).toBeLessThanOrEqual(viewBox.x + viewBox.width);

    // Scrolled to the end, the participant boxes stay pinned at the top, over the last arrows.
    await view.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    const header = page.getByTestId("sequence-header");
    await expect
      .poll(async () => {
        const h = await rect(header);
        const v = await rect(view);
        return Math.round(h.y + h.height - v.y);
      })
      .toBeGreaterThanOrEqual(40);
    const pinned = await rect(header);
    const last = await rect(page.getByTestId(/^seq-arrow-/).last());
    expect(last.y).toBeGreaterThanOrEqual(pinned.y + pinned.height - 1);

    // A wider window fits the whole journey without sideways scrolling.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect.poll(() => view.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    expect(Number(await view.getAttribute("data-scale"))).toBeLessThan(1);
    expectNoErrors(consoleErrors);
  });

  test("the trace card heads the Inputs panel's column instead of covering the diagram", async ({
    page,
    consoleErrors,
  }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await page.getByTestId("live-capacity").click();
    await expect(page.getByTestId("capacity-panel")).toBeVisible();
    await openNodeMenu(page, "shopper", "sim.trace-next");
    await expect(card(page)).toBeVisible();
    await expect
      .poll(async () => {
        const c = await rect(card(page));
        const p = await rect(page.getByTestId("capacity-panel"));
        // Same column, the card on top, no overlap.
        return Math.abs(c.x - p.x) < 2 && Math.abs(c.width - p.width) < 2 && c.y + c.height <= p.y;
      })
      .toBe(true);
    expectNoErrors(consoleErrors);
  });
});
