import { describe, expect, it, vi } from "vitest";
import type { DiagramFile } from "../../model/types";
import { runAgentTurn, userMessage } from "./agent";
import { anthropic } from "./anthropic";
import { LOCAL_ONLY_MESSAGE } from "../privacy";
import { ProviderError, type ProviderAdapter, type StepRequest, type StepResult, type ToolOutcome } from "./types";
import { scriptedFetch, sse } from "./testing";

// The agent loop: a model's tool calls run against a draft through the WebMCP tool definitions, and the
// caller gets the finished draft to apply as one undo step.

const base = (): DiagramFile => ({
  format: "diagrams/v1",
  title: "Billing",
  nodes: [
    { id: "billing-worker", stencil: "service.dotnet", label: "billing-worker", x: 0, y: 0 },
    { id: "billing-db", stencil: "postgres", label: "billing-db", x: 300, y: 0 },
  ],
  edges: [{ id: "e1", from: "billing-worker", to: "billing-db", kind: "sync" }],
});

/** A provider that plays back scripted steps and records what it was given. */
function fakeProvider(steps: Omit<StepResult, "assistant">[]) {
  const requests: StepRequest[] = [];
  const results: ToolOutcome[][] = [];
  let i = 0;
  const adapter: ProviderAdapter = {
    id: "anthropic",
    label: "Fake",
    start: (_history, request) => [{ role: "user", content: request }],
    step: vi.fn(async (req: StepRequest) => {
      requests.push({ ...req, messages: [...req.messages] });
      const s = steps[i++];
      if (s.text) req.onText(s.text);
      return { ...s, assistant: { role: "assistant", step: i } };
    }),
    results: (outcomes) => {
      results.push([...outcomes]);
      return [{ role: "user", results: outcomes.length }];
    },
  };
  return { adapter, requests, results };
}

const input = (adapter: ProviderAdapter, extra: Partial<Parameters<typeof runAgentTurn>[0]> = {}) => ({
  adapter,
  key: "k",
  model: "m",
  intent: "change" as const,
  diagram: base(),
  describe: "nodes: billing-worker, billing-db",
  request: "Add a dead-letter queue after billing-worker",
  canUseAi: () => true,
  onText: () => {},
  ...extra,
});

