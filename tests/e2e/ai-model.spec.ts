import type { Page, Request } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors } from "./fixtures";
import { MOD, SLUG, must, nodeCount, openAskAi, savedDiagram } from "./ai-helpers";
import { readFileSync } from "node:fs";
import { join } from "node:path";
/** Where "payments" is in flow coordinates: the saved edits, or the example as shipped when there are none. */
async function paymentsX(page: import("@playwright/test").Page) {
  const saved = (await savedDiagram(page))?.nodes.find((n) => n.id === "payments");
  if (saved) return (saved as unknown as { x: number }).x;
  const original = JSON.parse(readFileSync(join(process.cwd(), "src/examples/kafka-order-pipeline.json"), "utf8")) as {
    nodes: { id: string; x: number }[];
  };
  return must(
    original.nodes.find((n) => n.id === "payments"),
    "payments",
  ).x;
}

// Ask AI with a connected model (the user's own key), against a mocked Anthropic API: page.route answers
// every call, so no request leaves the machine.

const KEY = "sk-ant-api03-E2ESECRET0123456789abcdef";
const MODEL_KEY = "diagrams.ai-model.v1";

const sse = (events: object[]) => events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join("");

/** The model asks for edit_diagram once, then says what it did. */
const TOOL_TURN = sse([
  { type: "message_start", message: {} },
  { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu_1", name: "edit_diagram" } },
  {
    type: "content_block_delta",
    index: 0,
    delta: {
      type: "input_json_delta",
      partial_json: JSON.stringify({
        ops: [
          { op: "add_node", kind: "Redis cache", label: "orders-cache", key: "c" },
          { op: "connect", from: "orders", to: "c", kind: "sync" },
        ],
      }),
    },
  },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "tool_use" } },
]);
const TEXT_TURN = sse([
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Added orders-cache " } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "<b>next to</b> orders-api." } },
  { type: "message_delta", delta: { stop_reason: "end_turn" } },
]);

/** Answers Anthropic calls in order; anything else on the network to a model provider fails the test. */
type MockBody = string | { status: number; body: string } | (() => Promise<string>);

async function mockAnthropic(page: Page, bodies: MockBody[]) {
  const seen: Request[] = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    seen.push(route.request());
    const scripted = bodies[seen.length - 1] ?? TEXT_TURN;
    // A function holds the response until the test releases it.
    const next = typeof scripted === "function" ? await scripted() : scripted;
    if (typeof next === "string")
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: next, headers: CORS });
    else await route.fulfill({ status: next.status, contentType: "application/json", body: next.body, headers: CORS });
  });
  for (const host of ["https://api.openai.com/**", "https://generativelanguage.googleapis.com/**"])
    await page.route(host, (route) => route.abort());
  return seen;
}
const CORS = { "access-control-allow-origin": "*" };

async function connect(page: Page) {
  await page.getByTestId("ai-connect-toggle").click();
  await expect(page.getByTestId("ai-key-note")).toContainText("Stored only in this browser and sent only to Anthropic");
  await page.getByTestId("ai-key").fill(KEY);
  await page.getByTestId("ai-key-save").click();
  await expect(page.getByTestId("ai-engine")).toHaveText("Claude Haiku 5.5 · your key");
}

