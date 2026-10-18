import type { Locator, Page } from "@playwright/test";
import { test, expect, gotoCanvas, gotoLive, pauseClock, waitForStableViewport, expectNoErrors } from "./fixtures";

const showcases = [
  { slug: "partitions-vs-subscriptions", signal: "log", field: "backlog" },
  { slug: "shared-api-quotas", signal: "answer", field: "rejected" },
  { slug: "serverless-burst-buffer", signal: "direct", field: "rejected" },
  { slug: "measured-order-capacity", signal: "queue", field: "backlog", sim: "triple" },
  { slug: "contoso-dmz", signal: "firewall", field: "blocked" },
  { slug: "shared-worker-pool", signal: "order-log", field: "backlog" },
] as const;

async function positive(page: Page, node: string, field: string) {
  const badge = page.getByTestId(`node-badge-${node}`);
  await expect(badge).toBeVisible();
  await expect.poll(async () => Number(await badge.getAttribute(`data-${field}`))).toBeGreaterThan(0);
}

async function expectExposed(control: Locator) {
  await expect(control).toBeInViewport({ ratio: 1 });
  await expect
    .poll(() =>
      control.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return [0.2, 0.5, 0.8].every((x) =>
          [0.2, 0.5, 0.8].every((y) => el.contains(document.elementFromPoint(r.x + r.width * x, r.y + r.height * y))),
        );
      }),
    )
    .toBe(true);
}

// Read the actual rendered node and label boxes; only data-testid selectors.
async function overlaps(page: Page) {
  return page.evaluate(() => {
    const boxes = (selector: string) =>
      [...document.querySelectorAll(selector)].map((el) => ({
        id: el.getAttribute("data-testid"),
        box: el.getBoundingClientRect(),
      }));
    const nodes = boxes('[data-testid^="rf__node-"]:not([data-testid^="rf__node-group:"])');
    const boundaries = boxes('[data-testid^="rf__node-group:"]');
    const labels = boxes('[data-testid^="edge-label-"]');
    const hits: string[] = [];
    const hit = (a: DOMRect, b: DOMRect) =>
      a.left + 0.5 < b.right && b.left + 0.5 < a.right && a.top + 0.5 < b.bottom && b.top + 0.5 < a.bottom;
    for (let i = 0; i < boundaries.length; i++)
      for (const other of boundaries.slice(i + 1))
        if (hit(boundaries[i].box, other.box)) hits.push(`${boundaries[i].id} / ${other.id}`);
    for (let i = 0; i < nodes.length; i++)
      for (const other of nodes.slice(i + 1))
        if (hit(nodes[i].box, other.box)) hits.push(`${nodes[i].id} / ${other.id}`);
    for (let i = 0; i < labels.length; i++)
      for (const other of [...nodes, ...labels.slice(i + 1)])
        if (hit(labels[i].box, other.box)) hits.push(`${labels[i].id} / ${other.id}`);
    return hits;
  });
}

