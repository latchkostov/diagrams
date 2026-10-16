import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { DiagramFile } from "../../src/model/types";
import { routingFixture, ROUTING_TABLE } from "../../src/lab/routingFixture";
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  pauseClock,
  waitForStableViewport,
  expectNoErrors,
  STORAGE_KEYS,
  savedDiagram,
} from "./fixtures";

// Request routing R1 in the browser: adding a table and a mix from the inspector, keyboard reordering, weights and
// Default, Undo, the Live legend in words, a traced refusal and the repair a deleted target offers.
const slug = "kafka-order-pipeline";

/** The routing fixture without any routing: a Kong-style gateway in front of three services. */
function unrouted(): DiagramFile {
  const d = routingFixture();
  d.planning = { revision: "p3-a1" };
  d.nodes = d.nodes.map((n) => {
    const props = { ...n.props };
    delete props.trafficMix;
    delete props.routeTable;
    return { ...n, props };
  });
  return d;
}
const props = (d: DiagramFile, id: string) => d.nodes.find((n) => n.id === id)?.props ?? {};

async function seed(page: Page, d: DiagramFile, { dark = false } = {}) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
  await page.addInitScript(
    ({ key, d }) => {
      localStorage.setItem(key, JSON.stringify(d));
      localStorage.setItem("diagrams.inspector.open.v1", JSON.stringify({ "node-simulation": true }));
    },
    { key: STORAGE_KEYS.autosavePrefix + slug, d },
  );
}

const table = async (page: Page) =>
  props(await savedDiagram(page), "kong").routeTable as typeof ROUTING_TABLE | undefined;

test("adds a route table that keeps today's connections, edits a rule, reorders by keyboard and undoes", async ({
  page,
  consoleErrors,
}) => {
  await seed(page, unrouted());
  await gotoCanvas(page, slug);
  await waitForStableViewport(page);
  await page.getByTestId("node-kong").click();
  await page.getByTestId("routes-add").click();
  // The first table forwards everything as before: a Default over every outgoing connection.
  await expect(page.getByTestId("routes-default")).toContainText("Orders");
  await expect.poll(async () => (await table(page))?.default?.targets.length).toBe(3);
  expect((await savedDiagram(page)).planning?.requestRoutes).toEqual([]);

  // Two rules; the second matches POST /orders exactly.
  await page.getByTestId("routes-add-rule").click();
  await page.getByTestId("routes-add-rule").click();
  await page.getByTestId("routes-rule-rule-2-match-method-GET").uncheck();
  await page.getByTestId("routes-rule-rule-2-match-method-POST").check();
  await page.getByTestId("routes-rule-rule-2-match-kind").selectOption("exact");
  await page.getByTestId("routes-rule-rule-2-match-path").fill("/orders");
  // Rule 1 (GET /* prefix) catches everything rule 2 would only for GET: no shadow warning.
  await expect(page.getByTestId("routes-shadowed-rule-2")).toHaveCount(0);
  await expect
    .poll(async () => (await table(page))?.rules[1]?.match)
    .toEqual({
      methods: ["POST"],
      path: { kind: "exact", value: "/orders" },
    });

  // Alt+ArrowUp moves the focused rule, announced; ids never change.
  await page.getByTestId("routes-rule-rule-2").focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.getByTestId("routes-announce")).toHaveText("Moved to 1 of 2.");
  await expect.poll(async () => (await table(page))?.rules.map((r) => r.id)).toEqual(["rule-2", "rule-1"]);

  // Weights: 9 and 1 on the moved rule's targets.
  // Still open since it was added.
  await page.getByTestId("routes-rule-rule-2-targets-kong-canary").check();
  await page.getByTestId("routes-rule-rule-2-targets-kong-orders-weight").fill("9");
  await expect
    .poll(async () => (await table(page))?.rules[0]?.targets)
    .toEqual([
      { edgeId: "kong-orders", weight: 9 },
      { edgeId: "kong-canary", weight: 1 },
    ]);
  await expect(page.getByTestId("routes-rule-rule-2")).toContainText("90 / 10");

  // Default: Reject 404 is an explicit choice.
  await page.getByTestId("routes-default").click();
  await page.getByTestId("routes-default-reject").check();
  await expect(page.getByTestId("routes-default")).toContainText("Reject 404");
  await expect.poll(async () => (await table(page))?.default).toBeUndefined();

  // Undo puts the Default back, Redo takes it away again.
  await page.getByTestId("canvas-view").click({ position: { x: 5, y: 400 } });
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await table(page))?.default?.targets.length).toBe(3);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await table(page))?.default).toBeUndefined();
  expectNoErrors(consoleErrors);
});

