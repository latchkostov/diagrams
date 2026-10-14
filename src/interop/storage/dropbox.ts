import { t } from "../../i18n";
import { dropboxConfig, type DropboxConfig } from "./config";
import { authorized, checkSize, headerSafeJson, jsonField, readTextCapped, type ClientDeps } from "./http";
import {
  authorizeInPopup,
  createTokenSource,
  postTokenForm,
  type AuthorizeParams,
  type TokenSet,
  type TokenSource,
} from "./oauth";
import { OPENABLE, StorageError, type StorageEntry, type StorageProvider } from "./types";

// Dropbox through its HTTP API, signed in with OAuth 2 code flow + PKCE (no app secret).
//
// The Dropbox app is an "App folder" app: Diagrams sees only `Apps/<app name>` in the user's Dropbox,
// so Open is an in-app list of that folder. (The Chooser could browse the whole Dropbox, but it hands
// back a link, not write access, so Save couldn't go back to the file.) Tokens are short-lived
// (`token_access_type=online`, about 4 hours) and kept in memory; when one expires, the next action
// asks again, which Dropbox answers without a prompt for a user who already allowed the app.

const LABEL = "Dropbox";
const AUTHORIZE = "https://www.dropbox.com/oauth2/authorize";
const TOKEN = "https://api.dropboxapi.com/oauth2/token";
const API = "https://api.dropboxapi.com/2";
const CONTENT = "https://content.dropboxapi.com/2";
/** The scopes Diagrams asks for (a subset of the app's): list, read and write files in its folder. */
export const DROPBOX_SCOPES = "files.metadata.read files.content.read files.content.write";

export function dropboxAuthorizeUrl(c: DropboxConfig, p: AuthorizeParams): string {
  const q = new URLSearchParams({
    client_id: c.appKey,
    response_type: "code",
    redirect_uri: p.redirectUri,
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    token_access_type: "online",
    scope: DROPBOX_SCOPES,
  });
  return `${AUTHORIZE}?${q}`;
}

export const exchangeDropboxCode = (
  fetchFn: typeof fetch,
  c: DropboxConfig,
  code: { code: string; verifier: string; redirectUri: string },
): Promise<TokenSet> =>
  postTokenForm(
    fetchFn,
    TOKEN,
    {
      client_id: c.appKey,
      grant_type: "authorization_code",
      code: code.code,
      redirect_uri: code.redirectUri,
      code_verifier: code.verifier,
    },
    LABEL,
  );

// ---------------------------------------------------------------- the API

export interface DropboxFile {
  ".tag"?: string;
  id: string;
  name: string;
  path_display?: string;
  size?: number;
  server_modified?: string;
  rev?: string;
}

export function dropboxError(status: number, body: string, action: string): string {
  const summary = jsonField(body, (j) => j.error_summary) || body.slice(0, 200);
  if (status === 401)
    return t("cloud.dropboxSigninExpiredWhileTryingToAction", { action: action.replaceAll(" ", "_") });
  if (/insufficient_space/.test(summary)) return t("cloud.yourDropboxIsFullSoTheFile");
  if (/not_found/.test(summary)) return t("cloud.thatDropboxFileNoLongerExistsOr");
  if (/conflict/.test(summary))
    return t("cloud.theFileChangedInDropboxWhileTrying", { action: action.replaceAll(" ", "_") });
  if (status === 400 && /scope|app_folder|permission/i.test(summary))
    return t("cloud.dropboxRefusedToActionTheAppIsnt", { action: action.replaceAll(" ", "_") });
  if (status === 403) return t("cloud.dropboxRefusedToAction", { action: action.replaceAll(" ", "_") });
  if (status === 429 || status >= 500) return t("cloud.dropboxIsBusyRightNowStatusTry", { status: status });
  return t("cloud.couldntValue0OnDropboxValue1value2", {
    value0: action.replaceAll(" ", "_"),
    value1: status,
    value2: summary ? `: ${summary}` : "",
  });
}

const MAX_PAGES = 10;

