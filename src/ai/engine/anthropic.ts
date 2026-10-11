// Claude through the Messages API, streamed, straight from the browser with the user's own key.

import { parseArgs, postSse } from "./http";
import { ProviderError, type ProviderAdapter, type StepResult, type ToolCall } from "./types";

export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

type Block = Record<string, unknown> & { type: string };

export const anthropic: ProviderAdapter = {
  id: "anthropic",
  label: "Claude",

  start(history, request) {
    return [...history.map((h) => ({ role: h.role, content: h.text })), { role: "user", content: request }];
  },

  async step({ key, model, system, tools, messages, signal, onText, fetch }): Promise<StepResult> {
    const stream = postSse("Anthropic", ANTHROPIC_URL, {
      key,
      signal,
      fetch,
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        // Calls come from the user's own browser with their own key; there is no server to hide it on.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: {
        model,
        max_tokens: 8000,
        // Quick edits over long deliberation; the ops are validated either way.
        output_config: { effort: "low" },
        system,
        messages,
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
        stream: true,
      },
    });
    const blocks: Block[] = [];
    const partial = new Map<number, string>();
    let text = "";
    let stopReason = "";
    for await (const ev of stream) {
      const index = typeof ev.index === "number" ? ev.index : -1;
      switch (ev.type) {
        case "content_block_start": {
          const block = { ...(ev.content_block as Block) };
          if (block.type === "tool_use") partial.set(index, "");
          blocks[index] = block;
          break;
        }
        case "content_block_delta": {
          const block = blocks[index];
          const delta = ev.delta as Record<string, unknown>;
          if (!block || !delta) break;
          if (delta.type === "text_delta" && typeof delta.text === "string") {
            block.text = `${(block.text as string) ?? ""}${delta.text}`;
            text += delta.text;
            onText(delta.text);
          } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
            partial.set(index, (partial.get(index) ?? "") + delta.partial_json);
          } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
            block.thinking = `${(block.thinking as string) ?? ""}${delta.thinking}`;
          } else if (delta.type === "signature_delta" && typeof delta.signature === "string") {
            block.signature = delta.signature;
          }
          break;
        }
        case "message_delta":
          stopReason = String((ev.delta as Record<string, unknown> | undefined)?.stop_reason ?? stopReason);
          break;
        case "error": {
          const e = ev.error as { message?: string } | undefined;
          throw new ProviderError(`Claude stopped: ${e?.message ?? "an error"}.`);
        }
      }
    }
    const calls: ToolCall[] = [];
    blocks.forEach((block, i) => {
      if (block?.type !== "tool_use") return;
      const { input, invalid } = parseArgs(partial.get(i) ?? "");
      block.input = input;
      calls.push({ id: String(block.id), name: String(block.name), input, ...(invalid ? { invalid } : {}) });
    });
    const content = blocks.filter(Boolean);
    return {
      text,
      calls,
      stop:
        stopReason === "tool_use" && calls.length
          ? "tools"
          : stopReason === "max_tokens"
            ? "length"
            : stopReason === "refusal"
              ? "refused"
              : "end",
      assistant: { role: "assistant", content },
    };
  },

  results(outcomes) {
    return [
      {
        role: "user",
        content: outcomes.map((o) => ({
          type: "tool_result",
          tool_use_id: o.call.id,
          content: o.output,
          ...(o.isError ? { is_error: true } : {}),
        })),
      },
    ];
  },
};
