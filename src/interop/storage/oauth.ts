import { StorageError } from "./types";

// OAuth 2.0 authorization code flow with PKCE for a static site: no client secret, no backend.
//
// 1. In the click handler, open a blank popup (before any `await`, so it isn't blocked).
// 2. Make a PKCE verifier and its S256 challenge, then send the popup to the provider's authorize URL
//    with `redirect_uri` = this site's `auth.html`.
// 3. `public/auth.html` (a tiny static page, same origin) posts the redirect's query back on a
//    BroadcastChannel and to `window.opener`, then closes. A BroadcastChannel still works when the
//    sign-in page's Cross-Origin-Opener-Policy has cut the popup off from its opener.
// 4. The provider module exchanges the code (plus the verifier) at the token endpoint, which allows
//    CORS for public SPA clients.
//
// Tokens stay in memory (never in localStorage): a reload signs you out, and a refresh token, when the
// provider gives one, renews the access token silently until then.

export const OAUTH_CHANNEL = "diagrams-oauth";
export const OAUTH_MESSAGE = "diagrams-oauth";

export const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** A random string of URL-safe characters: 48 bytes make a 64-character PKCE verifier (43–128 allowed). */
export function randomToken(bytes = 48): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** The S256 code challenge: base64url(SHA-256(verifier)). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** Where providers send the user back: `auth.html` next to the app (works under any sub-path). */
export function redirectUri(base = document.baseURI): string {
  const url = new URL("auth.html", base);
  url.search = "";
  url.hash = "";
  return url.href;
}

export interface AuthorizeParams {
  state: string;
  challenge: string;
  redirectUri: string;
}

export interface AuthCode {
  code: string;
  verifier: string;
  redirectUri: string;
}

export interface PopupDeps {
  /** Opens the (blank) sign-in window. Must run synchronously inside a user gesture. */
  open(): Window | null;
  /** Subscribes to redirect results from auth.html; returns an unsubscribe. */
  listen(onParams: (params: Record<string, string>) => void): () => void;
  /** Whether this page has focus (the user came back from the popup). */
  hasFocus(): boolean;
  pollMs?: number;
  /** After the popup reads as closed, how long to wait for a result that may still be in flight. */
  graceMs?: number;
  timeoutMs?: number;
  /** Defaults to this site's auth.html. */
  redirectUri?: string;
}

function browserDeps(): PopupDeps {
  return {
    open: () => {
      const w = 520;
      const h = 680;
      const left = Math.max(0, window.screenX + (window.outerWidth - w) / 2);
      const top = Math.max(0, window.screenY + (window.outerHeight - h) / 2);
      return window.open("", "diagrams-sign-in", `popup,width=${w},height=${h},left=${left},top=${top}`);
    },
    listen: (onParams) => {
      const handle = (data: unknown) => {
        const m = data as { type?: unknown; params?: unknown } | null;
        if (m?.type === OAUTH_MESSAGE && m.params && typeof m.params === "object")
          onParams(m.params as Record<string, string>);
      };
      const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(OAUTH_CHANNEL) : undefined;
      if (channel) channel.onmessage = (e) => handle(e.data);
      const onMessage = (e: MessageEvent) => {
        if (e.origin === window.location.origin) handle(e.data);
      };
      window.addEventListener("message", onMessage);
      return () => {
        channel?.close();
        window.removeEventListener("message", onMessage);
      };
    },
    hasFocus: () => document.hasFocus(),
  };
}

let cancelActive: ((reason: Error) => void) | undefined;

/**
 * Runs the authorize step in a popup and resolves with the code and its verifier. Call it from a
 * click or key handler: the popup opens synchronously, before anything is awaited.
 */
export async function authorizeInPopup(
  label: string,
  buildUrl: (p: AuthorizeParams) => string,
  deps: PopupDeps = browserDeps(),
): Promise<AuthCode> {
  const popup = deps.open();
  if (!popup)
    throw new StorageError(`The ${label} sign-in window was blocked. Allow pop-ups for this site and try again.`);
  cancelActive?.(new StorageError(`Superseded by a newer ${label} sign-in.`));
  const verifier = randomToken(48);
  const state = randomToken(16);
  const uri = deps.redirectUri ?? redirectUri();
  let url: string;
  try {
    url = buildUrl({ state, challenge: await pkceChallenge(verifier), redirectUri: uri });
  } catch (err) {
    popup.close();
    throw err;
  }
  popup.location.href = url;

  return new Promise<AuthCode>((resolve, reject) => {
    let settled = false;
    let closedAt: number | undefined;
    const started = Date.now();
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      unlisten();
      clearInterval(timer);
      if (cancelActive === cancel) cancelActive = undefined;
      fn();
    };
    const cancel = (reason: Error) => finish(() => reject(reason));
    cancelActive = cancel;
    const unlisten = deps.listen((params) => {
      if (params.state !== state) return;
      finish(() => {
        try {
          if (!popup.closed) popup.close();
        } catch {
          /* cut off by the provider's opener policy: auth.html closes itself */
        }
        if (params.error) reject(new StorageError(authorizeError(label, params.error, params.error_description)));
        else if (!params.code) reject(new StorageError(`${label} sign-in didn't return a code. Please try again.`));
        else resolve({ code: params.code, verifier, redirectUri: uri });
      });
    });
    // A popup that reads as closed may only be cut off from us (opener policy) while the user is still
    // signing in, so it counts as closed only once this page has focus again and nothing arrived.
    const timer = setInterval(() => {
      const now = Date.now();
      if (now - started > (deps.timeoutMs ?? 10 * 60_000))
        return cancel(new StorageError(`${label} sign-in timed out. Please try again.`));
      let closed: boolean;
      try {
        closed = popup.closed;
      } catch {
        closed = false;
      }
      if (!closed || !deps.hasFocus()) return void (closedAt = undefined);
      closedAt ??= now;
      if (now - closedAt >= (deps.graceMs ?? 1200))
        cancel(new StorageError(`The ${label} sign-in window was closed before it finished.`));
    }, deps.pollMs ?? 400);
  });
}

