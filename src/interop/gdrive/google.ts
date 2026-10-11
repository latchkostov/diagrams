import { createDriveClient, DriveError, type DriveClient } from "./client";
import { DRIVE_SCOPE, driveConfig, PICKER_MIME_TYPES } from "./config";

// Browser glue for Google Identity Services (token model) and the Google Picker. Scripts load
// lazily: menus call `preloadDrive()` when they open, so by the time the user clicks, the token
// client exists and `requestAccessToken` runs inside the click (popup blockers allow that).

const GIS_SRC = "https://accounts.google.com/gsi/client";
const GAPI_SRC = "https://apis.google.com/js/api.js";

// ---- minimal typings for the bits of the Google globals we use
interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  callback: (r: TokenResponse) => void;
  error_callback?: (e: { type: string; message?: string }) => void;
  requestAccessToken(o?: { prompt?: string }): void;
}
interface PickerDoc {
  id: string;
  name: string;
  mimeType: string;
}
interface PickerData {
  action: string;
  docs?: PickerDoc[];
}
interface PickerBuilderLike {
  addView(v: unknown): PickerBuilderLike;
  setOAuthToken(t: string): PickerBuilderLike;
  setDeveloperKey(k: string): PickerBuilderLike;
  setAppId(id: string): PickerBuilderLike;
  setCallback(cb: (d: PickerData) => void): PickerBuilderLike;
  setTitle(t: string): PickerBuilderLike;
  setOrigin(o: string): PickerBuilderLike;
  enableFeature(f: string): PickerBuilderLike;
  build(): { setVisible(v: boolean): void };
}
interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient(o: {
        client_id: string;
        scope: string;
        callback: (r: TokenResponse) => void;
        error_callback?: (e: { type: string }) => void;
      }): TokenClient;
      revoke(token: string, done?: () => void): void;
    };
  };
  picker: {
    PickerBuilder: new () => PickerBuilderLike;
    DocsView: new (viewId?: string) => {
      setMimeTypes(m: string): unknown;
      setIncludeFolders(b: boolean): unknown;
      setMode(m: string): unknown;
    };
    ViewId: { DOCS: string };
    DocsViewMode: { LIST: string };
    Action: { PICKED: string; CANCEL: string };
    Feature: { NAV_HIDDEN: string };
  };
}
declare global {
  interface Window {
    google?: GoogleGlobal;
    gapi?: { load(name: string, cb: { callback: () => void; onerror: () => void } | (() => void)): void };
  }
}

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scripts.delete(src);
        reject(
          new DriveError(
            "Couldn't load Google's sign-in script. Check your connection, or whether an ad blocker is blocking Google.",
          ),
        );
      };
      document.head.appendChild(s);
    });
    scripts.set(src, p);
  }
  return p;
}

let pickerReady: Promise<void> | undefined;
function loadPicker(): Promise<void> {
  pickerReady ??= loadScript(GAPI_SRC).then(
    () =>
      new Promise<void>((resolve, reject) =>
        window.gapi!.load("picker", {
          callback: () => resolve(),
          onerror: () => reject(new DriveError("Couldn't load the Google Picker.")),
        }),
      ),
  );
  pickerReady.catch(() => (pickerReady = undefined));
  return pickerReady;
}

let tokenClient: TokenClient | undefined;
let token: { value: string; expires: number } | undefined;
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | undefined;

function ensureTokenClient(): TokenClient | undefined {
  if (tokenClient || !window.google?.accounts?.oauth2 || !driveConfig) return tokenClient;
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: driveConfig.clientId,
    scope: DRIVE_SCOPE,
    callback: (r) => {
      const p = pending;
      pending = undefined;
      if (!p) return;
      if (r.error || !r.access_token)
        return p.reject(
          new DriveError(
            r.error === "access_denied"
              ? "Google Drive access wasn't granted."
              : `Google sign-in failed (${r.error_description ?? r.error ?? "no token"}).`,
          ),
        );
      token = { value: r.access_token, expires: Date.now() + (Number(r.expires_in) || 3600) * 1000 - 60_000 };
      p.resolve(r.access_token);
    },
    error_callback: (e) => {
      const p = pending;
      pending = undefined;
      p?.reject(
        new DriveError(
          e.type === "popup_closed"
            ? "Google sign-in was closed before it finished."
            : e.type === "popup_failed_to_open"
              ? "The Google sign-in window was blocked. Allow pop-ups for this site and try again."
              : "Google sign-in failed.",
        ),
      );
    },
  });
  return tokenClient;
}

/** Starts loading Google's scripts in the background (call when a menu with Drive items opens). */
export function preloadDrive(): void {
  if (!driveConfig) return;
  loadScript(GIS_SRC).then(ensureTokenClient, () => {});
  loadPicker().catch(() => {});
}

/** A valid access token, prompting the user (popup) if needed. Call from a click handler. */
export async function getDriveToken(force = false): Promise<string> {
  if (!driveConfig) throw new DriveError("Google Drive isn't configured for this site.");
  if (!force && token && token.expires > Date.now()) return token.value;
  if (!tokenClient) {
    await loadScript(GIS_SRC);
    ensureTokenClient();
  }
  if (!tokenClient) throw new DriveError("Google sign-in isn't available right now.");
  pending?.reject(new DriveError("Superseded by a newer sign-in request."));
  return new Promise<string>((resolve, reject) => {
    pending = { resolve, reject };
    // Empty prompt: no account chooser / consent screen if the user already granted access.
    tokenClient!.requestAccessToken({ prompt: token ? "" : undefined });
  });
}

export function signOutDrive(): void {
  if (token && window.google) window.google.accounts.oauth2.revoke(token.value);
  token = undefined;
}

let client: DriveClient | undefined;
export function driveClient(): DriveClient {
  client ??= createDriveClient({ fetch: (...a) => window.fetch(...a), getToken: getDriveToken });
  return client;
}

/** Opens the Google Picker; resolves with the picked file, or undefined if cancelled. */
export async function pickDriveFile(): Promise<{ id: string; name: string; mimeType: string } | undefined> {
  if (!driveConfig) throw new DriveError("Google Drive isn't configured for this site.");
  const [accessToken] = await Promise.all([getDriveToken(), loadPicker()]);
  const g = window.google!;
  const view = new g.picker.DocsView(g.picker.ViewId.DOCS);
  view.setMimeTypes(PICKER_MIME_TYPES);
  view.setIncludeFolders(true);
  view.setMode(g.picker.DocsViewMode.LIST);
  return new Promise((resolve) => {
    let builder = new g.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(driveConfig!.apiKey)
      .setTitle("Open a diagram")
      .setOrigin(window.location.origin)
      .setCallback((data) => {
        if (data.action === g.picker.Action.PICKED && data.docs?.[0])
          resolve({ id: data.docs[0].id, name: data.docs[0].name, mimeType: data.docs[0].mimeType });
        else if (data.action === g.picker.Action.CANCEL) resolve(undefined);
      });
    if (driveConfig!.appId) builder = builder.setAppId(driveConfig!.appId);
    builder.build().setVisible(true);
  });
}