test.describe("Ask AI with your own key", () => {
  test.beforeEach(async ({ page }) => {
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId("node-payments")).toBeVisible();
    await openAskAi(page);
  });

  test("connects, sends, streams the reply as text and applies the tool calls as one undo step", async ({
    page,
    consoleErrors,
  }) => {
    const seen = await mockAnthropic(page, [TOOL_TURN, TEXT_TURN]);
    await connect(page);
    const before = await nodeCount(page);
    await page.getByTestId("ai-request").fill("Put a Redis cache in front of the orders API");
    await page.getByTestId("ai-request").press("Enter");

    await expect(page.getByTestId("ai-turn-0-summary")).toHaveText("+1 node, +1 connection");
    // Model output is text, never HTML.
    await expect(page.getByTestId("ai-turn-0")).toContainText("Added orders-cache <b>next to</b> orders-api.");
    expect(await nodeCount(page)).toBe(before + 1);
    await expect(page.getByTestId("ai-request")).toHaveValue("");

    expect(seen).toHaveLength(2);
    const headers = seen[0].headers();
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(headers["x-api-key"]).toBe(KEY);
    const body = seen[0].postDataJSON() as {
      model: string;
      tools: { name: string }[];
      messages: { content: string }[];
    };
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.tools.map((t) => t.name)).toEqual([
      "describe_diagram",
      "find_stencils",
      "edit_diagram",
      "set_simulation",
    ]);
    expect(body.messages[0].content).toContain("payments"); // the diagram, described
    expect(body.messages[0].content).toContain("Put a Redis cache in front of the orders API");

    // One undo step takes the whole turn back.
    await page.getByTestId("ai-turn-0-undo").click();
    await expect.poll(() => nodeCount(page)).toBe(before);
    expectNoErrors(consoleErrors);
  });

  test("the key stays in this browser's model setting only, and Forget key removes it", async ({ page }) => {
    await mockAnthropic(page, [TOOL_TURN, TEXT_TURN]);
    await connect(page);
    await page.getByTestId("ai-request").fill("Add a cache");
    await page.getByTestId("ai-send").click();
    await expect(page.getByTestId("ai-turn-0")).toBeVisible();
    const holders = await page.evaluate(
      (key) => Object.keys(localStorage).filter((k) => (localStorage.getItem(k) ?? "").includes(key)),
      KEY,
    );
    expect(holders).toEqual([MODEL_KEY]);

    await page.getByTestId("ai-connect-toggle").click();
    await page.getByTestId("ai-key-forget").click();
    expect(await page.evaluate((k) => localStorage.getItem(k), MODEL_KEY)).toBeNull();
    await expect(page.getByTestId("ai-engine")).toHaveText("Copy and paste with your chatbot");
    await expect(page.getByTestId("ai-copy-prompt")).toBeVisible();
  });

  test("an error never shows the key, and nothing is applied", async ({ page }) => {
    await mockAnthropic(page, [
      { status: 401, body: JSON.stringify({ type: "error", error: { message: `invalid x-api-key: ${KEY}` } }) },
    ]);
    await connect(page);
    const before = await nodeCount(page);
    await page.getByTestId("ai-request").fill("Add a cache");
    await page.getByTestId("ai-send").click();
    await expect(page.getByTestId("ai-model-error")).toContainText("The key was rejected");
    await expect(page.getByTestId("ai-model-error")).not.toContainText("E2ESECRET");
    expect(await nodeCount(page)).toBe(before);
    await expect(page.getByTestId("ai-request")).toHaveValue("Add a cache");
  });

  test("copy and paste stays one click away with a key", async ({ page }) => {
    await mockAnthropic(page, []);
    await connect(page);
    await expect(page.getByTestId("ai-send")).toBeVisible();
    await expect(page.getByTestId("ai-reply")).toHaveCount(0);
    await page.getByTestId("ai-use-paste").click();
    await expect(page.getByTestId("ai-copy-prompt")).toBeVisible();
    await expect(page.getByTestId("ai-reply")).toBeVisible();
    await page.getByTestId("ai-use-model").click();
    await expect(page.getByTestId("ai-send")).toBeVisible();
  });
});

test.describe("Ask AI with your own key, in context", () => {
  test.beforeEach(async ({ page }) => {
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId("node-payments")).toBeVisible();
    await openAskAi(page);
  });

  test("in live view the model's simulation is saved and plays from the picker", async ({ page }) => {
    const simTurn = sse([
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tu_s", name: "set_simulation" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "input_json_delta",
          partial_json: JSON.stringify({
            title: "Model storm",
            durationSec: 30,
            traffic: [{ from: "shopper", pattern: "burst", count: 30 }],
          }),
        },
      },
      { type: "message_delta", delta: { stop_reason: "tool_use" } },
    ]);
    const seen = await mockAnthropic(page, [simTurn, TEXT_TURN]);
    await connect(page);
    await page.getByTestId("live-toggle").click();
    await page.getByTestId("ai-request").fill("A storm of 30 orders");
    await page.getByTestId("ai-send").click();
    await expect(page.getByTestId("ai-turn-0-summary")).toHaveText("Added simulation “Model storm”");
    const picker = page.getByTestId("live-sim-picker");
    await expect
      .poll(() => picker.evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.textContent ?? ""))
      .toBe("Model storm");
    const body = seen[0].postDataJSON() as { messages: { content: string }[] };
    expect(body.messages[0].content).toContain("set_simulation");
  });

  test("Explain answers in the thread and changes nothing", async ({ page }) => {
    const answer = sse([
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Orders flow from the shopper." } },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
    ]);
    const seen = await mockAnthropic(page, [answer]);
    await connect(page);
    const before = await nodeCount(page);
    await page.getByTestId("ai-suggestion-3").click();
    await expect(page.getByTestId("ai-intent-explain")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("ai-send").click();
    await expect(page.getByTestId("ai-turn-0")).toContainText("Orders flow from the shopper.");
    await expect(page.getByTestId("ai-turn-0")).toHaveAttribute("data-kind", "explain");
    await expect(page.getByTestId("ai-turn-0-summary")).toHaveCount(0);
    expect(await nodeCount(page)).toBe(before);
    const body = seen[0].postDataJSON() as { tools: { name: string }[] };
    expect(body.tools.map((t) => t.name)).toEqual(["describe_diagram"]);
  });
});

