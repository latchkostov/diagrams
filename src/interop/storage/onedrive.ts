import { oneDriveConfig, type OneDriveConfig } from "./config";
import { authorized, checkSize, jsonField, readTextCapped, type ClientDeps } from "./http";
import {
  authorizeInPopup,
  createTokenSource,
  postTokenForm,
  type AuthorizeParams,
  type TokenSet,
  type TokenSource,
} from "./oauth";
import { OPENABLE, StorageError, type StorageEntry, type StorageProvider } from "./types";

// OneDrive (personal, and work or school) through Microsoft Graph, signed in with the Microsoft
// identity platform's auth code flow with PKCE (no MSAL, no secret).
//
// Scope: Files.ReadWrite.AppFolder, the least privilege that can save. Diagrams sees only its own
// folder, `Apps/<app name>` in the user's OneDrive (created on first use), so Open is an in-app list
// of that folder rather than the File Picker v8 (which needs full Files.ReadWrite plus separate
// SharePoint tokens). offline_access gives a refresh token, kept in memory: SPA refresh tokens last
// 24 hours, so the access token renews silently for the rest of the session.

const LABEL = "OneDrive";
const GRAPH = "https://graph.microsoft.com/v1.0";
export const ONEDRIVE_SCOPES = "Files.ReadWrite.AppFolder offline_access";

const authority = (c: OneDriveConfig) =>
  `https://login.microsoftonline.com/${encodeURIComponent(c.tenant)}/oauth2/v2.0`;

export function oneDriveAuthorizeUrl(c: OneDriveConfig, p: AuthorizeParams): string {
  const q = new URLSearchParams({
    client_id: c.clientId,
    response_type: "code",
    redirect_uri: p.redirectUri,
    response_mode: "query",
    scope: ONEDRIVE_SCOPES,
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    // Lets someone with several Microsoft accounts pick the one whose OneDrive they mean.
    prompt: "select_account",
  });
  return `${authority(c)}/authorize?${q}`;
}

export const exchangeOneDriveCode = (
  fetchFn: typeof fetch,
  c: OneDriveConfig,
  code: { code: string; verifier: string; redirectUri: string },
): Promise<TokenSet> =>
  postTokenForm(
    fetchFn,
    `${authority(c)}/token`,
    {
      client_id: c.clientId,
      grant_type: "authorization_code",
      code: code.code,
      redirect_uri: code.redirectUri,
      code_verifier: code.verifier,
      scope: ONEDRIVE_SCOPES,
    },
    LABEL,
  );

export const refreshOneDriveToken = (fetchFn: typeof fetch, c: OneDriveConfig, refreshToken: string) =>
  postTokenForm(
    fetchFn,
    `${authority(c)}/token`,
    { client_id: c.clientId, grant_type: "refresh_token", refresh_token: refreshToken, scope: ONEDRIVE_SCOPES },
    LABEL,
  );

// ---------------------------------------------------------------- Graph

export interface DriveItem {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  webUrl?: string;
  file?: object;
  "@microsoft.graph.downloadUrl"?: string;
}

export function graphError(status: number, body: string, action: string): string {
  const code = jsonField(body, (j) => (j.error as { code?: unknown } | undefined)?.code);
  const message = jsonField(body, (j) => (j.error as { message?: unknown } | undefined)?.message);
  if (status === 401) return `OneDrive sign-in expired while trying to ${action}. Please try again.`;
  if (status === 507 || code === "quotaLimitReached" || code === "insufficientStorage")
    return "Your OneDrive is full, so the file couldn't be saved.";
  if (status === 403)
    return `OneDrive refused to ${action}. Live Diagrams can only use files in its own folder (Apps › Diagrams).${message ? ` (${message})` : ""}`;
  if (status === 404) return "That OneDrive file no longer exists, or it was moved out of the Diagrams folder.";
  if (status === 409 || status === 412) return `The file changed in OneDrive while trying to ${action}. Try again.`;
  if (status === 429 || status >= 500) return `OneDrive is busy right now (${status}). Try again in a moment.`;
  return `Couldn't ${action} on OneDrive (${status}${message ? `: ${message}` : ""}).`;
}

const SELECT = "id,name,size,lastModifiedDateTime,webUrl,file";
const MAX_PAGES = 10;