for (const theme of ["light", "dark"] as const)
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ])
    test.describe(`${theme} ${viewport.width}`, () => {
      test.use({ colorScheme: theme, viewport });
      for (const showcase of showcases)
        test(`${showcase.slug} shows its feature in Live`, async ({ page, consoleErrors }, info) => {
          test.slow();
          const simulation = "sim" in showcase ? `&sim=${showcase.sim}` : "";
          await page.clock.install();
          await gotoLive(page, `./?view=canvas&example=${showcase.slug}&live=1${simulation}`);
          await pauseClock(page);
          // Finish the initial fit on the controlled clock before measuring geometry.
          await page.clock.runFor(1000);
          await waitForStableViewport(page);
          if (viewport.width === 390) {
            const title = await page.getByTestId("diagram-card").boundingBox();
            const toggle = await page.getByTestId("live-toggle").boundingBox();
            expect(title).not.toBeNull();
            expect(toggle).not.toBeNull();
            if (!title || !toggle) throw new Error("Expected visible title and Live toggle");
            expect(title.height).toBeLessThan(toggle.height * 2);
            const titleText = page.getByTestId("diagram-title");
            expect(await titleText.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
            const bar = await page.getByTestId("live-controls").boundingBox();
            expect(bar).not.toBeNull();
            if (!bar) throw new Error("Expected visible playback bar");
            for (const id of [
              "live-play",
              "live-restart",
              "live-speed",
              "live-sim-picker",
              "live-capacity",
              "live-more",
            ]) {
              const control = await page.getByTestId(id).boundingBox();
              expect(control, id).not.toBeNull();
              if (!control) throw new Error(`Expected visible ${id}`);
              expect(control.x, id).toBeGreaterThanOrEqual(bar.x);
              expect(control.x + control.width, id).toBeLessThanOrEqual(bar.x + bar.width);
              expect(
                await page.getByTestId(id).evaluate((el) => {
                  const r = el.getBoundingClientRect();
                  return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
                }),
                `${id} is not covered by a side rail`,
              ).toBe(true);
            }
          }
          await page.getByTestId("live-restart").click();
          await page.clock.runFor(8000);
          await positive(page, showcase.signal, showcase.field);
          if (showcase.slug === "partitions-vs-subscriptions") {
            await expect(page.getByTestId("capacity-idle-log-readers")).toHaveAttribute("data-idle", "5");
            await expect(page.getByTestId("capacity-idle-receipts")).toHaveCount(0);
            await positive(page, "receipts", "processed");
            await positive(page, "audit", "processed");
          }
          if (showcase.slug === "shared-api-quotas") {
            await positive(page, "review", "rejected");
            await positive(page, "payments", "rejected");
            await expect(page.getByTestId("node-rejected-answer")).toContainText("Rejected");
            await expect(page.getByTestId("node-badge-answer")).toHaveAttribute("data-failed", "0");
          }
          if (showcase.slug === "serverless-burst-buffer") {
            await positive(page, "queue", "backlog");
            await positive(page, "async-results", "processed");
            await expect(page.getByTestId("node-badge-async")).toHaveAttribute("data-rejected", "0");
          }
          if (showcase.slug === "contoso-dmz") {
            await positive(page, "database", "processed");
            await expect(page.getByTestId("node-badge-admin")).toHaveAttribute("data-processed", "0");
            await expect(page.getByTestId("node-badge-firewall")).toHaveAttribute("data-failed", "0");
          }
          if (showcase.slug === "shared-worker-pool") await positive(page, "refund-log", "backlog");
          expect(await overlaps(page)).toEqual([]);
          const filename = `${showcase.slug}-${theme}-${viewport.width}.png`;
          await page.mouse.move(0, 0);
          const body = await page.screenshot({ path: info.outputPath(filename) });
          await info.attach(filename, { body, contentType: "image/png" });
          if (viewport.width === 390) {
            // Exercise the controls after capturing the normal opening state: Inputs enables the heat map.
            await page.getByTestId("live-play").click();
            await page.getByTestId("live-play").click();
            await page.getByTestId("live-capacity").click();
            await expect(page.getByTestId("live-capacity")).toHaveAttribute("aria-pressed", "true");
            await page.getByTestId("live-capacity").click();
            await expect(page.getByTestId("live-capacity")).toHaveAttribute("aria-pressed", "false");
            await page.getByTestId("live-more").click();
            await expect(page.getByTestId("live-more-menu")).toBeVisible();
            await page.keyboard.press("Escape");
          }
          expectNoErrors(consoleErrors);
        });
    });

/** The large showcases: each saved story shows its feature within eight seconds of Live, at desktop size. */
const largeShowcases = [
  {
    slug: "black-friday-commerce",
    sim: "doors-open",
    signals: [
      ["gateway", "rejected", 0],
      ["checkout-api", "desired", 2],
    ],
  },
  {
    slug: "cell-based-bookings",
    sim: "region-evacuation",
    signals: [["west-c1-api", "processed", 0]],
    down: "east-alb",
  },
  {
    slug: "payments-ledger",
    sim: "psp-brownout",
    signals: [
      ["adyen", "failed", 0],
      ["stripe", "processed", 0],
    ],
  },
  {
    slug: "delivery-dispatch",
    sim: "partition-ceiling",
    signals: [
      ["locations-topic", "backlog", 0],
      ["geo-indexer", "desired", 3],
    ],
  },
  { slug: "ev-charging-network", sim: "vendor-shell", signals: [["depot-fw", "blocked", 0]], zone: "zone-ot" },
] as const;

for (const theme of ["light", "dark"] as const)
  test.describe(`large showcases ${theme} 1920`, () => {
    test.use({ colorScheme: theme, viewport: { width: 1920, height: 1080 } });
    for (const showcase of largeShowcases)
      test(`${showcase.slug} tells its story in Live`, async ({ page, consoleErrors }, info) => {
        test.slow();
        await page.clock.install();
        await gotoLive(page, `./?view=canvas&example=${showcase.slug}&live=1&sim=${showcase.sim}`);
        await pauseClock(page);
        await page.clock.runFor(1000);
        await waitForStableViewport(page);
        await page.getByTestId("live-restart").click();
        await page.clock.runFor(8000);
        await expect(page.getByTestId("live-note")).toBeVisible();
        for (const [node, field, above] of showcase.signals) {
          const badge = page.getByTestId(`node-badge-${node}`);
          await expect(badge).toBeAttached();
          await expect.poll(async () => Number(await badge.getAttribute(`data-${field}`))).toBeGreaterThan(above);
        }
        if ("down" in showcase)
          await expect(page.getByTestId(`node-badge-${showcase.down}`)).toHaveAttribute("data-status", "down");
        // Nested boundaries sit inside their parents on purpose; the unit suite checks siblings never overlap.
        const nested = /^rf__node-group:.* \/ rf__node-group:/;
        // A zone is drawn behind the nodes and labels it encloses, by design.
        const zone = "zone" in showcase ? `rf__node-${showcase.zone}` : undefined;
        expect(
          (await overlaps(page)).filter((hit) => !nested.test(hit) && !(zone && hit.split(" / ").includes(zone))),
        ).toEqual([]);
        const filename = `${showcase.slug}-${theme}-1920.png`;
        await page.mouse.move(0, 0);
        const body = await page.screenshot({ path: info.outputPath(filename) });
        await info.attach(filename, { body, contentType: "image/png" });
        expectNoErrors(consoleErrors);
      });
  });

test.describe("mobile title card", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("keeps checks and Undo available while folding the description", async ({ page }) => {
    await gotoCanvas(page, "partitions-vs-subscriptions");
    await expect(page.getByTestId("checks-count")).toBeVisible();
    await page.getByTestId("node-receipts").click();
    await page.keyboard.press("ArrowRight");
    // Editing an example makes an owned copy; Undo is its recovery action.
    await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
    await expect(page.getByTestId("checks-count")).toBeVisible();
    await expect(page.getByTestId("reset-diagram")).toHaveCount(0);
    await page.getByTestId("undo-button").click();
    await expect(page.getByTestId("undo-button")).toBeDisabled();
    await expect(page.getByTestId("redo-button")).toBeEnabled();
    for (const id of ["example-picker", "view-button", "file-button", "theme-toggle"]) {
      const control = page.getByTestId(id);
      await control.focus();
      await expect(control).toBeFocused();
      await control.scrollIntoViewIfNeeded();
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      if (!bounds) throw new Error(`Expected visible ${id}`);
      // Scroll offsets round to device pixels; allow their subpixel remainder.
      expect(bounds.x, id).toBeGreaterThanOrEqual(-0.5);
      expect(bounds.x + bounds.width, id).toBeLessThanOrEqual(390.5);
    }
  });
});

