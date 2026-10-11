// Gemini through the Generative Language API, streamed, straight from the browser with the user's own key
// (sent in a header, never in the URL).

import { inlineRefs, postSse } from "./http";
import type { ProviderAdapter, StepResult, ToolCall } from "./types";

export const geminiUrl = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

type Part = Record<string, unknown>;
const REFUSED = new Set(["SAFETY", "PROHIBITED_CONTENT", "RECITATION", "BLOCKLIST", "SPII"]);
/** Ids we made up for calls that came without one (older models): never sent back. */
const SYNTHETIC = /^gemini_call_\d+$/;

export const gemini: ProviderAdapter = {
  id: "gemini",
  label: "Gemini",

  start(history, request) {
    return [
      ...history.map((h) => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.text }] })),
      { role: "user", parts: [{ text: request }] },
    ];
  },

  async step({ key, model, system, tools, messages, signal, onText, fetch }): Promise<StepResult> {
    const stream = postSse("Gemini", geminiUrl(model), {
      key,
      signal,
      fetch,
      headers: { "x-goog-api-key": key },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: messages,
        tools: [
          {
            functionDeclarations: tools.map((t) => ({
              name: t.name,
              description: t.description,
              parametersJsonSchema: inlineRefs(t.inputSchema),
            })),
          },
        ],
      },
    });
    let text = "";
    let finish = "";
    const parts: Part[] = [];
    const calls: ToolCall[] = [];
    for await (const chunk of stream) {
      const feedback = chunk.promptFeedback as { blockReason?: string } | undefined;
      if (feedback?.blockReason) finish = "SAFETY";
      const candidate = (chunk.candidates as Record<string, unknown>[] | undefined)?.[0];
      if (!candidate) continue;
      for (const part of (candidate.content as { parts?: Part[] } | undefined)?.parts ?? []) {
        // Kept as sent (thought signatures included): the next request replays them.
        parts.push(part);
        if (typeof part.text === "string" && !part.thought) {
          text += part.text;
          onText(part.text);
        }
        const fc = part.functionCall as { name?: string; args?: unknown; id?: string } | undefined;
        if (fc?.name) calls.push({ id: fc.id ?? `gemini_call_${calls.length}`, name: fc.name, input: fc.args ?? {} });
      }
      if (typeof candidate.finishReason === "string") finish = candidate.finishReason;
    }
    return {
      text,
      calls,
      stop: calls.length ? "tools" : finish === "MAX_TOKENS" ? "length" : REFUSED.has(finish) ? "refused" : "end",
      assistant: { role: "model", parts },
    };
  },

  results(outcomes) {
    return [
      {
        role: "user",
        parts: outcomes.map((o) => {
          let response: Record<string, unknown>;
          try {
            response = o.isError ? { error: o.output } : { output: JSON.parse(o.output) as unknown };
          } catch {
            response = { output: o.output };
          }
          return {
            functionResponse: { name: o.call.name, response, ...(SYNTHETIC.test(o.call.id) ? {} : { id: o.call.id }) },
          };
        }),
      },
    ];
  },
};