test("a source's traffic mix: new routes, shares that must add up, Normalize", async ({ page }) => {
  await seed(page, unrouted());
  await gotoCanvas(page, slug);
  await waitForStableViewport(page);
  await page.getByTestId("node-app").click();
  await page.getByTestId("mix-add-route-new").click();
  await page.getByTestId("mix-new-route-method").selectOption("POST");
  await page.getByTestId("mix-new-route-path").fill("/orders");
  await page.getByTestId("mix-new-route-add").click();
  await expect(page.getByTestId("mix-row-post-orders")).toBeVisible();
  // Every route is in the mix already: Add route opens a new one.
  await page.getByTestId("mix-add-route-new").click();
  await page.getByTestId("mix-new-route-path").fill("/search");
  await page.getByTestId("mix-new-route-add").click();
  await expect(page.getByTestId("mix-row-get-search-value")).toHaveValue("50");
  // 30 + 50 isn't 100: shown, not saved, until Normalize.
  await page.getByTestId("mix-row-post-orders-value").fill("30");
  await expect(page.getByTestId("mix-off")).toContainText("80%");
  await page.getByTestId("mix-normalize").click();
  await expect(page.getByTestId("mix-off")).toHaveCount(0);
  await expect
    .poll(async () => {
      const mix = props(await savedDiagram(page), "app").trafficMix as {
        entries: { routeId: string; share: number }[];
      };
      return mix.entries.map((e) => [e.routeId, Math.round(e.share * 1000) / 1000]);
    })
    .toEqual([
      ["post-orders", 0.375],
      ["get-search", 0.625],
    ]);
  // Each new route got its own colour and marker.
  const routes = (await savedDiagram(page)).planning?.requestRoutes ?? [];
  expect(routes.map((r) => r.appearance)).toEqual([
    { paletteSlot: 0, marker: "circle" },
    { paletteSlot: 1, marker: "circle" },
  ]);
});

test("deleting a service a rule sends to is refused with a repair that removes it from the table", async ({ page }) => {
  await seed(page, routingFixture());
  await gotoCanvas(page, slug);
  await waitForStableViewport(page);
  await page.getByTestId("node-search").click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("node-search")).toBeVisible();
  await page.getByTestId("toast-routing-repair").click();
  await expect(page.getByTestId("node-search")).toHaveCount(0);
  // The search rule had nowhere left to send: removed with it, never widened to another connection.
  await expect.poll(async () => (await table(page))?.rules.map((r) => r.id)).toEqual(["orders"]);
});

test("Live: the Routes legend in words, refusals counted, a traced 404 explained", async ({ page }) => {
  // Only GET /search is sent, and only POST /orders has a rule: every request is refused 404.
  const d = routingFixture({ rate: 10, mix: { mode: "shares", entries: [{ routeId: "search-get", share: 1 }] } });
  d.nodes[1].props = { ...d.nodes[1].props, routeTable: { ...ROUTING_TABLE, rules: ROUTING_TABLE.rules.slice(0, 1) } };
  await seed(page, d);
  await page.clock.install();
  await gotoLive(page, `./?view=canvas&example=${slug}&live=1&paused=1`);
  await waitForStableViewport(page);
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  await page.clock.runFor(5_000);
  if ((await page.getByTestId("inspector").getAttribute("data-collapsed")) === "1")
    await page.getByTestId("inspector-toggle").click();
  const legend = page.getByTestId("request-routes");
  await expect(legend).toBeVisible();
  // Not colour alone: each row names its look and address in words.
  await expect(page.getByTestId("request-route-search-get-row")).toHaveAttribute(
    "aria-label",
    /GET \/search, sky blue circle\. \d+ sent · 0 done · \d+ refused/,
  );
  await expect(page.getByTestId("request-route-orders-post-row")).toContainText("POST /orders");
  // A refused request, traced: the card says why.
  await page.getByTestId("node-kong").click({ button: "right" });
  await page.getByTestId("context-menu-item-sim.trace-next").click();
  await page.clock.runFor(3_000);
  await expect(page.getByTestId("trace-card")).toContainText("GET /search · no route: rejected 404");
});

for (const dark of [false, true])
  test(`route table and legend pass axe in the ${dark ? "dark" : "light"} theme`, async ({ page }) => {
    await seed(page, routingFixture(), { dark });
    await gotoCanvas(page, slug);
    await waitForStableViewport(page);
    await page.getByTestId("node-kong").click();
    await page.getByTestId("routes-rule-orders").click();
    const results = await new AxeBuilder({ page })
      .include('[data-testid="inspector"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
