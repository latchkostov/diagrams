import type { Locator, Page } from "@playwright/test";
import { test, expect, gotoCanvas, gotoLive, expectNoErrors, STORAGE_KEYS, waitForStableBox } from "./fixtures";

/**
 * Hover cards stack above every node on the canvas: a node drawn after the hovered one (its card, its border, its
 * live status or capacity ring) never paints over the card. Owner report: in live view, the green capacity ring of
 * the service under a Kafka topic showed through the topic's stats card.
 *
 * The badge layer ignores the pointer (`pointer-events: none`), so `elementFromPoint` can't see what it paints. Each
 * probe makes the cards and every node's overlay hit-testable for one synchronous call (no event can run in
 * between, so the hover stays put), asks what's on top at points inside the card where the other node is, and puts
 * things back. Hit-testing follows paint order. Selectors are data-testid only.
 */

const SLUG = "kafka-order-pipeline";

interface Diagram {
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
  groups?: unknown[];
}

function diagram(d: Diagram) {
  return { format: "diagrams/v1", title: "Hover stacking", groups: [], ...d };
}

/** The diagram the example's slug opens (its autosave), on the first load only. */
async function seed(page: Page, d: Diagram) {
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("seeded", "1");
      }
    },
    [STORAGE_KEYS.autosavePrefix + SLUG, JSON.stringify(diagram(d))] as const,
  );
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("Expected a visible element");
  return b;
}

/**
 * The share of probe points, inside both the card and `under` (grown by `margin` px for rings drawn outside a
 * node), where the card is what's on top. 1 when the card covers everything there.
 */
async function cardOnTop(page: Page, card: string, under: string, margin = 8): Promise<number> {
  return page.evaluate(
    ([cardId, underId, margin]) => {
      const cardEl = document.querySelector<HTMLElement>(`[data-testid="${cardId}"]`);
      const underEl = document.querySelector<HTMLElement>(`[data-testid="${underId}"]`);
      if (!cardEl || !underEl) throw new Error("card or node missing");
      const style = document.createElement("style");
      style.textContent = `[data-testid="${cardId}"], [data-testid="${cardId}"] *,
        [data-testid^="node-badge-"], [data-testid^="node-badge-"] *,
        [data-testid^="capacity-node-"], [data-testid^="capacity-node-"] * { pointer-events: auto !important; }`;
      document.head.append(style);
      try {
        const c = cardEl.getBoundingClientRect();
        const u = underEl.getBoundingClientRect();
        // Clear of the card's rounded corners, which aren't hit-testable.
        const left = Math.max(c.left + 12, u.left - margin);
        const right = Math.min(c.right - 12, u.right + margin);
        const top = Math.max(c.top + 12, u.top - margin);
        const bottom = Math.min(c.bottom - 12, u.bottom + margin);
        if (right <= left || bottom <= top) throw new Error("the card doesn't overlap the node: move the node");
        let hits = 0,
          total = 0;
        for (let i = 0; i <= 6; i++)
          for (let j = 0; j <= 6; j++) {
            const el = document.elementFromPoint(left + ((right - left) * i) / 6, top + ((bottom - top) * j) / 6);
            total++;
            if (el && cardEl.contains(el)) hits++;
          }
        return hits / total;
      } finally {
        style.remove();
      }
    },
    [card, under, margin] as const,
  );
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`hover cards stack above nodes (${theme})`, () => {
    test.use({ colorScheme: theme });

    test("a live node's stats card covers the node below it, its ring included", async ({ page, consoleErrors }) => {
      await seed(page, {
        nodes: [
          { id: "in", stencil: "client.user", label: "Incoming traffic", x: 0, y: 0 },
          { id: "topic", stencil: "kafka.topic", label: "Kafka Topic", x: 300, y: 0 },
          // Right under the topic, where its card opens; paused, so it has a status ring.
          { id: "svc", stencil: "service.java", label: "Java Service", x: 300, y: 130, props: { status: "paused" } },
        ],
        edges: [
          { id: "e1", from: "in", to: "topic", kind: "async" },
          { id: "e2", from: "topic", to: "svc", kind: "async" },
        ],
      });
      await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1&speed=4`);
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
      // Show capacity too: the owner saw the green heat-map ring.
      await page.keyboard.press("c");
      await expect(page.getByTestId("node-badge-svc")).toBeVisible();
      await waitForStableBox(page.getByTestId("node-topic"));
      const topic = await box(page.getByTestId("node-topic"));
      await page.mouse.move(topic.x + topic.width / 2, topic.y + topic.height / 2);
      await expect(page.getByTestId("node-detail-topic")).toBeVisible();
      expect(await cardOnTop(page, "node-detail-topic", "node-badge-svc")).toBe(1);
      expect(await cardOnTop(page, "node-detail-topic", "node-svc")).toBe(1);
      expectNoErrors(consoleErrors);
    });

    test("a node's dependency list covers the node below it", async ({ page, consoleErrors }) => {
      await seed(page, {
        nodes: [
          { id: "api", stencil: "service.dotnet", label: "Orders API", x: 0, y: 0 },
          { id: "cfg", stencil: "azure.app-config", label: "App Configuration", x: 400, y: 0 },
          { id: "below", stencil: "service.java", label: "Java Service", x: -40, y: 110 },
        ],
        edges: [{ id: "dep", from: "api", to: "cfg", relation: "config" }],
      });
      await gotoCanvas(page, SLUG);
      await page.getByTestId("view-button").click();
      await page.getByTestId("dependencies-toggle").click();
      await page.keyboard.press("Escape");
      const pips = page.getByTestId("node-pips-api");
      await waitForStableBox(pips);
      await pips.hover();
      await expect(page.getByTestId("node-dependencies-api")).toBeVisible();
      expect(await cardOnTop(page, "node-dependencies-api", "node-below", 0)).toBe(1);
      expectNoErrors(consoleErrors);
    });

    test("live, a config edge's settings card covers the node and its ring above it", async ({
      page,
      consoleErrors,
    }) => {
      await seed(page, {
        nodes: [
          { id: "api", stencil: "service.dotnet", label: "Orders API", x: 0, y: 200 },
          { id: "cfg", stencil: "azure.app-config", label: "App Configuration", x: 640, y: 200 },
          // Over the edge's middle, where its settings card opens upwards; paused, so it has a ring.
          { id: "above", stencil: "service.java", label: "Java Service", x: 330, y: 90, props: { status: "paused" } },
        ],
        edges: [
          {
            id: "dep",
            from: "api",
            to: "cfg",
            relation: "config",
            props: {
              settings: ["Orders:PageSize", "Orders:Region", "Orders:Retry", "Orders:Timeout"].map((key) => ({ key })),
            },
          },
        ],
      });
      await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1`);
      await expect(page.getByTestId("node-badge-above")).toHaveAttribute("data-status", "paused");
      const pill = page.getByTestId("edge-label-dep");
      await waitForStableBox(pill);
      await pill.hover();
      await expect(page.getByTestId("edge-settings-dep")).toBeVisible();
      expect(await cardOnTop(page, "edge-settings-dep", "node-badge-above")).toBe(1);
      expect(await cardOnTop(page, "edge-settings-dep", "node-above", 0)).toBe(1);
      expectNoErrors(consoleErrors);
    });
  });
}
