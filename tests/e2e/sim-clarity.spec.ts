import type { Page } from "@playwright/test";
import {
  test,
  expect,
  gotoCanvas,
  expectNoErrors,
  pageLoadTimeout,
  STORAGE_KEYS,
  waitForStableViewport,
} from "./fixtures";

/**
 * The live simulation explains itself (Round 30). The owner's diagram, built the way they built it: Incoming
 * traffic → .NET Service → Kafka Topic, and .NET Service → a generic node that later became App Configuration →
 * Key Vault. Live said "Kafka Topic can't keep up at all", the topic showed "No capacity · 2/s waiting" and a
 * climbing lag, raising partitions changed nothing, and every request went through App Configuration.
 * Selectors are data-testid only.
 */

const SLUG = "kafka-order-pipeline";
const KEY = STORAGE_KEYS.autosavePrefix + SLUG;

type Saved = {
  nodes: { id: string; stencil: string; label: string }[];
  edges: { id: string; from: string; to: string; relation?: string; relationOrigin?: string }[];
};

async function seed(page: Page) {
  const start = {
    format: "diagrams/v1",
    title: "Owner's diagram",
    nodes: [{ id: "in", stencil: "client.user", label: "Incoming traffic", x: 0, y: 200 }],
    edges: [],
  };
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("seeded", "1");
      }
    },
    [KEY, JSON.stringify(start)] as const,
  );
}

const saved = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null") as Saved | null, KEY);

/** Polls the autosave until `check` holds, and returns it. */
async function savedWhen(page: Page, check: (d: Saved) => boolean): Promise<Saved> {
  let last: Saved | null = null;
  await expect
    .poll(async () => {
      last = await saved(page);
      return !!last && check(last);
    })
    .toBe(true);
  return must(last, "the autosave");
}

/** A value the test needs: fails clearly when it's missing. */
function must<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`Expected ${what}`);
  return v;
}

/** Quick-add from a node (Alt+arrow), pick the first match for `query`, keep its name: returns the new node. */
async function quickAdd(page: Page, from: string, key: "ArrowRight" | "ArrowDown", query: string, stencil: string) {
  const before = (await saved(page))?.nodes.length ?? 1;
  await page.getByTestId(`node-${from}`).click();
  await expect(page.getByTestId(`grow-chip-${from}`)).toBeVisible();
  await page.keyboard.press(`Alt+${key}`);
  await expect(page.getByTestId("quick-add")).toBeVisible();
  await page.keyboard.type(query);
  await expect(page.getByTestId(`context-menu-item-quick-add:${stencil}`)).toHaveAttribute("data-active", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("node-editor-label")).toBeFocused();
  await page.keyboard.press("Escape");
  const d = await savedWhen(page, (s) => s.nodes.length === before + 1);
  const made = d.nodes.find((n) => n.stencil === stencil && !n.id.startsWith("in"));
  if (!made) throw new Error(`no ${stencil} node`);
  return made.id;
}

const backlog = async (page: Page, id: string) =>
  Number(await page.getByTestId(`node-badge-${id}`).getAttribute("data-backlog"));
const processed = async (page: Page, id: string) =>
  Number(await page.getByTestId(`node-badge-${id}`).getAttribute("data-processed"));

/** Of the next `frames` animation frames, how many showed messages travelling the edge (the live decorator's mark). */
const activeFrames = (page: Page, edgeId: string, frames: number) =>
  page.getByTestId(`edge-${edgeId}`).evaluate(
    (el, frames) =>
      new Promise<number>((resolve) => {
        let seen = 0,
          left = frames;
        const tick = () => {
          if (el.parentElement?.getAttribute("data-live-edge") === "active") seen++;
          if (--left > 0) requestAnimationFrame(tick);
          else resolve(seen);
        };
        requestAnimationFrame(tick);
      }),
    frames,
  );