test.describe("phone live panels", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("playback leaves the expanded AI footer exposed and Inputs folds the dock", async ({ page }) => {
    await gotoLive(page, "./?view=canvas&example=partitions-vs-subscriptions&live=1");
    await page.getByTestId("ai-rail-open").click();
    const advanced = page.getByTestId("ai-advanced-toggle");
    await expectExposed(advanced);
    await advanced.focus();
    await expect(advanced).toBeFocused();
    const footer = await advanced.boundingBox();
    const bar = await page.getByTestId("live-controls").boundingBox();
    expect(footer && bar && footer.y + footer.height < bar.y).toBe(true);
    await expectExposed(page.getByTestId("live-play"));
    await page.getByTestId("live-capacity").click();
    await expect(page.getByTestId("ai-dock")).toHaveCount(0);
    await expect(page.getByTestId("ai-rail-open")).toBeVisible();
    await expectExposed(page.getByTestId("capacity-heading"));
    await expectExposed(page.getByTestId("live-play"));
  });

  test("Inputs folds an already expanded AI dock", async ({ page }) => {
    await gotoLive(page, "./?view=canvas&example=partitions-vs-subscriptions&live=1");
    await page.getByTestId("ai-rail-open").click();
    await expect(page.getByTestId("ai-panel")).toBeVisible();
    await page.getByTestId("live-capacity").click();
    await expect(page.getByTestId("ai-dock")).toHaveCount(0);
    await expect(page.getByTestId("ai-rail-open")).toBeVisible();
    await expectExposed(page.getByTestId("capacity-heading"));
  });

  test("Inputs stays visible and editable above playback", async ({ page }, info) => {
    await page.clock.install();
    await gotoLive(page, "./?view=canvas&example=partitions-vs-subscriptions&live=1&sim=compare");
    await expect(page.getByTestId("live-note")).toBeVisible();
    await pauseClock(page);
    await page.getByTestId("live-capacity").click();
    const panel = page.getByTestId("capacity-panel");
    await expect(panel).toBeInViewport({ ratio: 1 });
    await expectExposed(page.getByTestId("capacity-heading"));
    await page.getByTestId("live-more").click();
    await page.getByTestId("live-events-toggle").click();
    await expect(page.getByTestId("live-events")).toBeVisible();
    await expectExposed(panel);
    await expect
      .poll(async () => {
        const bounds = await panel.boundingBox();
        const bar = await page.getByTestId("live-controls").boundingBox();
        return !!bounds && !!bar && bounds.y + bounds.height <= bar.y;
      })
      .toBe(true);
    const input = page.getByTestId("capacity-traffic-mult");
    await expectExposed(input);
    await input.focus();
    await input.press("End");
    await expect(input).toHaveAttribute("data-value", "10");
    await expect(page.getByTestId("capacity-traffic-mult-value")).toHaveText("10×");
    await expect(page.getByTestId("capacity-dirty")).toBeVisible();
    await page.screenshot({ path: info.outputPath("phone-inputs-narration-log.png") });
    await page.getByTestId("capacity-close").click();
    await expect(panel).toHaveCount(0);
    await expectExposed(page.getByTestId("diagram-card"));
  });

  test("More stays exposed with Inputs open", async ({ page }, info) => {
    await gotoLive(page, "./?view=canvas&example=partitions-vs-subscriptions&live=1");
    await page.getByTestId("live-capacity").click();
    await expect(page.getByTestId("capacity-panel")).toBeInViewport({ ratio: 1 });
    await page.getByTestId("live-more").click();
    await expectExposed(page.getByTestId("live-more-menu"));
    await expectExposed(page.getByTestId("live-traffic"));
    await page.getByTestId("live-traffic").click();
    await expect(page.getByTestId("live-traffic")).toHaveAttribute("aria-checked", "false");
    await page.getByTestId("live-traffic").focus();
    await page.getByTestId("live-traffic").press("Space");
    await expect(page.getByTestId("live-traffic")).toHaveAttribute("aria-checked", "true");
    await page.screenshot({ path: info.outputPath("phone-inputs-more.png") });
    await page.getByTestId("live-more").click();
    await page.getByTestId("capacity-close").click();
  });

  test("expectations stay exposed with Inputs open", async ({ page }, info) => {
    await gotoLive(page, "./?view=canvas&example=partitions-vs-subscriptions&live=1&sim=compare");
    await page.getByTestId("live-capacity").click();
    await expect(page.getByTestId("capacity-panel")).toBeInViewport({ ratio: 1 });
    await page.getByTestId("live-expectations-summary").click();
    await expectExposed(page.getByTestId("live-expectations-list"));
    await page.screenshot({ path: info.outputPath("phone-inputs-expectations.png") });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("live-expectations-list")).toHaveCount(0);
    await expect(page.getByTestId("live-expectations-summary")).toBeFocused();
    await expect(page.getByTestId("capacity-panel")).toBeVisible();
    await page.getByTestId("capacity-close").click();
  });
});