/** Errors the authorize redirect can carry, in words. */
export function authorizeError(label: string, error: string, description?: string): string {
  if (error === "access_denied" || /AADSTS65004/.test(description ?? ""))
    return `${label} access wasn't granted, so Live Diagrams can't open or save files there.`;
  if (/AADSTS90094|AADSTS90008|admin/i.test(description ?? ""))
    return `Your organization's admin has to approve Live Diagrams before you can use ${label} with this account.`;
  return `${label} sign-in failed (${short(description) || error}).`;
}

const short = (s?: string) => (s ?? "").split(/\r?\n/)[0].slice(0, 160).trim();

// ---------------------------------------------------------------- token endpoint

export interface TokenSet {
  access_token: string;
  expires_in?: number | string;
  refresh_token?: string;
}

/** POSTs a form to a token endpoint and maps every failure to a readable StorageError. */
export async function postTokenForm(
  fetchFn: typeof fetch,
  url: string,
  form: Record<string, string>,
  label: string,
): Promise<TokenSet> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
  } catch {
    throw new StorageError(`Couldn't reach ${label} to sign in. Check your connection.`);
  }
  const text = await res.text().catch(() => "");
  let body: Partial<TokenSet> & { error?: string; error_description?: string } = {};
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    /* not JSON */
  }
  if (res.ok && typeof body.access_token === "string") return body as TokenSet;
  throw new StorageError(tokenError(label, res.status, body.error, body.error_description), res.status);
}

export function tokenError(label: string, status: number, error?: string, description?: string): string {
  const d = description ?? "";
  if (/AADSTS9002326|AADSTS9002327|Single-Page Application/i.test(d))
    return `${label} sign-in isn't set up for this site yet: its app registration needs this address as a "Single-page application" redirect URI.`;
  if (/AADSTS50011|redirect_uri|redirect uri/i.test(d))
    return `${label} sign-in isn't set up for this address (the redirect URI isn't registered).`;
  if (error === "invalid_grant") return `${label} sign-in expired. Please try again.`;
  if (status === 429 || status >= 500) return `${label} sign-in is busy right now (${status}). Try again in a moment.`;
  return `${label} sign-in failed (${short(d) || error || status}).`;
}

// ---------------------------------------------------------------- an in-memory token

export interface TokenSource {
  /** A valid access token; `force` skips the cached one (after a 401). */
  getToken(force?: boolean): Promise<string>;
  signedIn(): boolean;
  /** Forgets the tokens; returns the access token that was in use, for revoking. */
  clear(): string | undefined;
}

export function createTokenSource(o: {
  /** The popup flow. Called synchronously from getToken when there's nothing to renew. */
  interactive(): Promise<TokenSet>;
  /** Silent renewal with a refresh token, when the provider issues one. */
  refresh?(refreshToken: string): Promise<TokenSet>;
  now?: () => number;
}): TokenSource {
  const now = o.now ?? (() => Date.now());
  let access: { value: string; expires: number } | undefined;
  let refreshToken: string | undefined;
  let inflight: Promise<string> | undefined;

  const keep = (t: TokenSet) => {
    // Renew a minute early so a request never starts with a token about to expire.
    access = { value: t.access_token, expires: now() + (Number(t.expires_in) || 3600) * 1000 - 60_000 };
    if (t.refresh_token) refreshToken = t.refresh_token;
    return t.access_token;
  };

  return {
    getToken(force = false) {
      if (!force && access && access.expires > now()) return Promise.resolve(access.value);
      if (inflight) return inflight;
      const rt = o.refresh && refreshToken;
      inflight = (
        rt
          ? o.refresh!(rt).then(keep, () => {
              // A dead refresh token: sign in again (the provider usually remembers the user).
              refreshToken = undefined;
              return o.interactive().then(keep);
            })
          : o.interactive().then(keep)
      ).finally(() => (inflight = undefined));
      return inflight;
    },
    signedIn: () => !!access || !!refreshToken,
    clear() {
      const value = access?.value;
      access = undefined;
      refreshToken = undefined;
      return value;
    },
  };
}
