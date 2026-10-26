import { pauseClock, waitForCameraIdle, test, expect, gotoCanvas, expectNoErrors } from "./fixtures";
import {
  SLUG,
  callTool,
  installFakeModelContext,
  must,
  nodeCount,
  openAdvanced,
  openAiPanel,
  settle,
  toolNames,
} from "./ai-helpers";

// Agents first: a browser agent changes the diagram through the page's WebMCP tools (a fake
// document.modelContext here, installed before the app loads), and each change is a turn in the AI
// panel with Undo this change and Revert to here. The app never asks for an API key.

test.describe("an agent's changes in the AI panel", () => {
  test.beforeEach(async ({ page }) => {
    await installFakeModelContext(page);
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId("node-payments")).toBeVisible();
    await expect.poll(async () => (await toolNames(page)).length).toBe(7);
  });

  test("an edit becomes a turn with the agent's note, Undo this change and Revert to here", async ({
    page,
    consoleErrors,
  }) => {
    const before = await nodeCount(page);
    // The panel is folded: the agent's change is recorded anyway.
    const res = await callTool(page, "edit_diagram", {
      ops: [
        { op: "add_node", kind: "Redis cache", label: "orders-cache", key: "c" },
        { op: "connect", from: "orders", to: "c", kind: "sync" },
      ],
      summary: "Added a Redis cache in front of the order service",
    });
    expect(res.isError).toBe(false);
    await expect.poll(() => nodeCount(page)).toBe(before + 1);

    await openAiPanel(page);
    const turn = page.getByTestId("ai-turn-0");
    await expect(turn).toHaveAttribute("data-engine", "agent");
    await expect(page.getByTestId("ai-turn-0-who")).toContainText("Agent · Edited the diagram");
    await expect(turn).toContainText("Added a Redis cache in front of the order service");
    await expect(page.getByTestId("ai-turn-0-summary")).toHaveText("+1 node, +1 connection");

    // Hovering it outlines what it touched.
    await turn.hover();
    await expect
      .poll(() => page.evaluate(() => document.querySelector("style[data-ai-mark]")?.textContent ?? ""))
      .toContain("react-flow__node");

    // Undo this change takes back exactly this call.
    await page.getByTestId("ai-turn-0-undo").click();
    await expect.poll(() => nodeCount(page)).toBe(before);
    await expect(page.getByTestId("ai-turn-0-undone")).toBeVisible();

    // Revert to here brings it back, as one undo step and a turn of its own.
    await page.getByTestId("ai-turn-0-revert").click();
    await expect.poll(() => nodeCount(page)).toBe(before + 1);
    await expect(page.getByTestId("ai-turn-1")).toHaveAttribute("data-kind", "revert");
    await expect(page.getByTestId("ai-turn-1-undo")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("a second call stacks: only the latest offers Undo, and a simulation is a turn too", async ({ page }) => {
    await openAiPanel(page);
    await callTool(page, "edit_diagram", {
      ops: [{ op: "add_node", kind: "Redis cache", label: "orders-cache" }],
      summary: "Added a cache",
    });
    await callTool(page, "set_simulation", {
      title: "Agent storm",
      traffic: [{ from: "shopper", pattern: "burst", count: 20 }],
      summary: "A burst of 20 orders",
    });
    await expect(page.getByTestId("ai-turn-1-who")).toContainText("Set a simulation");
    await expect(page.getByTestId("ai-turn-1-summary")).toHaveText("Added simulation “Agent storm”");
    await expect(page.getByTestId("ai-turn-1-undo")).toBeVisible();
    await expect(page.getByTestId("ai-turn-0-undo")).toHaveCount(0);
    // The earlier turn can still be returned to.
    await expect(page.getByTestId("ai-turn-0-revert")).toBeVisible();
  });

  test("with the panel open, no tool's change shows a toast: the turn carries the Undo", async ({ page }) => {
    await openAiPanel(page);
    const aiToast = page.getByTestId("toast").filter({ hasText: /^AI:/ });
    await callTool(page, "edit_diagram", {
      ops: [{ op: "add_node", kind: "Redis cache", label: "orders-cache" }],
      summary: "Added a cache",
    });
    await expect(page.getByTestId("ai-turn-0-undo")).toBeVisible();
    // Screen readers still hear about it.
    await expect(page.getByTestId("ai-announce")).toHaveText("AI: +1 node");
    await callTool(page, "set_simulation", {
      title: "Agent storm",
      traffic: [{ from: "shopper", pattern: "burst", count: 20 }],
    });
    await expect(page.getByTestId("ai-turn-1-undo")).toBeVisible();
    await expect(page.getByTestId("ai-announce")).toHaveText("AI: Added simulation “Agent storm”");
    await expect(aiToast).toHaveCount(0);
    await expect(page.getByTestId("ai-toast-undo")).toHaveCount(0);
    const res = await callTool(page, "new_diagram", { title: "Agent sketch" });
    expect(res.isError).toBe(false);
    // The new diagram's own thread opens with the agent's turn.
    await expect(page.getByTestId("ai-turn-0-who")).toContainText("Started a new diagram");
    await expect(page.getByTestId("ai-turn-0")).toContainText("Agent sketch");
    await expect(aiToast).toHaveCount(0);
    await expect(page.getByTestId("ai-toast-undo")).toHaveCount(0);
    // Its turn keeps the starting point: after an edit, Revert to here goes back to it.
    await callTool(page, "edit_diagram", { ops: [{ op: "add_node", kind: "Redis cache", label: "cache" }] });
    await expect.poll(() => nodeCount(page)).toBe(1);
    await page.getByTestId("ai-turn-0-revert").click();
    await expect.poll(() => nodeCount(page)).toBe(0);
  });

  test("folded, an agent's change shows a toast that goes once the panel opens", async ({ page }) => {
    await callTool(page, "set_simulation", {
      title: "Agent storm",
      traffic: [{ from: "shopper", pattern: "burst", count: 20 }],
    });
    await expect(page.getByTestId("ai-toast-undo")).toBeVisible();
    await openAiPanel(page);
    await expect(page.getByTestId("ai-turn-0-undo")).toBeVisible();
    await expect(page.getByTestId("ai-toast-undo")).toHaveCount(0);
  });

  test("folded, agent changes count on the rail without opening the panel or moving the canvas", async ({ page }) => {
    // A first visit starts folded.
    await expect(page.getByTestId("ai-rail-open")).toBeVisible();
    await expect(page.getByTestId("ai-dock")).toHaveCount(0);
    const rail = page.getByTestId("ai-rail-open");
    await expect(rail).toHaveAccessibleName("AI panel");
    await expect(page.getByTestId("ai-rail-badge")).toHaveCount(0);
    const pane = await page.getByTestId("canvas-wrap").boundingBox();

    await callTool(page, "edit_diagram", {
      ops: [{ op: "add_node", kind: "Redis cache", label: "orders-cache" }],
    });
    await expect(page.getByTestId("ai-rail-badge")).toHaveText("1");
    await expect(rail).toHaveAccessibleName("AI panel, 1 new change");
    await callTool(page, "set_simulation", {
      title: "Agent storm",
      traffic: [{ from: "shopper", pattern: "burst", count: 20 }],
    });
    await expect(page.getByTestId("ai-rail-badge")).toHaveText("2");
    await expect(rail).toHaveAccessibleName("AI panel, 2 new changes");
    await expect(page.getByTestId("ai-dock")).toHaveCount(0);
    // The layout around the canvas didn't change (the view inside it is the next test).
    expect(await page.getByTestId("canvas-wrap").boundingBox()).toEqual(pane);

    // Opening shows them and clears the count; folding again leaves it clear.
    await openAiPanel(page);
    await expect(page.getByTestId("ai-turn-1")).toBeVisible();
    await page.getByTestId("ai-collapse").click();
    await expect(rail).toHaveAccessibleName("AI panel");
    await expect(page.getByTestId("ai-rail-badge")).toHaveCount(0);
  });

  test("an agent's change off screen leaves the person's view where they put it", async ({ page }) => {
    // Zoom in on payments by hand: the shopper (far left) goes off screen.
    const payments = page.getByTestId("node-payments");
    const b = must(await payments.boundingBox(), "payments");
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    // Literal Control: a trackpad pinch emits ctrl+wheel on every OS.
    await page.keyboard.down("Control");
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -200);
    await page.keyboard.up("Control");
    await settle(page);
    const before = must(await payments.boundingBox(), "payments zoomed");
    expect(before.width).toBeGreaterThan(b.width);

    await page.clock.install();
    await pauseClock(page);
    await callTool(page, "edit_diagram", {
      ops: [{ op: "update", target: "shopper", props: { sublabel: "Web and mobile" } }],
      layout: "none",
    });
    await expect(page.getByTestId("ai-rail-badge")).toHaveText("1");
    // Advance the delayed reveal check; camera readiness covers any resulting move.
    await page.clock.runFor(600);
    await page.clock.resume();
    await waitForCameraIdle(page);
    await settle(page);
    expect(await payments.boundingBox()).toEqual(before);
  });

  test("the idle panel says the page's tools are available in this browser", async ({ page }) => {
    await openAiPanel(page);
    await expect(page.getByTestId("ai-agent-status")).toHaveAttribute("data-available", "1");
    await expect(page.getByTestId("ai-agent-status-text")).toHaveText(
      "This page publishes 7 tools for AI agents in this browser (WebMCP).",
    );
    await expect(page.getByTestId("ai-llms-link")).toHaveCount(0);
  });
});

test("the panel starts folded, then opens or stays folded as it was left", async ({ page }) => {
  await gotoCanvas(page, SLUG);
  await expect(page.getByTestId("ai-rail-open")).toBeVisible();
  await expect(page.getByTestId("ai-dock")).toHaveCount(0);
  await openAiPanel(page);
  await page.reload();
  await expect(page.getByTestId("ai-panel")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("ai-collapse").click();
  await page.reload();
  await expect(page.getByTestId("node-payments")).toBeVisible();
  await expect(page.getByTestId("ai-rail-open")).toBeVisible();
  await expect(page.getByTestId("ai-dock")).toHaveCount(0);
});

test("without WebMCP the panel points agents that drive pages to llms.txt", async ({ page }) => {
  await gotoCanvas(page, SLUG);
  await openAiPanel(page);
  await expect(page.getByTestId("ai-agent-status")).toHaveAttribute("data-available", "0");
  await expect(page.getByTestId("ai-llms-link")).toHaveAttribute("href", /llms\.txt$/);
  await expect(page.getByTestId("ai-empty")).toContainText("Each change appears here");
});

test("there's no API key anywhere, and a key stored by the removed setting is deleted on load", async ({
  page,
  consoleErrors,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem(
        "diagrams.ai-model.v1",
        JSON.stringify({ provider: "anthropic", model: "claude-haiku-5-5", key: "sk-ant-old-0000" }),
      );
    }
  });
  await gotoCanvas(page, SLUG);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("diagrams.ai-model.v1"))).toBeNull();

  await openAdvanced(page);
  for (const id of ["ai-connect-toggle", "ai-connect", "ai-key", "ai-key-save", "ai-connect-link", "ai-send"])
    await expect(page.getByTestId(id)).toHaveCount(0);
  const text = await page.evaluate(() => document.body.innerText);
  expect(text).not.toMatch(/api key|connect a model|your own model/i);
  // Nothing in the page reaches for a model provider.
  const scripts = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((n) => /api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com/.test(n)),
  );
  expect(scripts).toEqual([]);
  expectNoErrors(consoleErrors);
});