/** A known note in each large story, and the cards it brings into view. */
const narrations = [
  {
    slug: "black-friday-commerce",
    sim: "doors-open",
    at: 4500,
    text: "Doors open",
    focus: ["gateway", "checkout-api"],
  },
  {
    slug: "cell-based-bookings",
    sim: "region-evacuation",
    at: 5500,
    text: "us-east-1 goes dark",
    focus: ["dns", "east-alb"],
  },
  {
    slug: "payments-ledger",
    sim: "psp-brownout",
    at: 4500,
    text: "Adyen starts failing",
    focus: ["psp-router", "adyen"],
  },
  {
    slug: "delivery-dispatch",
    sim: "partition-ceiling",
    at: 5500,
    text: "KEDA scales to eight",
    focus: ["locations-topic", "geo-indexer"],
  },
  {
    slug: "ev-charging-network",
    sim: "vendor-shell",
    at: 6500,
    text: "deny rule stops",
    focus: ["depot-fw", "depot-switch"],
  },
] as const;

const boxOf = async (page: Page, testId: string) => {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`No box for ${testId}`);
  return box;
};
const clear = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 390, height: 844 },
])
  test.describe(`large showcases focus the current narration at ${viewport.width}`, () => {
    test.use({ viewport });
    for (const n of narrations)
      test(`${n.slug}: “${n.text}” brings its cards into view`, async ({ page }) => {
        test.slow();
        await page.clock.install();
        // The overview first: free play fits the whole diagram, so its cards' width is the zoom to beat.
        await gotoLive(page, `./?view=canvas&example=${n.slug}&live=1`);
        await waitForStableViewport(page);
        const overview = (await boxOf(page, `rf__node-${n.focus[0]}`)).width;
        await gotoLive(page, `./?view=canvas&example=${n.slug}&live=1&sim=${n.sim}`);
        await pauseClock(page);
        await page.clock.runFor(1000);
        await waitForStableViewport(page);
        await page.getByTestId("live-restart").click();
        await page.clock.runFor(n.at);
        await expect(page.getByTestId("live-note")).toContainText(n.text);
        // Let the narration camera finish its move.
        await page.clock.runFor(1500);
        await waitForStableViewport(page);
        const canvas = await boxOf(page, "canvas-wrap");
        const note = await boxOf(page, "live-note");
        const bar = await boxOf(page, "live-controls");
        for (const id of n.focus) {
          const card = await boxOf(page, `rf__node-${id}`);
          expect(card.x, id).toBeGreaterThanOrEqual(canvas.x - 0.5);
          expect(card.y, id).toBeGreaterThanOrEqual(canvas.y - 0.5);
          expect(card.x + card.width, id).toBeLessThanOrEqual(canvas.x + canvas.width + 0.5);
          expect(card.y + card.height, id).toBeLessThanOrEqual(canvas.y + canvas.height + 0.5);
          expect(clear(card, note), `${id} clear of the note`).toBe(true);
          expect(clear(card, bar), `${id} clear of the playback bar`).toBe(true);
          // The camera fitted the note's focus: on a desktop, cards render at 60% or more (220 px cards).
          if (viewport.width >= 1280) expect(card.width, id).toBeGreaterThanOrEqual(132);
        }
        // Never further out than the overview. (On a phone both sit at the canvas's 15% minimum zoom: the note pans
        // to its cards; see docs/backlog/2026-10-18-phone-narration-zoom.md.)
        const close = (await boxOf(page, `rf__node-${n.focus[0]}`)).width;
        expect(close).toBeGreaterThanOrEqual(overview - 0.5);
      });
  });

test("dispatch opens the requested partition-ceiling story", async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=delivery-dispatch&live=1&sim=partition-ceiling");
  await pauseClock(page);
  await expect(page.getByTestId("live-sim-picker")).toHaveValue("partition-ceiling");
  await page.clock.runFor(1000);
  await waitForStableViewport(page);
  await page.getByTestId("live-restart").click();
  await page.clock.runFor(5500);
  await expect(page.getByTestId("live-note")).toContainText("KEDA scales to eight indexers and stops");
  // Before the 12 s partition change, eight partitions hold the indexers at eight (the dinner rush peaks at five).
  await page.clock.runFor(5000);
  const indexers = page.getByTestId("node-badge-geo-indexer");
  await expect(indexers).toHaveAttribute("data-ready", "8");
  await expect(indexers).toHaveAttribute("data-desired", "8");
});
