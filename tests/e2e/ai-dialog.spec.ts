import { test, expect, gotoCanvas, expectNoErrors } from "./fixtures";
import { MOD, SLUG, must, nodeCount, openAdvanced, openAiPanel, savedDiagram, settle } from "./ai-helpers";

// The AI panel's Advanced flow: describe, copy a prompt for any chatbot, paste its reply, apply.
// Selectors are data-testid only. Uses the public Kafka example (ids from src/examples/kafka-order-pipeline.json).

const GOOD = [
  { op: "add_node", kind: ".NET consumer", label: "billing-worker", key: "w" },
  { op: "add_node", kind: "PostgreSQL", label: "billing-db", key: "db" },
  { op: "connect", from: "orders.created.v1", to: "w" },
  { op: "connect", from: "w", to: "db", kind: "sync" },
];
const fenced = (v: unknown) => "Here are the ops:\n```json\n" + JSON.stringify(v, null, 2) + "\n```\nAnything else?";

test.describe("AI panel: Advanced copy and paste", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId("node-payments")).toBeVisible();
  });

  test("opens from the rail, Ctrl+I, the canvas right-click and the command palette", async ({
    page,
    consoleErrors,
  }) => {
    await openAiPanel(page);
    await expect(page.getByTestId("ai-panel")).toBeFocused();

    await page.getByTestId("ai-collapse").click();
    await expect(page.getByTestId("ai-panel")).toHaveCount(0);
    // Folded, it's a slim rail that stays on screen; its button has the keyboard.
    await expect(page.getByTestId("ai-rail-open")).toBeFocused();
    await page.getByTestId("ai-rail-open").click();
    await expect(page.getByTestId("ai-panel")).toBeFocused();
    await page.keyboard.press(`${MOD}+i`);
    await expect(page.getByTestId("ai-panel")).toHaveCount(0);
    await settle(page);

    const box = must(await page.getByTestId("canvas-wrap").boundingBox(), "the canvas");
    await page.getByTestId("canvas-wrap").click({ button: "right", position: { x: box.width / 2, y: 90 } });
    await page.getByTestId("context-menu-item-canvas.ai-panel").click();
    await expect(page.getByTestId("ai-panel")).toBeVisible();
    await page.getByTestId("ai-collapse").click();
    await expect(page.getByTestId("ai-panel")).toHaveCount(0);

    await page.keyboard.press(`${MOD}+k`);
    await page.getByTestId("command-input").fill("ai panel");
    await page.getByTestId("command-item-action:canvas.ai-panel").click();
    await expect(page.getByTestId("ai-panel")).toBeVisible();
    // The panel isn't modal: the diagram behind it stays usable.
    await page.getByTestId("node-shopper").click();
    await expect(page.getByTestId("inspector")).toHaveAttribute("data-inspector-target", "shopper");
    await expect(page.getByTestId("dock-tab-properties")).toHaveAttribute("aria-selected", "true");
    await page.getByTestId("dock-tab-ai").click();
    await expect(page.getByTestId("ai-panel")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("copies a prompt with the diagram, the ops format, examples and the request", async ({ page }) => {
    await openAdvanced(page);
    await page.getByTestId("ai-request").fill("Add a billing worker that writes to Postgres");
    await page.getByTestId("ai-copy-prompt").click();
    await expect(page.getByTestId("ai-copy-prompt")).toContainText("Copied");
    const prompt = await page.evaluate(() => navigator.clipboard.readText());
    expect(prompt).toContain("Add a billing worker that writes to Postgres");
    expect(prompt).toContain("payments"); // describe_diagram of the open diagram
    expect(prompt).toContain('"add_node"');
    expect(prompt).toContain("Example 2");
    await expect(page.getByTestId("ai-reply")).toBeFocused();
  });

  test("applies a pasted reply as one undo step, with stencils, a toast and history", async ({
    page,
    consoleErrors,
  }) => {
    const before = await nodeCount(page);
    await openAdvanced(page);
    await page.getByTestId("ai-request").fill("Billing reads orders and writes to Postgres");
    await page.getByTestId("ai-reply").fill(fenced(GOOD));
    await expect(page.getByTestId("ai-reply-status")).toHaveText("4 ops ready");
    await page.getByTestId("ai-apply").click();

    await expect(page.getByTestId("ai-error")).toHaveCount(0);
    await expect(page.getByTestId("ai-turn-0-summary")).toHaveText("+2 nodes, +2 connections");
    // With the panel open the turn has the Undo: no second one on a toast.
    await expect(page.getByTestId("toast")).toHaveCount(0);
    expect(await nodeCount(page)).toBe(before + 2);
    // The boxes clear for the next turn.
    await expect(page.getByTestId("ai-request")).toHaveValue("");
    await expect(page.getByTestId("ai-reply")).toHaveValue("");

    await expect.poll(async () => (await savedDiagram(page))?.nodes.length).toBe(before + 2);
    const saved = must(await savedDiagram(page), "saved edits");
    const worker = must(
      saved.nodes.find((n) => n.label === "billing-worker"),
      "billing-worker",
    );
    const db = must(
      saved.nodes.find((n) => n.label === "billing-db"),
      "billing-db",
    );
    expect(worker.stencil).toBe("service.dotnet");
    expect(db.stencil).toBe("postgres");
    await expect(page.getByTestId(`node-${worker.id}`)).toBeVisible();
    expect(saved.edges.some((e) => e.from === "order-events" && e.to === worker.id)).toBe(true);
    expect(saved.edges.some((e) => e.from === worker.id && e.to === db.id && e.kind === "sync")).toBe(true);

    // One undo step reverts the whole turn.
    await page.getByTestId("ai-turn-0-undo").click();
    await expect.poll(() => nodeCount(page)).toBe(before);
    await expect(page.getByTestId(`node-${worker.id}`)).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("keeps turns: each change is its own undo step", async ({ page }) => {
    const before = await nodeCount(page);
    await openAdvanced(page);
    await page.getByTestId("ai-reply").fill(JSON.stringify(GOOD));
    await page.getByTestId("ai-apply").click();
    await expect(page.getByTestId("ai-turn-0")).toBeVisible();

    await page.getByTestId("ai-request").fill("Add a dead-letter queue after billing-worker");
    await page.getByTestId("ai-reply").fill(
      JSON.stringify([
        { op: "add_node", kind: "Service Bus queue", label: "billing-dlq", key: "q" },
        { op: "connect", from: "billing-worker", to: "q" },
      ]),
    );
    await page.keyboard.press(`${MOD}+Enter`);
    await expect(page.getByTestId("ai-turn-1-summary")).toHaveText("+1 node, +1 connection");
    expect(await nodeCount(page)).toBe(before + 3);

    // Undo takes back only the second turn.
    await page.getByTestId("ai-turn-1-undo").click();
    await expect.poll(() => nodeCount(page)).toBe(before + 2);
  });

  test("a bad reply applies nothing, shows candidates and a fix-up prompt; a candidate applies", async ({
    page,
    consoleErrors,
  }) => {
    const before = await nodeCount(page);
    await openAdvanced(page);
    await page.getByTestId("ai-request").fill("Rename the payment service");
    const bad = [{ op: "update", target: "Payment", label: "Payments API" }];
    await page.getByTestId("ai-reply").fill(fenced(bad));
    await page.getByTestId("ai-apply").click();

    await expect(page.getByTestId("ai-error")).toBeVisible();
    await expect(page.getByTestId("ai-error-message")).toContainText("matches");
    await expect(page.getByTestId("ai-candidate-payments")).toBeVisible();
    await expect(page.getByTestId("ai-candidate-payment-db")).toBeVisible();
    expect(await nodeCount(page)).toBe(before);

    await page.getByTestId("ai-copy-fix").click();
    const fix = await page.evaluate(() => navigator.clipboard.readText());
    expect(fix).toContain("nothing was applied");
    expect(fix).toContain("matches");
    expect(fix).toContain("id payments:");
    expect(fix).toContain("Rename the payment service");
    expect(fix).toContain('"target": "Payment"');

    // One click on a candidate patches the op and applies it.
    await page.getByTestId("ai-candidate-payments").click();
    await expect(page.getByTestId("ai-error")).toHaveCount(0);
    await expect(page.getByTestId("ai-turn-0-summary")).toHaveText("1 changed");
    await expect(page.getByTestId("node-payments")).toContainText("Payments API");
    expectNoErrors(consoleErrors);
  });

  test("explains a reply with no JSON", async ({ page }) => {
    await openAdvanced(page);
    await page.getByTestId("ai-reply").fill("Sorry, I can't draw diagrams.");
    await expect(page.getByTestId("ai-reply-status")).toHaveText("There's no JSON in the reply.");
    await page.getByTestId("ai-apply").click();
    await expect(page.getByTestId("ai-error-message")).toHaveText("There's no JSON in the reply.");
    await expect(page.getByTestId("ai-copy-fix")).toBeVisible();
  });

  test("an unsure stencil shows its alternatives and swaps in one click", async ({ page }) => {
    await openAdvanced(page);
    // "function" could be AWS Lambda, Azure Functions or Cloud Functions: the resolver isn't sure.
    await page
      .getByTestId("ai-reply")
      .fill(JSON.stringify([{ op: "add_node", kind: "function", label: "resize-images" }]));
    await page.getByTestId("ai-apply").click();
    await expect(page.getByTestId("ai-turn-0")).toBeVisible();
    await expect
      .poll(async () => (await savedDiagram(page))?.nodes.some((n) => n.label === "resize-images"))
      .toBe(true);
    const node = must(
      must(await savedDiagram(page), "saved edits").nodes.find((n) => n.label === "resize-images"),
      "the node",
    );
    await expect(page.getByTestId(`ai-choice-${node.id}`)).toContainText("not sure");
    await page.getByTestId(`ai-swap-${node.id}-azure.functions`).click();
    await expect
      .poll(async () => (await savedDiagram(page))?.nodes.find((n) => n.id === node.id)?.stencil)
      .toBe("azure.functions");
    // The choice now reads as settled, and the old pick is one click away.
    await expect(page.getByTestId(`ai-choice-${node.id}`)).not.toContainText("not sure");
    await expect(page.getByTestId(`ai-swap-${node.id}-${node.stencil}`)).toBeVisible();
  });
});

test("a full diagrams/v1 file without coordinates replaces the diagram, laid out", async ({ page }) => {
  await gotoCanvas(page, SLUG);
  await openAdvanced(page);
  const file = {
    format: "diagrams/v1",
    title: "Orders",
    nodes: [
      { id: "api", stencil: "service.dotnet", label: "orders-api" },
      { id: "topic", stencil: "kafka.topic", label: "Kafka", sublabel: "orders.created" },
      { id: "db", stencil: "postgres", label: "orders-db" },
    ],
    edges: [
      { id: "e1", from: "api", to: "topic" },
      { id: "e2", from: "api", to: "db", kind: "sync" },
    ],
  };
  await page.getByTestId("ai-reply").fill(fenced(file));
  await expect(page.getByTestId("ai-reply-status")).toContainText("replaces this one");
  await page.getByTestId("ai-apply").click();
  await expect(page.getByTestId("ai-turn-0-summary")).toContainText("Replaced the diagram: 3 nodes, 2 connections");
  await expect.poll(() => nodeCount(page)).toBe(3);
  for (const id of ["api", "topic", "db"]) await expect(page.getByTestId(`node-${id}`)).toBeVisible();
  await page.getByTestId("ai-turn-0-undo").click();
  await expect(page.getByTestId("node-payments")).toBeVisible();
});
