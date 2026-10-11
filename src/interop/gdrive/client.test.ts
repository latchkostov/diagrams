import { describe, expect, it, vi } from "vitest";
import { LIMITS } from "../native";
import { createDriveClient, DriveError, multipartBody } from "./client";
import { readDriveConfig } from "./config";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** A fake fetch that records calls and answers from a queue. */
function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body as string | undefined,
    });
    const r = responses.shift();
    if (!r) throw new Error("no more responses");
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(text, { status: r.status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function client(responses: { status: number; body: unknown }[], tokens = ["t1", "t2"]) {
  const f = fakeFetch(responses);
  const asked: boolean[] = [];
  const c = createDriveClient({
    fetch: f.fn,
    getToken: async (force) => {
      asked.push(!!force);
      return tokens.shift() ?? "tN";
    },
    boundary: () => "BOUNDARY",
  });
  return { c, calls: f.calls, asked };
}

describe("Drive client", () => {
  it("creates a file with a multipart upload", async () => {
    const { c, calls } = client([{ status: 200, body: { id: "f1", name: "a.diagram.json" } }]);
    const out = await c.create({ name: "a.diagram.json", mimeType: "application/json", content: '{"x":1}' });
    expect(out).toEqual({ id: "f1", name: "a.diagram.json" });
    const [call] = calls;
    expect(call.method).toBe("POST");
    expect(call.url).toMatch(/^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?uploadType=multipart/);
    expect(call.headers.Authorization).toBe("Bearer t1");
    expect(call.headers["Content-Type"]).toBe("multipart/related; boundary=BOUNDARY");
    expect(call.body).toBe(
      multipartBody(
        { name: "a.diagram.json", mimeType: "application/json" },
        '{"x":1}',
        "application/json",
        "BOUNDARY",
      ),
    );
    expect(call.body).toContain(
      '--BOUNDARY\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"a.diagram.json"',
    );
    expect(call.body!.endsWith("--BOUNDARY--\r\n")).toBe(true);
  });

  it("updates an existing file in place with PATCH", async () => {
    const { c, calls } = client([{ status: 200, body: { id: "f1", name: "a.diagram.json" } }]);
    await c.update("f1", { content: "{}", mimeType: "application/json" });
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toMatch(/upload\/drive\/v3\/files\/f1\?uploadType=multipart/);
    expect(calls[0].body).toContain("\r\n{}\r\n");
  });

  it("downloads metadata then content", async () => {
    const { c, calls } = client([
      { status: 200, body: { id: "f1", name: "flow.drawio", mimeType: "application/vnd.jgraph.mxfile" } },
      { status: 200, body: "<mxfile/>" },
    ]);
    const out = await c.download("f1");
    expect(out).toMatchObject({ id: "f1", name: "flow.drawio", text: "<mxfile/>" });
    expect(calls[1].url).toMatch(/files\/f1\?alt=media/);
  });

  it("refreshes the token once on 401", async () => {
    const { c, calls, asked } = client([
      { status: 401, body: { error: { message: "expired" } } },
      { status: 200, body: { id: "f1", name: "x" } },
    ]);
    await c.getMeta("f1");
    expect(asked).toEqual([false, true]);
    expect(calls.map((x) => x.headers.Authorization)).toEqual(["Bearer t1", "Bearer t2"]);
  });

  it("turns HTTP errors into friendly messages", async () => {
    const cases: [number, unknown, RegExp][] = [
      [404, "", /no longer exists/],
      [403, { error: { message: "The user has not granted the app access" } }, /only open files you pick/],
      [403, { error: { message: "The user's Drive storage quota has been exceeded." } }, /Drive is full/],
      [503, "", /busy/],
    ];
    for (const [status, body, re] of cases) {
      const { c } = client([{ status, body }]);
      const err = await c.getMeta("x").catch((e) => e);
      expect(err).toBeInstanceOf(DriveError);
      expect(err.message).toMatch(re);
      expect(err.status).toBe(status);
    }
  });

  it("reports network failures", async () => {
    const c = createDriveClient({
      fetch: (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
      getToken: async () => "t",
    });
    await expect(c.getMeta("x")).rejects.toThrow(/Check your connection/);
  });
});

describe("Drive config", () => {
  it("is disabled unless both client id and API key are set", () => {
    expect(readDriveConfig({})).toBeUndefined();
    expect(readDriveConfig({ VITE_GOOGLE_CLIENT_ID: "123-abc.apps.googleusercontent.com" })).toBeUndefined();
    expect(
      readDriveConfig({ VITE_GOOGLE_CLIENT_ID: "123-abc.apps.googleusercontent.com", VITE_GOOGLE_API_KEY: "k" }),
    ).toEqual({
      clientId: "123-abc.apps.googleusercontent.com",
      apiKey: "k",
      appId: "123",
    });
    expect(
      readDriveConfig({ VITE_GOOGLE_CLIENT_ID: "x", VITE_GOOGLE_API_KEY: "k", VITE_GOOGLE_APP_ID: "987" })?.appId,
    ).toBe("987");
  });
});

describe("Drive download size budgets", () => {
  it("rejects oversized metadata before requesting the content", async () => {
    const { c, calls } = client([{ status: 200, body: { id: "f", name: "x", size: String(LIMITS.maxTextChars + 1) } }]);
    await expect(c.download("f")).rejects.toThrow(/too large/);
    expect(calls).toHaveLength(1);
  });
  it("cancels a response with excessive Content-Length without reading it", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "f", name: "x" })))
      .mockResolvedValueOnce(new Response(stream, { headers: { "Content-Length": String(LIMITS.maxTextChars + 1) } }));
    const c = createDriveClient({ fetch, getToken: async () => "t" });
    await expect(c.download("f")).rejects.toThrow(/too large/);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("cancels unknown-size streaming input as soon as the byte budget is exceeded", async () => {
    const cancel = vi.fn();
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          reads++;
          controller.enqueue(new Uint8Array(1_000_000));
          if (reads === 12) controller.close();
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "f", name: "x" })))
      .mockResolvedValueOnce(new Response(stream));
    const c = createDriveClient({ fetch, getToken: async () => "t" });
    await expect(c.download("f")).rejects.toThrow(/too large/);
    expect(cancel).toHaveBeenCalledOnce();
    expect(reads).toBe(9);
  });
  it("decodes multibyte characters split across streamed chunks", async () => {
    const bytes = new TextEncoder().encode("A🙂B");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 3));
        controller.enqueue(bytes.slice(3));
        controller.close();
      },
    });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "f", name: "x" })))
      .mockResolvedValueOnce(new Response(stream));
    expect((await createDriveClient({ fetch, getToken: async () => "t" }).download("f")).text).toBe("A🙂B");
  });
});
