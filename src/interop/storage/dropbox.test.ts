import { describe, expect, it } from "vitest";
import { fakeFetch, fakeTokens, type FakeResponse } from "../../test/fakeFetch";
import {
  createDropboxClient,
  dropboxAuthorizeUrl,
  dropboxError,
  dropboxPath,
  dropboxProvider,
  exchangeDropboxCode,
} from "./dropbox";
import { headerSafeJson } from "./http";

const config = { appKey: "abc123xyz" };

function client(responses: (FakeResponse | "network-error")[]) {
  const f = fakeFetch(responses);
  const tokens = fakeTokens();
  return { c: createDropboxClient({ fetch: f.fn, getToken: tokens.getToken }), calls: f.calls, asked: tokens.asked };
}

describe("Dropbox sign-in (PKCE, short-lived tokens)", () => {
  it("builds the authorize URL", () => {
    const url = new URL(
      dropboxAuthorizeUrl(config, { state: "s", challenge: "c", redirectUri: "https://x/auth.html" }),
    );
    expect(url.origin + url.pathname).toBe("https://www.dropbox.com/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "abc123xyz",
      response_type: "code",
      redirect_uri: "https://x/auth.html",
      state: "s",
      code_challenge: "c",
      code_challenge_method: "S256",
      token_access_type: "online",
      scope: "files.metadata.read files.content.read files.content.write",
    });
  });

  it("exchanges the code with the verifier and no secret", async () => {
    const f = fakeFetch([{ status: 200, body: { access_token: "sl.a", expires_in: 14400, token_type: "bearer" } }]);
    const t = await exchangeDropboxCode(f.fn, config, { code: "C", verifier: "V", redirectUri: "https://x/auth.html" });
    expect(t.access_token).toBe("sl.a");
    expect(f.calls[0].url).toBe("https://api.dropboxapi.com/oauth2/token");
    expect(Object.fromEntries(new URLSearchParams(f.calls[0].body))).toEqual({
      client_id: "abc123xyz",
      grant_type: "authorization_code",
      code: "C",
      redirect_uri: "https://x/auth.html",
      code_verifier: "V",
    });
  });

  it("a provider without config is never configured", () => {
    expect(dropboxProvider(undefined).isConfigured()).toBe(false);
    expect(dropboxProvider(config).isConfigured()).toBe(true);
  });
});

describe("Dropbox client", () => {
  it("lists the app folder root, following the cursor, files only, newest first", async () => {
    const { c, calls } = client([
      {
        status: 200,
        body: {
          entries: [
            { ".tag": "file", id: "id:1", name: "a.diagram.json", server_modified: "2026-01-01T00:00:00Z" },
            { ".tag": "folder", id: "id:2", name: "old" },
            { ".tag": "file", id: "id:3", name: "photo.jpg" },
          ],
          cursor: "CUR",
          has_more: true,
        },
      },
      {
        status: 200,
        body: {
          entries: [{ ".tag": "file", id: "id:4", name: "b.drawio", server_modified: "2026-03-01T00:00:00Z" }],
          has_more: false,
        },
      },
    ]);
    expect((await c.list()).map((f) => f.id)).toEqual(["id:4", "id:1"]);
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://api.dropboxapi.com/2/files/list_folder" });
    expect(JSON.parse(calls[0].body!)).toEqual({ path: "", limit: 500 });
    expect(calls[1].url).toBe("https://api.dropboxapi.com/2/files/list_folder/continue");
    expect(JSON.parse(calls[1].body!)).toEqual({ cursor: "CUR" });
  });

  it("uploads with a header-safe argument: new files never overwrite, Save overwrites by id", async () => {
    const { c, calls } = client([
      { status: 200, body: { id: "id:9", name: "Café (1).diagram.json" } },
      { status: 200, body: { id: "id:9", name: "Café (1).diagram.json" } },
    ]);
    const created = await c.upload(dropboxPath("Café.diagram.json"), "{}", "add");
    expect(created.id).toBe("id:9");
    expect(calls[0].url).toBe("https://content.dropboxapi.com/2/files/upload");
    expect(calls[0].headers["Content-Type"]).toBe("application/octet-stream");
    const arg = calls[0].headers["Dropbox-API-Arg"];
    expect(arg).toMatch(/^[\x20-\x7e]+$/); // ASCII only, as HTTP headers require
    expect(JSON.parse(arg)).toEqual({ path: "/Café.diagram.json", mode: "add", autorename: true, mute: true });
    await c.upload("id:9", "{}", "overwrite");
    expect(JSON.parse(calls[1].headers["Dropbox-API-Arg"])).toEqual({
      path: "id:9",
      mode: "overwrite",
      autorename: false,
      mute: true,
    });
  });

  it("downloads by id and reads the metadata header", async () => {
    const { c, calls } = client([
      {
        status: 200,
        body: '{"title":"A"}',
        headers: { "Dropbox-API-Result": JSON.stringify({ id: "id:1", name: "a.diagram.json" }) },
      },
    ]);
    const file = await c.download("id:1");
    expect(file.text).toBe('{"title":"A"}');
    expect(file.meta?.name).toBe("a.diagram.json");
    expect(calls[0].url).toBe("https://content.dropboxapi.com/2/files/download");
    expect(JSON.parse(calls[0].headers["Dropbox-API-Arg"])).toEqual({ path: "id:1" });
  });

  it("retries once with a fresh token after a 401, then maps errors", async () => {
    const r = client([
      { status: 401, body: { error_summary: "expired_access_token/" } },
      { status: 200, body: { entries: [], has_more: false } },
    ]);
    await r.c.list();
    expect(r.asked).toEqual([false, true]);
    const gone = client([{ status: 409, body: { error_summary: "path/not_found/.." } }]);
    await expect(gone.c.download("id:x")).rejects.toThrow(/no longer exists/);
    expect(dropboxError(409, '{"error_summary":"path/insufficient_space/"}', "save_the_file")).toBe(
      "Your Dropbox is full, so the file couldn't be saved.",
    );
    expect(dropboxError(409, '{"error_summary":"path/conflict/file/"}', "update_the_file")).toMatch(/changed/);
    expect(dropboxError(400, "Error in call: missing scope files.content.write", "save_the_file")).toMatch(
      /permissions/,
    );
    expect(dropboxError(503, "", "save_the_file")).toMatch(/busy/);
    const offline = client(["network-error"]);
    await expect(offline.c.list()).rejects.toThrow("Couldn't reach Dropbox to list your diagrams");
  });

  it("escapes non-ASCII characters and keeps names to one path segment", () => {
    expect(headerSafeJson({ path: "/日本.json" })).toBe('{"path":"/\\u65e5\\u672c.json"}');
    expect(dropboxPath("a/b:c.diagram.json")).toBe("/a-b-c.diagram.json");
  });
});
