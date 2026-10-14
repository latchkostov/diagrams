import { describe, expect, it } from "vitest";
import { fakeFetch, fakeTokens, type FakeResponse } from "../../test/fakeFetch";
import { LIMITS } from "../native";
import {
  createOneDriveClient,
  exchangeOneDriveCode,
  graphError,
  oneDriveAuthorizeUrl,
  oneDriveProvider,
  refreshOneDriveToken,
} from "./onedrive";

const config = { clientId: "11111111-2222-3333-4444-555555555555", tenant: "common" };
const GRAPH = "https://graph.microsoft.com/v1.0";

function client(responses: (FakeResponse | "network-error")[]) {
  const f = fakeFetch(responses);
  const tokens = fakeTokens();
  return { c: createOneDriveClient({ fetch: f.fn, getToken: tokens.getToken }), calls: f.calls, asked: tokens.asked };
}

describe("OneDrive sign-in (auth code + PKCE, common tenant)", () => {
  it("builds the authorize URL with the app-folder scope and an S256 challenge", () => {
    const url = new URL(
      oneDriveAuthorizeUrl(config, {
        state: "s1",
        challenge: "c1",
        redirectUri: "https://www.livediagrams.dev/auth.html",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: "https://www.livediagrams.dev/auth.html",
      response_mode: "query",
      scope: "Files.ReadWrite.AppFolder offline_access",
      state: "s1",
      code_challenge: "c1",
      code_challenge_method: "S256",
      prompt: "select_account",
    });
  });

  it("exchanges the code with the verifier and no secret, and refreshes", async () => {
    const f = fakeFetch([
      { status: 200, body: { access_token: "a", refresh_token: "r", expires_in: 3599 } },
      { status: 200, body: { access_token: "b", refresh_token: "r2", expires_in: 3599 } },
    ]);
    const t = await exchangeOneDriveCode(f.fn, config, {
      code: "C",
      verifier: "V",
      redirectUri: "https://x/auth.html",
    });
    expect(t).toMatchObject({ access_token: "a", refresh_token: "r" });
    expect(f.calls[0].url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    const form = new URLSearchParams(f.calls[0].body);
    expect(Object.fromEntries(form)).toEqual({
      client_id: config.clientId,
      grant_type: "authorization_code",
      code: "C",
      redirect_uri: "https://x/auth.html",
      code_verifier: "V",
      scope: "Files.ReadWrite.AppFolder offline_access",
    });
    expect(form.has("client_secret")).toBe(false);
    await refreshOneDriveToken(f.fn, config, "r");
    expect(Object.fromEntries(new URLSearchParams(f.calls[1].body))).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "r",
      client_id: config.clientId,
    });
  });

  it("a provider without config is never configured", () => {
    expect(oneDriveProvider(undefined).isConfigured()).toBe(false);
    expect(oneDriveProvider(config).isConfigured()).toBe(true);
  });
});

describe("OneDrive client (Microsoft Graph)", () => {
  it("lists the app folder's diagram files across pages, newest first", async () => {
    const { c, calls } = client([
      {
        status: 200,
        body: {
          value: [
            { id: "1", name: "old.diagram.json", file: {}, lastModifiedDateTime: "2026-01-01T00:00:00Z" },
            { id: "2", name: "notes.txt", file: {} },
            { id: "3", name: "Sub", folder: {} },
          ],
          "@odata.nextLink": `${GRAPH}/me/drive/special/approot/children?$skiptoken=x`,
        },
      },
      {
        status: 200,
        body: {
          value: [{ id: "4", name: "new.drawio", file: {}, lastModifiedDateTime: "2026-02-01T00:00:00Z" }],
          "@odata.nextLink": "https://evil.example/next",
        },
      },
    ]);
    const files = await c.list();
    expect(files.map((f) => f.id)).toEqual(["4", "1"]);
    expect(calls).toHaveLength(2); // a foreign nextLink is never followed
    expect(calls[0].url).toMatch(/^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/drive\/special\/approot\/children\?/);
    expect(calls[0].headers.Authorization).toBe("Bearer t1");
  });

  it("downloads through the pre-authenticated URL, without sending the token there", async () => {
    const { c, calls } = client([
      {
        status: 200,
        body: { id: "1", name: "a.diagram.json", size: 12, "@microsoft.graph.downloadUrl": "https://dl.test/abc" },
      },
      { status: 200, body: '{"title":"A"}' },
    ]);
    const file = await c.download("1");
    expect(file.text).toBe('{"title":"A"}');
    expect(calls[0].url).toBe(`${GRAPH}/me/drive/items/1?$select=id,name,size,@microsoft.graph.downloadUrl`);
    expect(calls[1].url).toBe("https://dl.test/abc");
    expect(calls[1].headers.Authorization).toBeUndefined();
  });

  it("refuses a file over the import budget before downloading it", async () => {
    const { c, calls } = client([
      {
        status: 200,
        body: {
          id: "1",
          name: "big.json",
          size: LIMITS.maxTextChars + 1,
          "@microsoft.graph.downloadUrl": "https://dl.test/x",
        },
      },
    ]);
    await expect(c.download("1")).rejects.toThrow(/too large|MB/i);
    expect(calls).toHaveLength(1);
  });

  it("creates in the app folder without overwriting, and updates by id", async () => {
    const { c, calls } = client([
      { status: 201, body: { id: "n1", name: "orders (1).diagram.json", webUrl: "https://onedrive.live.com/x" } },
      { status: 200, body: { id: "n1", name: "orders (1).diagram.json" } },
    ]);
    const created = await c.create("orders é.diagram.json", "{}");
    expect(created.id).toBe("n1");
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toBe(
      `${GRAPH}/me/drive/special/approot:/orders%20%C3%A9.diagram.json:/content?@microsoft.graph.conflictBehavior=rename`,
    );
    expect(calls[0].body).toBe("{}");
    await c.update("n1", '{"v":2}');
    expect(calls[1]).toMatchObject({ method: "PUT", url: `${GRAPH}/me/drive/items/n1/content`, body: '{"v":2}' });
  });

  it("retries once with a fresh token after a 401", async () => {
    const { c, calls, asked } = client([
      { status: 401, body: { error: { code: "InvalidAuthenticationToken" } } },
      { status: 200, body: { id: "n1", name: "a" } },
    ]);
    await c.update("n1", "x");
    expect(asked).toEqual([false, true]);
    expect(calls[1].headers.Authorization).toBe("Bearer t2");
  });

  it("maps failures to messages that say what to do", async () => {
    const offline = client(["network-error"]);
    await expect(offline.c.update("1", "x")).rejects.toThrow("Couldn't reach OneDrive to update the file");
    const missing = client([{ status: 404, body: { error: { code: "itemNotFound", message: "gone" } } }]);
    await expect(missing.c.update("1", "x")).rejects.toThrow(/no longer exists/);
    expect(graphError(507, "", "save_the_file")).toBe("Your OneDrive is full, so the file couldn't be saved.");
    expect(graphError(403, '{"error":{"code":"accessDenied","message":"nope"}}', "save_the_file")).toMatch(
      /refused.*own folder.*nope/,
    );
    expect(graphError(429, "", "save_the_file")).toMatch(/busy/);
    expect(graphError(400, "not json", "save_the_file")).toBe("Couldn't save the file on OneDrive (400).");
  });
});