test.describe("Ask AI with your own key, while you keep editing", () => {
  test.beforeEach(async ({ page }) => {
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId("node-payments")).toBeVisible();
    await openAskAi(page);
  });

  /** A response the test releases by hand, after editing the diagram meanwhile. */
  function held() {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    return { release, body: async () => (await gate, TEXT_TURN) };
  }

  async function nudge(page: Page, testId: string) {
    await page.getByTestId(testId).click();
    for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight");
  }

  test("a node moved while the model works keeps its move; the turn lands on top", async ({ page }) => {
    const second = held();
    const seen = await mockAnthropic(page, [TOOL_TURN, second.body]);
    await connect(page);
    await page.getByTestId("ai-request").fill("Put a Redis cache in front of the orders API");
    await page.getByTestId("ai-send").click();
    await expect.poll(() => seen.length).toBe(2);
    await expect(page.getByTestId("ai-running")).toBeVisible();

    const x = () => paymentsX(page);
    const start = await x();
    await nudge(page, "node-payments");
    await expect.poll(x).toBe(start + 30);
    second.release();

    await expect(page.getByTestId("ai-turn-0-summary")).toHaveText("+1 node, +1 connection");
    await expect(page.getByTestId("ai-turn-0")).toContainText("Applied on top of the edits you made meanwhile");
    // The move survived the AI's change.
    await expect.poll(async () => (await savedDiagram(page))?.nodes.length).toBe(16);
    expect(await x()).toBe(start + 30);
  });

  test("when the model's change no longer fits, nothing is applied and Retry is offered", async ({ page }) => {
    const second = held();
    await mockAnthropic(page, [TOOL_TURN, second.body, TOOL_TURN, TEXT_TURN]);
    await connect(page);
    await page.getByTestId("ai-request").fill("Put a Redis cache in front of the orders API");
    await page.getByTestId("ai-send").click();
    await expect(page.getByTestId("ai-running")).toBeVisible();
    // The model connects to "orders"; delete it meanwhile.
    await page.getByTestId("node-orders").click();
    await page.keyboard.press("Delete");
    await expect(page.getByTestId("node-orders")).toHaveCount(0);
    const count = await nodeCount(page);
    second.release();
    await expect(page.getByTestId("ai-model-error")).toContainText("The diagram changed while the AI was working");
    expect(await nodeCount(page)).toBe(count);
    await expect(page.getByTestId("ai-retry")).toBeVisible();
    // Bring "orders" back and retry: the request goes again and applies.
    await page.getByTestId("canvas-wrap").click({ position: { x: 30, y: 300 } });
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.getByTestId("node-orders")).toBeVisible();
    await page.getByTestId("ai-retry").click();
    await expect(page.getByTestId("ai-turn-0-summary")).toHaveText("+1 node, +1 connection");
  });

  test("Enter while an input method is composing doesn't send", async ({ page }) => {
    const seen = await mockAnthropic(page, [TOOL_TURN, TEXT_TURN]);
    await connect(page);
    await page.getByTestId("ai-request").fill("キャッシュを追加");
    await page.getByTestId("ai-request").evaluate((el) => {
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }),
      );
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(300);
    expect(seen).toHaveLength(0);
    await expect(page.getByTestId("ai-running")).toHaveCount(0);
  });

  test("closing Connect a model returns the keyboard to what opened it", async ({ page }) => {
    await mockAnthropic(page, []);
    await page.getByTestId("ai-connect-toggle").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("ai-key")).toBeFocused();
    await page.getByTestId("ai-connect-cancel").click();
    await expect(page.getByTestId("ai-connect-toggle")).toBeFocused();
    // After connecting, it goes on to the request instead.
    await page.getByTestId("ai-connect-toggle").click();
    await page.getByTestId("ai-key").fill(KEY);
    await page.getByTestId("ai-key-save").click();
    await expect(page.getByTestId("ai-request")).toBeFocused();
  });
});