describe("runAgentTurn", () => {
  it("runs edit_diagram on a draft and returns it, leaving the input diagram alone", async () => {
    const { adapter, requests, results } = fakeProvider([
      {
        text: "",
        stop: "tools",
        calls: [
          {
            id: "c1",
            name: "edit_diagram",
            input: {
              ops: [
                { op: "add_node", kind: "Service Bus queue", label: "billing-dlq", key: "q" },
                { op: "connect", from: "billing-worker", to: "q" },
              ],
            },
          },
        ],
      },
      { text: "Added billing-dlq after billing-worker.", stop: "end", calls: [] },
    ]);
    const start = base();
    const streamed: string[] = [];
    const result = await runAgentTurn(input(adapter, { diagram: start, onText: (t) => streamed.push(t) }));
    expect(result.changed).toBe(true);
    expect(result.stop).toBe("end");
    expect(result.text).toBe("Added billing-dlq after billing-worker.");
    expect(streamed.join("")).toBe(result.text);
    expect(result.next.nodes.map((n) => n.label)).toContain("billing-dlq");
    expect(start.nodes).toHaveLength(2);
    expect(JSON.parse(results[0][0].output)).toMatchObject({ ok: true });
    // The tools offered are the WebMCP definitions for a change, never new_diagram or get_share_link.
    expect(requests[0].tools.map((t) => t.name)).toEqual([
      "describe_diagram",
      "find_stencils",
      "edit_diagram",
      "set_simulation",
    ]);
    expect(requests[0].messages[0]).toEqual({
      role: "user",
      content: userMessage("nodes: billing-worker, billing-db", "Add a dead-letter queue after billing-worker"),
    });
  });

  it("records the successful edits as steps, never dry runs or failed calls", async () => {
    const add = { ops: [{ op: "add_node", kind: "Redis cache", label: "cache", key: "c" }] };
    const { adapter } = fakeProvider([
      {
        text: "",
        stop: "tools",
        calls: [
          { id: "a", name: "edit_diagram", input: { ...add, dryRun: true } },
          { id: "b", name: "edit_diagram", input: { ops: [{ op: "update", target: "nope", label: "x" }] } },
          { id: "c", name: "edit_diagram", input: add },
          {
            id: "d",
            name: "set_simulation",
            input: { title: "S", traffic: [{ from: "billing-worker", pattern: "burst", count: 3 }] },
          },
        ],
      },
      { text: "Done.", stop: "end", calls: [] },
    ]);
    const result = await runAgentTurn(input(adapter));
    expect(result.steps).toEqual([
      { kind: "ops", ops: add.ops },
      { kind: "simulation", spec: { title: "S", traffic: [{ from: "billing-worker", pattern: "burst", count: 3 }] } },
    ]);
  });

  it("a stream failure after an editing call fails the whole turn, so nothing is applied", async () => {
    const { adapter } = fakeProvider([
      {
        text: "",
        stop: "tools",
        calls: [{ id: "c", name: "edit_diagram", input: { ops: [{ op: "add_node", kind: "cache", label: "c" }] } }],
      },
    ]);
    const step = adapter.step;
    let n = 0;
    adapter.step = vi.fn(async (req: StepRequest) => {
      if (n++ === 0) return step(req);
      throw new ProviderError("Claude stopped with an error: Overloaded.");
    });
    await expect(runAgentTurn(input(adapter))).rejects.toThrow("Overloaded");
  });

  it("adds a simulation through set_simulation", async () => {
    const { adapter } = fakeProvider([
      {
        text: "",
        stop: "tools",
        calls: [
          {
            id: "c1",
            name: "set_simulation",
            input: { title: "Storm", traffic: [{ from: "billing-worker", pattern: "burst", count: 100 }] },
          },
        ],
      },
      { text: "Added a storm.", stop: "end", calls: [] },
    ]);
    const result = await runAgentTurn(input(adapter));
    expect(result.next.simulations?.map((s) => s.title)).toEqual(["Storm"]);
  });

  it("returns failing ops, unknown tools and bad JSON to the model as errors, and applies nothing for them", async () => {
    const { adapter, results } = fakeProvider([
      {
        text: "",
        stop: "tools",
        calls: [
          { id: "a", name: "edit_diagram", input: { ops: [{ op: "update", target: "nope", label: "x" }] } },
          { id: "b", name: "new_diagram", input: {} },
          { id: "c", name: "edit_diagram", input: {}, invalid: "The arguments weren't valid JSON." },
        ],
      },
      { text: "I couldn't find it.", stop: "end", calls: [] },
    ]);
    const result = await runAgentTurn(input(adapter));
    expect(result.changed).toBe(false);
    expect(results[0].map((o) => o.isError)).toEqual([true, true, true]);
    expect(results[0][1].output).toContain("no tool named");
  });

  it("explains with describe_diagram only", async () => {
    const { adapter, requests } = fakeProvider([{ text: "It takes orders.", stop: "end", calls: [] }]);
    const result = await runAgentTurn(input(adapter, { intent: "explain" }));
    expect(requests[0].tools.map((t) => t.name)).toEqual(["describe_diagram"]);
    expect(requests[0].system).toContain("Don't change anything");
    expect(result.changed).toBe(false);
  });

  it("stops after the step limit", async () => {
    const loop = { text: "", stop: "tools" as const, calls: [{ id: "x", name: "describe_diagram", input: {} }] };
    const { adapter } = fakeProvider([loop, loop, loop]);
    const result = await runAgentTurn(input(adapter, { maxSteps: 3 }));
    expect(result.stop).toBe("steps");
  });

  it("never calls the model for a local-only diagram, even mid-turn", async () => {
    const { adapter } = fakeProvider([{ text: "", stop: "end", calls: [] }]);
    await expect(runAgentTurn(input(adapter, { canUseAi: () => false }))).rejects.toThrow(LOCAL_ONLY_MESSAGE);
    expect(adapter.step).not.toHaveBeenCalled();

    let allowed = true;
    const second = fakeProvider([
      { text: "", stop: "tools", calls: [{ id: "x", name: "describe_diagram", input: {} }] },
      { text: "done", stop: "end", calls: [] },
    ]);
    const original = second.adapter.step;
    second.adapter.step = vi.fn(async (req: StepRequest) => {
      const r = await original(req);
      allowed = false;
      return r;
    });
    await expect(runAgentTurn(input(second.adapter, { canUseAi: () => allowed }))).rejects.toBeInstanceOf(
      ProviderError,
    );
    expect(second.adapter.step).toHaveBeenCalledTimes(1);
  });

  it("drives the real Claude adapter over a mocked fetch, end to end", async () => {
    const { fetch, calls } = scriptedFetch([
      sse([
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu", name: "edit_diagram" } },
        {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: JSON.stringify({ ops: [{ op: "update", target: "billing-worker", props: { replicas: 3 } }] }),
          },
        },
        { type: "message_delta", delta: { stop_reason: "tool_use" } },
      ]),
      sse([
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Scaled to 3 replicas." } },
        { type: "message_delta", delta: { stop_reason: "end_turn" } },
      ]),
    ]);
    const result = await runAgentTurn(input(anthropic, { fetch, key: "sk-ant-test-0000000000" }));
    expect(result.text).toBe("Scaled to 3 replicas.");
    expect(result.next.nodes.find((n) => n.id === "billing-worker")?.props).toMatchObject({ replicas: 3 });
    const second = calls[1].body.messages as { role: string; content: unknown }[];
    expect(second.at(-1)).toMatchObject({ role: "user", content: [{ type: "tool_result", tool_use_id: "tu" }] });
  });
});