export function createOneDriveClient(deps: ClientDeps) {
  const call = (url: string, init: RequestInit, action: string) =>
    authorized(deps, LABEL, graphError, url, init, action);

  return {
    /** The diagram-like files in the app folder, newest first. */
    async list(): Promise<DriveItem[]> {
      const items: DriveItem[] = [];
      let url: string | undefined = `${GRAPH}/me/drive/special/approot/children?$select=${SELECT}&$top=200`;
      for (let page = 0; url && page < MAX_PAGES; page++) {
        const res = await call(url, { method: "GET" }, "list your diagrams");
        const body = (await res.json()) as { value?: DriveItem[]; "@odata.nextLink"?: string };
        items.push(...(body.value ?? []));
        const next = body["@odata.nextLink"];
        // Only ever follow Graph's own links.
        url = typeof next === "string" && next.startsWith(`${GRAPH}/`) ? next : undefined;
      }
      return items
        .filter((i) => i.file && OPENABLE.test(i.name))
        .sort((a, b) => (b.lastModifiedDateTime ?? "").localeCompare(a.lastModifiedDateTime ?? ""));
    },

    /**
     * Reads a file. `/content` answers with a 302 that browsers can't follow after a CORS preflight,
     * so this asks for the pre-authenticated download URL and fetches that without a token.
     */
    async download(id: string): Promise<DriveItem & { text: string }> {
      const res = await call(
        `${GRAPH}/me/drive/items/${encodeURIComponent(id)}?$select=id,name,size,@microsoft.graph.downloadUrl`,
        { method: "GET" },
        "read the file",
      );
      const item = (await res.json()) as DriveItem;
      checkSize(item.size);
      const href = item["@microsoft.graph.downloadUrl"];
      if (!href || !/^https:\/\//.test(href)) throw new StorageError("OneDrive didn't offer a download for that file.");
      let file: Response;
      try {
        file = await deps.fetch(href, { method: "GET" });
      } catch {
        throw new StorageError("Couldn't reach OneDrive to download the file. Check your connection.");
      }
      if (!file.ok) throw new StorageError(graphError(file.status, "", "download the file"), file.status);
      return { ...item, text: await readTextCapped(file) };
    },

    /** Creates a file in the app folder; a name that's taken gets a number, nothing is overwritten. */
    async create(name: string, text: string, signal?: AbortSignal): Promise<DriveItem> {
      const res = await call(
        `${GRAPH}/me/drive/special/approot:/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=rename`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: text, signal },
        "save the file",
      );
      return (await res.json()) as DriveItem;
    },

    /** Replaces a file's content (simple upload: fine up to 250 MB, far above our 8 MB budget). */
    async update(id: string, text: string, signal?: AbortSignal): Promise<DriveItem> {
      const res = await call(
        `${GRAPH}/me/drive/items/${encodeURIComponent(id)}/content`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: text, signal },
        "update the file",
      );
      return (await res.json()) as DriveItem;
    },
  };
}

export type OneDriveClient = ReturnType<typeof createOneDriveClient>;

// ---------------------------------------------------------------- the provider

type Ref = { id: string };

/** The OneDrive provider for this build's config (undefined config: never offered, never called). */
export function oneDriveProvider(
  config: OneDriveConfig | undefined = oneDriveConfig,
  fetchFn: typeof fetch = (...a) => window.fetch(...a),
): StorageProvider<Ref> {
  const tokens: TokenSource = createTokenSource({
    interactive: async () => {
      if (!config) throw new StorageError("OneDrive isn't configured for this site.");
      const code = await authorizeInPopup(LABEL, (p) => oneDriveAuthorizeUrl(config, p));
      return exchangeOneDriveCode(fetchFn, config, code);
    },
    refresh: (rt) => refreshOneDriveToken(fetchFn, config!, rt),
  });
  const client = createOneDriveClient({ fetch: fetchFn, getToken: (force) => tokens.getToken(force) });
  const entry = (i: DriveItem): StorageEntry<Ref> => ({
    name: i.name,
    ref: { id: i.id },
    modified: i.lastModifiedDateTime,
    size: i.size,
  });

  return {
    id: "onedrive",
    label: LABEL,
    icon: "onedrive",
    folder: "Apps › Diagrams",
    isConfigured: () => !!config,
    async signIn() {
      await tokens.getToken();
    },
    // Tokens live only in this tab's memory. (Microsoft has no token revocation endpoint for SPAs.)
    signOut: () => void tokens.clear(),
    isSignedIn: () => tokens.signedIn(),
    list: async () => (await client.list()).map(entry),
    async open(ctx) {
      await this.signIn(); // inside the click: the popup can't be blocked
      const picked = (await ctx.choose({ load: () => this.list!() })) as StorageEntry<Ref> | undefined;
      if (!picked) return undefined;
      const done = ctx.progress(`Opening ${picked.name}…`);
      try {
        const file = await client.download(picked.ref.id);
        return { name: file.name, text: file.text, ref: { id: file.id } };
      } finally {
        done();
      }
    },
    async save(ref, text, opts) {
      const item = await client.update(ref.id, text, opts?.signal);
      return { name: item.name, ref: { id: item.id }, url: item.webUrl };
    },
    async saveAs(name, text, opts) {
      const item = await client.create(name, text, opts?.signal);
      return { name: item.name, ref: { id: item.id }, url: item.webUrl };
    },
  };
}
