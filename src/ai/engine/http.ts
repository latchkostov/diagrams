// What every adapter shares: a POST that streams server-sent events, and errors that never carry a key.

import { ProviderError } from "./types";

/** Key-shaped strings from any provider, plus the exact key in use. */
const KEY_PATTERNS = [/sk-ant-[A-Za-z0-9_-]{8,}/g, /sk-[A-Za-z0-9_-]{16,}/g, /AIza[0-9A-Za-z_-]{20,}/g];

/** Removes the key (and anything shaped like a key) from text that may be shown or logged. */
export function redact(text: string, key?: string): string {
  let out = text;
  if (key && key.length >= 4) out = out.split(key).join("[key]");
  for (const p of KEY_PATTERNS) out = out.replace(p, "[key]");
  return out;
}

const STATUS_HINT: Record<number, string> = {
  400: "The request was rejected",
  401: "The key was rejected. Check it, or connect again with a new one",
  403: "This key isn't allowed to use that model",
  404: "That model wasn't found. Check the model name in Connect a model",
  429: "Too many requests or no credit left. Wait a moment, or check your plan",
};

/** The provider's own error message from a JSON body, when it has one. */
function messageFrom(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown };
    const m = typeof j.error === "string" ? j.error : (j.error?.message ?? j.message);
    return typeof m === "string" ? m : "";
  } catch {
    return "";
  }
}

/**
 * POSTs JSON and yields each SSE `data:` payload as parsed JSON. Errors are ProviderErrors with the
 * key redacted, whether they come from the status, the body or the network.
 */
export async function* postSse(
  provider: string,
  url: string,
  init: { headers: Record<string, string>; body: unknown; key: string; signal?: AbortSignal; fetch?: typeof fetch },
): AsyncGenerator<Record<string, unknown>> {
  const doFetch = init.fetch ?? globalThis.fetch.bind(globalThis);
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...init.headers },
      body: JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") throw err;
    throw new ProviderError(
      redact(
        `${provider} couldn't be reached. Check your connection. (${err instanceof Error ? err.message : String(err)})`,
        init.key,
      ),
    );
  }
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    const detail = messageFrom(body);
    // Some providers answer an unknown model with a 400 that names the model.
    const unknownModel =
      res.status === 400 && /model/i.test(detail) && /not (found|exist|supported)|unknown|invalid/i.test(detail);
    const hint = unknownModel
      ? STATUS_HINT[404]
      : (STATUS_HINT[res.status] ?? (res.status >= 500 ? `${provider} had a problem. Try again` : "It failed"));
    throw new ProviderError(
      redact(`${hint} (${provider} ${res.status}${detail ? `: ${detail}` : ""}).`, init.key),
      res.status,
    );
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let data: string[] = [];
  const flush = function* () {
    if (!data.length) return;
    const payload = data.join("\n");
    data = [];
    if (payload === "[DONE]") return;
    try {
      yield JSON.parse(payload) as Record<string, unknown>;
    } catch {
      // A keep-alive or a partial line the provider will repeat: skip it.
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      if (line === "") yield* flush();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (buffer.startsWith("data:")) data.push(buffer.slice(5).replace(/^ /, ""));
  yield* flush();
}

/**
 * The schema with every local `$ref` replaced by its definition and `$defs` dropped: some function-calling
 * APIs only take self-contained schemas. Shared definitions are small and not recursive; a depth guard
 * keeps a bad schema from looping.
 */
export function inlineRefs(schema: Record<string, unknown>): Record<string, unknown> {
  const defs = (schema.$defs ?? {}) as Record<string, unknown>;
  const walk = (node: unknown, depth: number): unknown => {
    if (depth > 24 || !node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((n) => walk(n, depth + 1));
    const obj = node as Record<string, unknown>;
    const ref = typeof obj.$ref === "string" ? /^#\/\$defs\/(.+)$/.exec(obj.$ref)?.[1] : undefined;
    if (ref && defs[ref]) {
      const rest = { ...obj };
      delete rest.$ref;
      return walk({ ...(defs[ref] as object), ...rest }, depth + 1);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) if (k !== "$defs" && k !== "$schema") out[k] = walk(v, depth + 1);
    return out;
  };
  return walk(schema, 0) as Record<string, unknown>;
}

/** Parses a tool call's arguments; bad JSON becomes an `invalid` call the loop reports back. */
export function parseArgs(raw: string): { input: unknown; invalid?: string } {
  if (!raw.trim()) return { input: {} };
  try {
    return { input: JSON.parse(raw) };
  } catch (err) {
    return {
      input: {},
      invalid: `The arguments weren't valid JSON (${err instanceof Error ? err.message : String(err)}).`,
    };
  }
}
