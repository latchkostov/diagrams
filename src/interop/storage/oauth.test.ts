import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeFetch } from "../../test/fakeFetch";
import {
  authorizeError,
  authorizeInPopup,
  base64url,
  createTokenSource,
  pkceChallenge,
  postTokenForm,
  randomToken,
  redirectUri,
  tokenError,
  type PopupDeps,
} from "./oauth";
import { StorageError } from "./types";

describe("PKCE", () => {
  it("makes URL-safe verifiers of a valid length", () => {
    const v = randomToken(48);
    expect(v).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(randomToken(48)).not.toBe(v);
    expect(base64url(new Uint8Array([251, 255, 191]))).toBe("-_-_");
  });

  it("derives the S256 challenge as base64url(SHA-256(verifier))", async () => {
    const verifier = randomToken(48);
    expect(await pkceChallenge(verifier)).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("redirects to auth.html next to the app, under any sub-path, without query or hash", () => {
    expect(redirectUri("https://www.livediagrams.dev/?view=canvas#d=x")).toBe("https://www.livediagrams.dev/auth.html");
    expect(redirectUri("https://example.com/tools/diagrams/index.html")).toBe(
      "https://example.com/tools/diagrams/auth.html",
    );
  });
});

/** A fake popup and message bus: `deliver` plays auth.html posting the redirect's query. */
function popupHarness(opts: { blocked?: boolean } = {}) {
  const popup = { closed: false, location: { href: "" }, close: vi.fn(() => (popup.closed = true)) };
  let onParams: ((p: Record<string, string>) => void) | undefined;
  let focused = false;
  const deps: PopupDeps = {
    open: vi.fn(() => (opts.blocked ? null : (popup as unknown as Window))),
    listen: (fn) => {
      onParams = fn;
      return () => (onParams = undefined);
    },
    hasFocus: () => focused,
    pollMs: 10,
    graceMs: 30,
    redirectUri: "https://app.test/auth.html",
  };
  const state = () => new URL(popup.location.href).searchParams.get("state")!;
  return {
    popup,
    deps,
    state,
    deliver: (p: Record<string, string>) => onParams?.(p),
    focus: (f: boolean) => (focused = f),
    listening: () => !!onParams,
  };
}

const build = (p: { state: string; challenge: string; redirectUri: string }) =>
  `https://login.test/authorize?${new URLSearchParams({ ...p })}`;

describe("authorizeInPopup", () => {
  afterEach(() => vi.useRealTimers());

  it("opens the popup synchronously, then sends it to the authorize URL with a challenge and state", async () => {
    const h = popupHarness();
    const pending = authorizeInPopup("OneDrive", build, h.deps);
    // Before anything was awaited: the window exists (popup blockers allow it inside the click).
    expect(h.deps.open).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(h.popup.location.href).toMatch(/^https:\/\/login\.test\/authorize\?/));
    const url = new URL(h.popup.location.href);
    expect(url.searchParams.get("redirectUri")).toBe("https://app.test/auth.html");
    const challenge = url.searchParams.get("challenge")!;
    h.deliver({ state: "someone-else", code: "evil" }); // a stray message is ignored
    h.deliver({ state: h.state(), code: "the-code" });
    const result = await pending;
    expect(result.code).toBe("the-code");
    expect(result.redirectUri).toBe("https://app.test/auth.html");
    expect(await pkceChallenge(result.verifier)).toBe(challenge);
    expect(h.popup.close).toHaveBeenCalled();
    expect(h.listening()).toBe(false);
  });

  it("explains a blocked popup", async () => {
    const h = popupHarness({ blocked: true });
    await expect(authorizeInPopup("Dropbox", build, h.deps)).rejects.toThrow(/blocked.*Allow pop-ups/);
  });

  it("maps a denied consent to a readable error", async () => {
    const h = popupHarness();
    const pending = authorizeInPopup("Dropbox", build, h.deps);
    await vi.waitFor(() => expect(h.popup.location.href).not.toBe(""));
    h.deliver({ state: h.state(), error: "access_denied", error_description: "The user denied" });
    await expect(pending).rejects.toThrow("Dropbox access wasn't granted");
  });

  it("treats the popup as closed only once this page has focus again and nothing arrived", async () => {
    const h = popupHarness();
    const pending = authorizeInPopup("OneDrive", build, h.deps);
    const settled = vi.fn();
    pending.then(settled, settled);
    await vi.waitFor(() => expect(h.popup.location.href).not.toBe(""));
    // Cut off by the sign-in page's opener policy: reads as closed while the user is still in it.
    h.popup.closed = true;
    await new Promise((r) => setTimeout(r, 80));
    expect(settled).not.toHaveBeenCalled();
    h.focus(true);
    await expect(pending).rejects.toThrow("sign-in window was closed before it finished");
  });

  it("a newer sign-in supersedes an older one", async () => {
    const a = popupHarness();
    const first = authorizeInPopup("OneDrive", build, a.deps);
    await vi.waitFor(() => expect(a.popup.location.href).not.toBe(""));
    const b = popupHarness();
    const second = authorizeInPopup("OneDrive", build, b.deps);
    await expect(first).rejects.toThrow(/Superseded/);
    await vi.waitFor(() => expect(b.popup.location.href).not.toBe(""));
    b.deliver({ state: b.state(), code: "c2" });
    await expect(second).resolves.toMatchObject({ code: "c2" });
  });
});

describe("token endpoint errors", () => {
  it("posts a form and returns the token set", async () => {
    const f = fakeFetch([{ status: 200, body: { access_token: "a", expires_in: 3600 } }]);
    const t = await postTokenForm(
      f.fn,
      "https://login.test/token",
      { grant_type: "authorization_code", code: "c" },
      "X",
    );
    expect(t.access_token).toBe("a");
    expect(f.calls[0].method).toBe("POST");
    expect(f.calls[0].headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(f.calls[0].body).toBe("grant_type=authorization_code&code=c");
  });

  it("says what to fix", async () => {
    const offline = fakeFetch(["network-error"]);
    await expect(postTokenForm(offline.fn, "u", {}, "OneDrive")).rejects.toThrow(/Couldn't reach OneDrive/);
    expect(
      tokenError(
        "OneDrive",
        400,
        "invalid_request",
        "AADSTS9002326: Cross-origin token redemption is permitted only for the 'Single-Page Application' client-type.",
      ),
    ).toMatch(/"Single-page application" redirect URI/);
    expect(tokenError("Dropbox", 400, "invalid_grant", "code doesn't exist or has expired")).toBe(
      "Dropbox sign-in expired. Please try again.",
    );
    expect(tokenError("OneDrive", 503)).toMatch(/busy/);
    expect(authorizeError("OneDrive", "access_denied", "AADSTS90094: admin approval")).toMatch(/wasn't granted/);
    expect(authorizeError("OneDrive", "consent_required", "AADSTS90094: needs admin approval")).toMatch(/admin/);
    const bad = fakeFetch([
      { status: 400, body: { error: "invalid_client", error_description: "line one\nline two" } },
    ]);
    const err = await postTokenForm(bad.fn, "u", {}, "Dropbox").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).message).toBe("Dropbox sign-in failed (line one).");
  });
});

describe("in-memory tokens", () => {
  it("keeps a token until a minute before it expires, then renews with the refresh token", async () => {
    let now = 0;
    const interactive = vi.fn(async () => ({ access_token: "a1", expires_in: 3600, refresh_token: "r1" }));
    const refresh = vi.fn(async (rt: string) => ({ access_token: `a2-${rt}`, expires_in: 3600, refresh_token: "r2" }));
    const t = createTokenSource({ interactive, refresh, now: () => now });
    expect(t.signedIn()).toBe(false);
    expect(await t.getToken()).toBe("a1");
    expect(await t.getToken()).toBe("a1");
    now = 3600_000 - 59_000;
    expect(await t.getToken()).toBe("a2-r1");
    expect(interactive).toHaveBeenCalledTimes(1);
    expect(await t.getToken(true)).toBe("a2-r2");
    expect(t.clear()).toBe("a2-r2");
    expect(t.signedIn()).toBe(false);
  });

  it("signs in again when the refresh token is dead, and shares one sign-in between callers", async () => {
    let n = 0;
    const interactive = vi.fn(async () => ({ access_token: `a${++n}`, expires_in: 1, refresh_token: "r" }));
    const refresh = vi.fn(async () => {
      throw new StorageError("expired");
    });
    const t = createTokenSource({ interactive, refresh });
    const [x, y] = await Promise.all([t.getToken(), t.getToken()]);
    expect([x, y]).toEqual(["a1", "a1"]);
    expect(await t.getToken()).toBe("a2"); // expired at once (1s minus the margin); refresh fails
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(interactive).toHaveBeenCalledTimes(2);
  });

  it("without a refresh token, an expired token means a new sign-in, started synchronously", () => {
    const interactive = vi.fn(() => new Promise<never>(() => {}));
    const t = createTokenSource({ interactive });
    void t.getToken();
    expect(interactive).toHaveBeenCalledTimes(1);
  });
});
