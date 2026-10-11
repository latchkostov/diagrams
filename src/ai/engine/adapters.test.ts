import { describe, expect, it } from "vitest";
import { anthropic, ANTHROPIC_URL } from "./anthropic";
import { openai, OPENAI_URL } from "./openai";
import { gemini } from "./gemini";
import { inlineRefs, redact } from "./http";
import { ProviderError, type ProviderAdapter, type StepRequest } from "./types";
import { scriptedFetch, sse } from "./testing";

// Each adapter against a recorded fetch: the request it sends, how it reads a stream, and that its
// errors never carry the key. No network.

const KEY = "sk-ant-api03-SECRET0123456789abcdef";
const OPENAI_KEY = "sk-proj-SECRET0123456789abcdefghij";
const GEMINI_KEY = "AIzaSySECRET0123456789abcdefghijk";

const tools = [
  {
    name: "edit_diagram",
    description: "Edit",
    inputSchema: {
      type: "object",
      properties: { ops: { type: "array", items: { $ref: "#/$defs/Ref" } } },
      $defs: { Ref: { type: "string" } },
    },
  },
];

function request(
  adapter: ProviderAdapter,
  key: string,
  fetch: typeof globalThis.fetch,
  texts: string[] = [],
): StepRequest {
  return {
    key,
    model: "m",
    system: "sys",
    tools,
    messages: adapter.start(
      [
        { role: "user", text: "earlier" },
        { role: "assistant", text: "ok" },
      ],
      "Add a cache",
    ),
    onText: (t) => texts.push(t),
    fetch,
  };
}

async function failure(p: Promise<unknown>): Promise<ProviderError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(ProviderError);
    return err as ProviderError;
  }
  throw new Error("expected a failure");
}

describe("anthropic", () => {
  it("sends the browser-access header, the key and the tools, and reads text, thinking and tool calls", async () => {
    const { fetch, calls } = scriptedFetch([
      sse(
        [
          { type: "message_start", message: {} },
          { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-1" } },
          { type: "content_block_stop", index: 0 },
          { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Adding " } },
          { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "a cache." } },
          {
            type: "content_block_start",
            index: 2,
            content_block: { type: "tool_use", id: "tu_1", name: "edit_diagram", input: {} },
          },
          {
            type: "content_block_delta",
            index: 2,
            delta: { type: "input_json_delta", partial_json: '{"ops":[{"op":"add_' },
          },
          { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: 'node"}]}' } },
          { type: "content_block_stop", index: 2 },
          { type: "message_delta", delta: { stop_reason: "tool_use" } },
          { type: "message_stop" },
        ],
        { eventLines: true },
      ),
    ]);
    const texts: string[] = [];
    const result = await anthropic.step(request(anthropic, KEY, fetch, texts));
    const sent = calls[0];
    expect(sent.url).toBe(ANTHROPIC_URL);
    expect(sent.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(sent.headers["x-api-key"]).toBe(KEY);
    expect(sent.headers["anthropic-version"]).toBe("2023-06-01");
    expect(sent.body).toMatchObject({ model: "m", system: "sys", stream: true });
    expect((sent.body.tools as { input_schema: unknown }[])[0].input_schema).toEqual(tools[0].inputSchema);
    expect(sent.body.messages).toEqual([
      { role: "user", content: "earlier" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "Add a cache" },
    ]);
    expect(texts.join("")).toBe("Adding a cache.");
    expect(result.stop).toBe("tools");
    expect(result.calls).toEqual([{ id: "tu_1", name: "edit_diagram", input: { ops: [{ op: "add_node" }] } }]);
    // The thinking block (with its signature) is replayed with the tool results.
    const content = (result.assistant as { content: Record<string, unknown>[] }).content;
    expect(content[0]).toMatchObject({ type: "thinking", signature: "sig-1" });
    expect(content[2]).toMatchObject({ type: "tool_use", id: "tu_1", input: { ops: [{ op: "add_node" }] } });
    expect(anthropic.results([{ call: result.calls[0], output: '{"ok":true}', isError: false }])).toEqual([
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: '{"ok":true}' }] },
    ]);
  });

  it("reports bad tool JSON as an invalid call, and stops on max_tokens or refusal", async () => {
    const { fetch } = scriptedFetch([
      sse([
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t", name: "edit_diagram" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"ops":' } },
        { type: "message_delta", delta: { stop_reason: "tool_use" } },
      ]),
      sse([{ type: "message_delta", delta: { stop_reason: "refusal" } }]),
    ]);
    const bad = await anthropic.step(request(anthropic, KEY, fetch));
    expect(bad.calls[0].invalid).toContain("valid JSON");
    expect((await anthropic.step(request(anthropic, KEY, fetch))).stop).toBe("refused");
  });

  it("never puts the key in an error, from the body or the network", async () => {
    const { fetch } = scriptedFetch([
      new Response(JSON.stringify({ error: { message: `invalid x-api-key ${KEY}` } }), { status: 401 }),
      new TypeError(`Failed to fetch with ${KEY}`),
    ]);
    const auth = await failure(anthropic.step(request(anthropic, KEY, fetch)));
    expect(auth.status).toBe(401);
    expect(auth.message).toContain("The key was rejected");
    expect(auth.message).not.toContain(KEY);
    expect(auth.message).not.toContain("SECRET");
    const net = await failure(anthropic.step(request(anthropic, KEY, fetch)));
    expect(net.message).toContain("couldn't be reached");
    expect(net.message).not.toContain("SECRET");
  });
});

