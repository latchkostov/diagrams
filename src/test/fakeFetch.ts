// A fake `fetch` for unit tests of the storage clients: records every call and answers from a queue.

export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface FakeResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export function fakeFetch(responses: (FakeResponse | "network-error")[]) {
  const calls: FetchCall[] = [];
  const fn = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      headers: { ...(init.headers as Record<string, string> | undefined) },
      body: init.body as string | undefined,
    });
    const r = responses.shift();
    if (!r) throw new Error(`no response queued for ${url}`);
    if (r === "network-error") throw new TypeError("Failed to fetch");
    const text = r.body === undefined ? "" : typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(r.status === 204 ? null : text, { status: r.status, headers: r.headers });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

/** A token source for clients: hands out t1, t2, … and records whether each ask was forced. */
export function fakeTokens() {
  let n = 0;
  const asked: boolean[] = [];
  return {
    asked,
    getToken: async (force?: boolean) => {
      asked.push(!!force);
      return `t${++n}`;
    },
  };
}