export function createDropboxClient(deps: ClientDeps) {
  const call = (url: string, init: RequestInit, action: string) =>
    authorized(deps, LABEL, dropboxError, url, init, action);
  const rpc = (route: string, arg: unknown, action: string) =>
    call(
      `${API}/${route}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(arg) },
      action,
    );

  return {
    /** The diagram-like files in the app folder ("" is its root), newest first. */
    async list(): Promise<DropboxFile[]> {
      const files: DropboxFile[] = [];
      let res = await rpc("files/list_folder", { path: "", limit: 500 }, "list your diagrams");
      for (let page = 0; ; page++) {
        const body = (await res.json()) as { entries?: DropboxFile[]; cursor?: string; has_more?: boolean };
        files.push(...(body.entries ?? []));
        if (!body.has_more || !body.cursor || page + 1 >= MAX_PAGES) break;
        res = await rpc("files/list_folder/continue", { cursor: body.cursor }, "list your diagrams");
      }
      return files
        .filter((f) => f[".tag"] === "file" && OPENABLE.test(f.name))
        .sort((a, b) => (b.server_modified ?? "").localeCompare(a.server_modified ?? ""));
    },

    /** Reads a file by id (`id:…`). Its metadata comes back in the Dropbox-API-Result header. */
    async download(id: string, size?: number): Promise<{ text: string; meta?: DropboxFile }> {
      checkSize(size);
      const res = await call(
        `${CONTENT}/files/download`,
        { method: "POST", headers: { "Dropbox-API-Arg": headerSafeJson({ path: id }) } },
        "download the file",
      );
      let meta: DropboxFile | undefined;
      try {
        meta = JSON.parse(res.headers.get("Dropbox-API-Result") ?? "") as DropboxFile;
      } catch {
        meta = undefined;
      }
      return { text: await readTextCapped(res), meta };
    },

    /**
     * Writes a file. Save as: a new path in the app folder, `add` + autorename (never overwrites).
     * Save: the same file by id, `overwrite`.
     */
    async upload(path: string, text: string, mode: "add" | "overwrite", signal?: AbortSignal): Promise<DropboxFile> {
      const res = await call(
        `${CONTENT}/files/upload`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "Dropbox-API-Arg": headerSafeJson({ path, mode, autorename: mode === "add", mute: true }),
          },
          body: text,
          signal,
        },
        mode === "add" ? "save the file" : "update the file",
      );
      return (await res.json()) as DropboxFile;
    },

    /** Ends the session on Dropbox's side too. Best effort. */
    async revoke(token: string): Promise<void> {
      await deps.fetch(`${API}/auth/token/revoke`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    },
  };
}

export type DropboxClient = ReturnType<typeof createDropboxClient>;

/** A name Dropbox accepts as one path segment. */
export const dropboxPath = (name: string) => `/${name.replace(/[\\/:?*"<>|]/g, "-").trim() || "diagram.diagram.json"}`;

// ---------------------------------------------------------------- the provider

type Ref = { id: string };

export function dropboxProvider(
  config: DropboxConfig | undefined = dropboxConfig,
  fetchFn: typeof fetch = (...a) => window.fetch(...a),
): StorageProvider<Ref> {
  const tokens: TokenSource = createTokenSource({
    interactive: async () => {
      if (!config) throw new StorageError(t("cloud.dropboxIsntConfiguredForThisSite"));
      const code = await authorizeInPopup(LABEL, (p) => dropboxAuthorizeUrl(config, p));
      return exchangeDropboxCode(fetchFn, config, code);
    },
  });
  const client = createDropboxClient({ fetch: fetchFn, getToken: (force) => tokens.getToken(force) });
  const saved = (f: DropboxFile) => ({ name: f.name, ref: { id: f.id } });

  return {
    id: "dropbox",
    label: LABEL,
    icon: "dropbox",
    folder: "Apps › Diagrams",
    isConfigured: () => !!config,
    async signIn() {
      await tokens.getToken();
    },
    signOut() {
      const token = tokens.clear();
      if (token) void client.revoke(token).catch(() => {});
    },
    isSignedIn: () => tokens.signedIn(),
    list: async () =>
      (await client.list()).map((f): StorageEntry<Ref> => ({
        name: f.name,
        ref: { id: f.id },
        modified: f.server_modified,
        size: f.size,
      })),
    async open(ctx) {
      await this.signIn(); // inside the click: the popup can't be blocked
      const picked = (await ctx.choose({ load: () => this.list!() })) as StorageEntry<Ref> | undefined;
      if (!picked) return undefined;
      const done = ctx.progress(`Opening ${picked.name}…`);
      try {
        const file = await client.download(picked.ref.id, picked.size);
        return { name: file.meta?.name ?? picked.name, text: file.text, ref: { id: file.meta?.id ?? picked.ref.id } };
      } finally {
        done();
      }
    },
    async save(ref, text, opts) {
      return saved(await client.upload(ref.id, text, "overwrite", opts?.signal));
    },
    async saveAs(name, text, opts) {
      return saved(await client.upload(dropboxPath(name), text, "add", opts?.signal));
    },
  };
}