describe("openai", () => {
  it("sends a bearer key and inlined schemas, and joins streamed tool-call fragments", async () => {
    const { fetch, calls } = scriptedFetch([
      sse(
        [
          { choices: [{ delta: { content: "On it." } }] },
          {
            choices: [
              {
                delta: { tool_calls: [{ index: 0, id: "call_a", function: { name: "edit_", arguments: '{"ops":' } }] },
              },
            ],
          },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "diagram", arguments: "[]}" } }] } }] },
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
        ],
        { done: true },
      ),
    ]);
    const texts: string[] = [];
    const result = await openai.step(request(openai, OPENAI_KEY, fetch, texts));
    expect(calls[0].url).toBe(OPENAI_URL);
    expect(calls[0].headers.authorization).toBe(`Bearer ${OPENAI_KEY}`);
    const body = calls[0].body as { messages: { role: string }[]; tools: { function: { parameters: object } }[] };
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(JSON.stringify(body.tools[0].function.parameters)).not.toContain("$ref");
    expect(texts.join("")).toBe("On it.");
    expect(result.calls).toEqual([{ id: "call_a", name: "edit_diagram", input: { ops: [] } }]);
    expect(result.assistant).toMatchObject({
      role: "assistant",
      content: "On it.",
      tool_calls: [{ id: "call_a", type: "function", function: { name: "edit_diagram", arguments: '{"ops":[]}' } }],
    });
    expect(openai.results([{ call: result.calls[0], output: "{}", isError: false }])).toEqual([
      { role: "tool", tool_call_id: "call_a", content: "{}" },
    ]);
  });

  it("redacts the key from errors", async () => {
    const { fetch } = scriptedFetch([
      new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${OPENAI_KEY}` } }), {
        status: 401,
      }),
    ]);
    const err = await failure(openai.step(request(openai, OPENAI_KEY, fetch)));
    expect(err.message).toContain("OpenAI 401");
    expect(err.message).not.toContain("SECRET");
  });
});

describe("gemini", () => {
  it("sends the key in a header (never the URL) and reads function calls with their signatures", async () => {
    const { fetch, calls } = scriptedFetch([
      sse([
        { candidates: [{ content: { role: "model", parts: [{ text: "Sure." }] } }] },
        {
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ functionCall: { name: "edit_diagram", args: { ops: [] } }, thoughtSignature: "abc" }],
              },
              finishReason: "STOP",
            },
          ],
        },
      ]),
    ]);
    const result = await gemini.step(request(gemini, GEMINI_KEY, fetch));
    expect(calls[0].url).toContain("models/m:streamGenerateContent?alt=sse");
    expect(calls[0].url).not.toContain(GEMINI_KEY);
    expect(calls[0].headers["x-goog-api-key"]).toBe(GEMINI_KEY);
    const body = calls[0].body as { systemInstruction: unknown; contents: { role: string }[] };
    expect(body.systemInstruction).toEqual({ parts: [{ text: "sys" }] });
    expect(body.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(result.stop).toBe("tools");
    expect(result.calls[0]).toMatchObject({ name: "edit_diagram", input: { ops: [] } });
    expect((result.assistant as { parts: unknown[] }).parts[1]).toMatchObject({ thoughtSignature: "abc" });
    expect(gemini.results([{ call: result.calls[0], output: '{"ok":true}', isError: false }])).toEqual([
      { role: "user", parts: [{ functionResponse: { name: "edit_diagram", response: { output: { ok: true } } } }] },
    ]);
  });

  it("redacts the key from errors", async () => {
    const { fetch } = scriptedFetch([
      new Response(JSON.stringify({ error: { message: `API key not valid: ${GEMINI_KEY}` } }), { status: 400 }),
    ]);
    const err = await failure(gemini.step(request(gemini, GEMINI_KEY, fetch)));
    expect(err.message).not.toContain("SECRET");
    expect(err.message).toContain("Gemini 400");
  });
});

describe("unknown models", () => {
  it("says to check the model name, for a 404 or a 400 about the model", async () => {
    const { fetch } = scriptedFetch([
      new Response(JSON.stringify({ error: { message: "The model `gpt-9` does not exist" } }), { status: 404 }),
      new Response(JSON.stringify({ error: { message: "models/gemini-9 is not found for API version v1beta" } }), {
        status: 400,
      }),
    ]);
    const a = await failure(openai.step(request(openai, OPENAI_KEY, fetch)));
    expect(a.message).toContain("Check the model name");
    const b = await failure(gemini.step(request(gemini, GEMINI_KEY, fetch)));
    expect(b.message).toContain("Check the model name");
  });
});

describe("helpers", () => {
  it("redacts the exact key and key-shaped strings", () => {
    expect(redact(`a ${KEY} b`, KEY)).toBe("a [key] b");
    expect(redact(`x ${OPENAI_KEY} y ${GEMINI_KEY}`)).toBe("x [key] y [key]");
  });

  it("inlines $refs and drops $defs", () => {
    expect(inlineRefs(tools[0].inputSchema)).toEqual({
      type: "object",
      properties: { ops: { type: "array", items: { type: "string" } } },
    });
  });
});
