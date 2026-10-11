// OpenAI through Chat Completions, streamed, straight from the browser with the user's own key.

import { inlineRefs, parseArgs, postSse } from "./http";
import type { ProviderAdapter, StepResult, ToolCall } from "./types";

export const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export const openai: ProviderAdapter = {
  id: "openai",
  label: "OpenAI",

  start(history, request) {
    return [...history.map((h) => ({ role: h.role, content: h.text })), { role: "user", content: request }];
  },

  async step({ key, model, system, tools, messages, signal, onText, fetch }): Promise<StepResult> {
    const stream = postSse("OpenAI", OPENAI_URL, {
      key,
      signal,
      fetch,
      headers: { authorization: `Bearer ${key}` },
      body: {
        model,
        stream: true,
        messages: [{ role: "system", content: system }, ...messages],
        tools: tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: inlineRefs(t.inputSchema) },
        })),
      },
    });
    let text = "";
    let finish = "";
    const pending = new Map<number, { id: string; name: string; args: string }>();
    for await (const chunk of stream) {
      const choice = (chunk.choices as Record<string, unknown>[] | undefined)?.[0];
      if (!choice) continue;
      const delta = (choice.delta ?? {}) as {
        content?: unknown;
        tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
      };
      if (typeof delta.content === "string" && delta.content) {
        text += delta.content;
        onText(delta.content);
      }
      for (const tc of delta.tool_calls ?? []) {
        const call = pending.get(tc.index) ?? { id: "", name: "", args: "" };
        if (tc.id) call.id = tc.id;
        if (tc.function?.name) call.name += tc.function.name;
        if (tc.function?.arguments) call.args += tc.function.arguments;
        pending.set(tc.index, call);
      }
      if (typeof choice.finish_reason === "string") finish = choice.finish_reason;
    }
    const raw = [...pending.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
    const calls: ToolCall[] = raw.map((c, i) => {
      const { input, invalid } = parseArgs(c.args);
      return { id: c.id || `call_${i}`, name: c.name, input, ...(invalid ? { invalid } : {}) };
    });
    return {
      text,
      calls,
      stop: calls.length ? "tools" : finish === "length" ? "length" : finish === "content_filter" ? "refused" : "end",
      assistant: {
        role: "assistant",
        content: text || null,
        ...(raw.length
          ? {
              tool_calls: raw.map((c, i) => ({
                id: calls[i].id,
                type: "function",
                function: { name: c.name, arguments: c.args || "{}" },
              })),
            }
          : {}),
      },
    };
  },

  results(outcomes) {
    return outcomes.map((o) => ({ role: "tool", tool_call_id: o.call.id, content: o.output }));
  },
};
