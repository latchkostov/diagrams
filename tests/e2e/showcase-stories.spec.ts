import type { Page } from "@playwright/test";
import { test, expect, gotoLive, pauseClock, waitForStableViewport, expectNoErrors } from "./fixtures";

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
  {
    slug: "recommendations-feature-store",
    sim: "friday-night",
    signals: [
      ["ranker-v7", "desired", 4],
      ["feature-server", "processed", 0],
    ],
  },
  {
    slug: "video-on-demand-pipeline",
    sim: "premiere-uploads",
    signals: [
      ["uhd-enc", "desired", 1],
      ["packager", "processed", 0],
    ],
  },
  {
    slug: "observability-pipeline",
    sim: "log-storm",
    signals: [
      ["gateways", "desired", 3],
      ["ingesters", "processed", 0],
    ],
  },
  {
    slug: "hybrid-enterprise-network",
    sim: "leicester-fibre-cut",
    signals: [
      ["lte", "processed", 0],
      ["hub", "processed", 0],
    ],
  },
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