test("the owner's diagram: config carries nothing, and a topic nobody reads says so", async ({
  page,
  consoleErrors,
}) => {
  test.setTimeout(90_000);
  await seed(page);
  await gotoCanvas(page, SLUG);
  await expect(page.getByTestId("node-in")).toBeVisible();
  await waitForStableViewport(page);

  // Built by quick-add, as the owner did.
  const api = await quickAdd(page, "in", "ArrowRight", ".net service", "service.dotnet");
  const topic = await quickAdd(page, api, "ArrowRight", "kafka topic", "kafka.topic");
  const cfg = await quickAdd(page, api, "ArrowDown", "generic service", "generic.service");
  await quickAdd(page, cfg, "ArrowRight", "key vault", "azure.key-vault");
  let d = await savedWhen(page, (s) => s.edges.length === 4);
  const toCfg = must(
    d.edges.find((e) => e.from === api && e.to === cfg),
    "the edge into the generic node",
  );
  // Drawn while the node was generic: a plain flow.
  expect(toCfg.relation).toBeUndefined();

  // The generic node becomes App Configuration: its flow from the service becomes Config, with a toast and Undo.
  await page.getByTestId(`node-${cfg}`).click();
  await page.getByTestId("inspector-field-stencil").click();
  await page.getByTestId("stencil-picker-search").fill("app configuration");
  await page.getByTestId("context-menu-item-pick-stencil:azure.app-config").click();
  await expect(page.getByTestId("toast").filter({ hasText: "1 connection is now Config" })).toContainText(
    "1 connection is now Config: no messages flow over it",
  );
  await expect(page.getByTestId("relation-reinfer-undo")).toBeVisible();
  await expect(page.getByTestId(`edge-${toCfg.id}`)).toHaveAttribute("data-relation", "config");
  d = await savedWhen(page, (s) => s.edges.some((e) => e.id === toCfg.id && e.relation === "config"));
  expect(d.edges.find((e) => e.id === toCfg.id)?.relationOrigin).toBe("inferred");

  // Its inspector says why nothing flows over it.
  await page.getByTestId(`edge-${toCfg.id}`).click({ force: true });
  await expect(page.getByTestId("inspector-relation-note")).toHaveText(
    "Read at startup and refreshed, not on every request, so no messages flow over it.",
  );

  // The topic's Partitions say what they do and don't do.
  await page.getByTestId(`node-${topic}`).click();
  await page.getByTestId("inspector-section-node-simulation").click();
  await expect(page.getByTestId("inspector-note-partitions")).toHaveText(
    "How many consumers in one group can work in parallel. It doesn't speed up publishing.",
  );

  // Live, with the heat map on.
  await page.getByTestId("live-toggle").click();
  await expect(page.getByTestId("live-controls")).toBeVisible({ timeout: pageLoadTimeout() });
  await page.getByTestId("view-button").click();
  await page.getByTestId("capacity-overlay-toggle").click();
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("bottleneck-headline")).toHaveText("Nobody reads Kafka Topic");
  await expect(page.getByTestId("bottleneck-callout")).not.toContainText("can't keep up");
  // Requests reach the service, never App Configuration.
  await expect.poll(() => processed(page, api), { timeout: 20_000 }).toBeGreaterThan(2);
  expect(await activeFrames(page, toCfg.id, 60)).toBe(0);
  // The topic keeps what's published: no lag (it has no consumer group), no "No capacity".
  await expect.poll(() => backlog(page, topic), { timeout: 20_000 }).toBeGreaterThan(1);
  const metric = page.getByTestId(`node-metric-${topic}`);
  await expect(metric).toContainText("Nobody reads this yet");
  await expect(metric).toContainText("kept");
  await expect(metric).not.toContainText("lag");
  await expect(page.getByTestId(`node-badge-${topic}`)).not.toContainText("No capacity");

  // Its hover card says the same: kept, not lag.
  await page.getByTestId(`node-${topic}`).hover();
  await expect(page.getByTestId(`node-detail-unread-${topic}`)).toBeVisible();
  await expect(page.getByTestId(`node-detail-${topic}`)).toContainText("Kept");
  await expect(page.getByTestId(`node-detail-${topic}`)).not.toContainText("Lag (max group)");
  await page.mouse.move(5, 5);

  // Add a consumer: one click, and what the topic kept drains.
  const kept = await backlog(page, topic);
  await page.getByTestId("bottleneck-add-consumer").click();
  await expect(page.getByTestId("toast").filter({ hasText: "Added a consumer" })).toContainText(
    "Added a consumer of Kafka Topic.",
  );
  d = await savedWhen(page, (s) => s.nodes.some((n) => n.label === "Kafka Topic consumer"));
  const consumer = must(
    d.nodes.find((n) => n.label === "Kafka Topic consumer"),
    "the consumer",
  );
  expect(consumer.stencil).toBe("service.dotnet");
  expect(d.edges.some((e) => e.from === topic && e.to === consumer.id && !e.relation)).toBe(true);
  await expect(page.getByTestId("bottleneck-headline")).not.toHaveText("Nobody reads Kafka Topic");
  await expect(page.getByTestId(`node-badge-${topic}`)).not.toContainText("kept");
  await expect.poll(() => backlog(page, topic)).toBeLessThan(kept);
  await expect.poll(() => processed(page, consumer.id), { timeout: 20_000 }).toBeGreaterThan(0);
  expectNoErrors(consoleErrors);
});
