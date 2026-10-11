// Test helpers for the adapters: a fetch stand-in that records requests and answers with scripted
// server-sent events. No network: every test passes this as `fetch`.

export interface Recorded {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A streamed response: each event becomes `data: <json>` (with an `event:` line when it has a type). */
export function sse(events: readonly unknown[], { eventLines = false, done = false } = {}): Response {
  const text =
    events
      .map((e) => {
        const type = eventLines && e && typeof e === "object" ? (e as { type?: string }).type : undefined;
        return `${type ? `event: ${type}\n` : ""}data: ${JSON.stringify(e)}\n\n`;
      })
      .join("") + (done ? "data: [DONE]\n\n" : "");
  // Split mid-line so the reader has to buffer.
  const mid = Math.floor(text.length / 2);
  const chunks = [text.slice(0, mid), text.slice(mid)];
  return new Response(
    new ReadableStream({
      start(c) {
        for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
        c.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

/** A fetch that answers each call with the next response, recording what was sent. */
export function scriptedFetch(responses: readonly (Response | Error)[]) {
  const calls: Recorded[] = [];
  let i = 0;
  const fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    const next = responses[i++];
    if (!next) throw new Error("No more scripted responses");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}
